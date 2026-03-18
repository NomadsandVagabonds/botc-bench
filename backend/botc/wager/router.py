"""FastAPI router for The Crown's Wager.

Prediction market mechanics: each question is a binary market with
YES/NO shares priced by a CPMM. Buying one side moves the price.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
import urllib.parse
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from . import db
from .auth import require_user
from .bots import ensure_bots_for_game, generate_bot_bets, on_phase_change, _managers
from .scoring import Market, create_game_markets

log = logging.getLogger(__name__)

wager_router = APIRouter()


# ── In-memory market state (per game) ──────────────────────────────

_game_markets: dict[str, dict[str, Market]] = {}


async def _ensure_markets(game_id: str, total_players: int) -> dict[str, Market]:
    """Get or create markets for a game, synced with DB."""
    if game_id in _game_markets:
        return _game_markets[game_id]

    # Check DB for existing markets
    db_markets = await db.get_game_markets(game_id)
    if db_markets:
        markets = {}
        for m in db_markets:
            markets[m["market_id"]] = Market(
                market_id=m["market_id"],
                yes_pool=m["yes_pool"],
                no_pool=m["no_pool"],
            )
        _game_markets[game_id] = markets
        return markets

    # Create fresh markets with initial history
    markets = create_game_markets(total_players)
    for m in markets.values():
        await db.create_market(game_id, m.market_id, m.yes_pool, m.no_pool)
        await db.record_market_history(game_id, m.market_id, m.prob_yes, "creation")
    _game_markets[game_id] = markets

    # Initialize bots and seed initial bets for market liquidity
    await ensure_bots_for_game(game_id, total_players)
    await _seed_bot_bets(game_id, markets, total_players)

    return markets


async def _seed_bot_bets(game_id: str, markets: dict[str, Market], total_players: int) -> None:
    """Have bots place initial bets to create price movement and chart data."""
    mgr = _managers.get(game_id)
    if not mgr:
        return

    # Load public events if available (for completed games)
    runners, games = _get_game_state()
    events: list[dict] = []
    runner = runners.get(game_id)
    if runner and runner.event_history:
        from botc.monitor.event_filter import filter_public_events
        events = filter_public_events(runner.event_history)
    elif game_id in games:
        info = games[game_id]
        if info.get("events"):
            from botc.monitor.event_filter import filter_public_events
            events = filter_public_events(info["events"])

    # Have each bot place 2-4 initial bets to seed the markets
    for bot in mgr.bots:
        bot.phase_count = 3  # skip patience requirement for seeding
        for _ in range(bot.rng.randint(2, 4)):
            if bot.budget < 3:
                break
            results = await generate_bot_bets(mgr, markets, events, "setup", 0)
            if not results:
                break

    log.info("Seeded bot bets for game %s", game_id[:8])


# ── Helpers ─────────────────────────────────────────────────────────

def _get_game_state() -> tuple[dict, dict]:
    from botc.api.routes import _runners, _games
    return _runners, _games


def _get_runner_info(game_id: str) -> dict[str, Any] | None:
    runners, games = _get_game_state()
    runner = runners.get(game_id)
    if runner and runner.state:
        state = runner.state
        return {
            "phase": state.phase.value,
            "day_number": state.day_number,
            "alive_count": len(state.alive_players),
            "total_players": len(state.players),
            "running": True,
        }
    if game_id in games:
        info = games[game_id]
        # Extract player count from saved game data for completed games
        total_players = 10  # default
        result_data = info.get("result", info.get("result_data"))
        if result_data and hasattr(result_data, "players"):
            total_players = len(result_data.players)
        elif isinstance(result_data, dict) and "players" in result_data:
            total_players = len(result_data["players"])
        elif info.get("initial_state") and "players" in info["initial_state"]:
            total_players = len(info["initial_state"]["players"])
        return {"running": False, "total_players": total_players, "phase": "game_over", "day_number": 0}
    return None


# ── Request/Response Models ────────────────────────────────────────

class ClaimNameRequest(BaseModel):
    display_name: str = Field(..., min_length=2, max_length=24)
    passphrase: str | None = None

class PlaceBetRequest(BaseModel):
    market_id: str          # e.g. "alignment_seat_3" or "winner_evil"
    side: str = Field(..., pattern=r"^(yes|no)$")
    crowns: float = Field(..., ge=1, le=50)


# ═══════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════

@wager_router.post("/api/wager/auth/claim")
async def claim_name(req: ClaimNameRequest):
    """Claim a new name or log in to an existing one."""
    existing = await db.get_user_by_name(req.display_name)
    if existing:
        # Existing user — verify passphrase if one is set
        stored_hash = existing.get("passphrase_hash")
        if stored_hash:
            if not req.passphrase:
                raise HTTPException(401, "Passphrase required for this name")
            if db.hash_passphrase(req.passphrase) != stored_hash:
                raise HTTPException(401, "Wrong passphrase")
        elif req.passphrase:
            # Legacy user without passphrase — set it now
            await db.set_passphrase(existing["id"], req.passphrase)
        return {
            "user_id": existing["id"], "token": existing["token"],
            "display_name": existing["display_name"],
            "returning": True,
        }
    user = await db.create_user(req.display_name, req.passphrase)
    return {"user_id": user["id"], "token": user["token"], "display_name": user["display_name"], "returning": False}


@wager_router.get("/api/wager/auth/me")
async def get_me(user: dict = Depends(require_user)):
    return {
        "id": user["id"],
        "display_name": user["display_name"],
        "github_id": user.get("github_id"),
        "total_crowns_earned": user.get("total_crowns_earned", 0),
        "games_watched": user.get("games_watched", 0),
        "correct_bets": user.get("correct_bets", 0),
        "total_bets": user.get("total_bets", 0),
    }


# Admin GitHub IDs — comma-separated in env var, or default to NomadsandVagabonds
_ADMIN_GITHUB_IDS = set(
    os.environ.get("ADMIN_GITHUB_IDS", "170148445").split(",")
)


@wager_router.get("/api/wager/auth/is-admin")
async def check_admin(user: dict = Depends(require_user)):
    """Check if the authenticated user is an admin (GitHub-linked, allowed ID)."""
    github_id = user.get("github_id")
    is_admin = github_id is not None and str(github_id) in _ADMIN_GITHUB_IDS
    return {"is_admin": is_admin}


# ═══════════════════════════════════════════════════════════════════
# GITHUB OAUTH
# ═══════════════════════════════════════════════════════════════════

def _gh_client_id() -> str:
    return os.environ.get("GITHUB_CLIENT_ID", "")

def _gh_client_secret() -> str:
    return os.environ.get("GITHUB_CLIENT_SECRET", "")

def _frontend_url() -> str:
    return os.environ.get("FRONTEND_URL", "http://localhost:5173")


@wager_router.get("/api/wager/auth/github")
async def github_login(redirect: str = "/"):
    """Redirect to GitHub OAuth authorize page."""
    client_id = _gh_client_id()
    log.info("GitHub OAuth check: client_id=%s, has_secret=%s, github_keys=%s, total_env_count=%d, sample_keys=%s",
             client_id[:8] + '...' if client_id else 'EMPTY',
             bool(_gh_client_secret()),
             [k for k in os.environ if 'GITHUB' in k],
             len(os.environ),
             list(os.environ.keys())[:20])
    if not client_id:
        raise HTTPException(500, "GitHub OAuth not configured")
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "scope": "read:user",
        "state": redirect,
    })
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@wager_router.get("/api/wager/auth/github/callback")
async def github_callback(code: str, state: str = "/"):
    """Handle GitHub OAuth callback — exchange code for token, create/find user."""
    if not _gh_client_id() or not _gh_client_secret():
        raise HTTPException(500, "GitHub OAuth not configured")

    # Exchange code for access token
    try:
        token_data = await asyncio.to_thread(_github_exchange_code, code)
    except Exception as e:
        log.error("GitHub token exchange failed: %s", e)
        raise HTTPException(502, "GitHub authentication failed")

    access_token = token_data.get("access_token")
    if not access_token:
        log.error("No access_token in GitHub response: %s", token_data)
        raise HTTPException(502, "GitHub authentication failed")

    # Get GitHub user profile
    try:
        gh_user = await asyncio.to_thread(_github_get_user, access_token)
    except Exception as e:
        log.error("GitHub user fetch failed: %s", e)
        raise HTTPException(502, "Could not fetch GitHub profile")

    github_id = str(gh_user.get("id", ""))
    github_name = gh_user.get("login", "github_user")

    # Find or create wager user
    existing = await db.get_user_by_github_id(github_id)
    if existing:
        wager_token = existing["token"]
    else:
        user = await db.create_user_github(github_name, github_id)
        wager_token = user["token"]

    # Redirect to frontend with token
    redirect_path = state if state.startswith("/") else "/"
    sep = "&" if "?" in redirect_path else "?"
    frontend = _frontend_url()
    return RedirectResponse(f"{frontend}{redirect_path}{sep}wager_token={wager_token}")


def _github_exchange_code(code: str) -> dict:
    """Synchronous GitHub OAuth token exchange (run via to_thread)."""
    data = urllib.parse.urlencode({
        "client_id": _gh_client_id(),
        "client_secret": _gh_client_secret(),
        "code": code,
    }).encode()
    req = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=data,
        headers={"Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def _github_get_user(access_token: str) -> dict:
    """Synchronous GitHub API call to get user profile (run via to_thread)."""
    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


# ═══════════════════════════════════════════════════════════════════
# GAME SESSION
# ═══════════════════════════════════════════════════════════════════

@wager_router.post("/api/wager/games/{game_id}/join")
async def join_game(game_id: str, user: dict = Depends(require_user)):
    info = _get_runner_info(game_id)
    if info is None:
        # Try loading from disk (game might not be in memory yet)
        from botc.api.persistence import _GAMES_DIR
        import json
        saved_path = _GAMES_DIR / f"game_{game_id}.json"
        if not saved_path.exists():
            raise HTTPException(404, "Game not found")
        saved = json.loads(saved_path.read_text())
        players = saved.get("initial_state", {}).get("players", [])
        if not players:
            rd = saved.get("result", saved.get("result_data", {}))
            players = rd.get("players", []) if isinstance(rd, dict) else []
        info = {"running": False, "total_players": len(players) or 10, "phase": "game_over", "day_number": 0}

    # Ensure markets exist (works for both live and replay)
    await _ensure_markets(game_id, info.get("total_players", 10))

    session = await db.create_session(user["id"], game_id)
    bets = await db.get_bets(user["id"], game_id)
    return {
        "game_id": game_id,
        "crowns_budget": session["crowns_budget"],
        "crowns_won": session["crowns_won"],
        "settled": session["settled"],
        "bets": [_format_bet(b) for b in bets],
    }


@wager_router.get("/api/wager/games/{game_id}/session")
async def get_session(game_id: str, user: dict = Depends(require_user)):
    session = await db.get_session(user["id"], game_id)
    if not session:
        raise HTTPException(404, "No session for this game. Join first.")
    bets = await db.get_bets(user["id"], game_id)
    return {
        "game_id": game_id,
        "crowns_budget": session["crowns_budget"],
        "crowns_won": session["crowns_won"],
        "settled": session["settled"],
        "bets": [_format_bet(b) for b in bets],
    }


# ═══════════════════════════════════════════════════════════════════
# MARKETS & ODDS
# ═══════════════════════════════════════════════════════════════════

@wager_router.get("/api/wager/games/{game_id}/markets")
async def get_markets(game_id: str):
    """Get all markets and their current probabilities."""
    info = _get_runner_info(game_id)
    if not info:
        raise HTTPException(404, "Game not found")

    markets = await _ensure_markets(game_id, info.get("total_players", 10))

    result = []
    for m in markets.values():
        result.append({
            "market_id": m.market_id,
            "prob_yes": round(m.prob_yes, 4),
            "prob_no": round(m.prob_no, 4),
            "yes_pool": round(m.yes_pool, 1),
            "no_pool": round(m.no_pool, 1),
        })
    return {
        "game_id": game_id,
        "phase": info.get("phase", "unknown"),
        "day_number": info.get("day_number", 0),
        "markets": result,
    }


@wager_router.post("/api/wager/games/{game_id}/markets/create")
async def create_custom_market(game_id: str, question: str, initial_prob: float = 0.5, user: dict = Depends(require_user)):
    """Create a custom binary market (e.g. 'Will there be a double kill?')."""
    info = _get_runner_info(game_id)
    if not info:
        raise HTTPException(404, "Game not found")
    markets = await _ensure_markets(game_id, info.get("total_players", 10))

    # Generate a market_id from the question
    market_id = "custom_" + "".join(c if c.isalnum() else "_" for c in question.lower())[:40]
    if market_id in markets:
        raise HTTPException(400, "A market with this question already exists.")

    # Create with initial probability
    from .scoring import Market, DEFAULT_LIQUIDITY
    L = DEFAULT_LIQUIDITY
    p = max(0.05, min(0.95, initial_prob))
    yes_pool = L
    no_pool = L * p / (1 - p)
    m = Market(market_id=market_id, yes_pool=yes_pool, no_pool=no_pool)

    await db.create_market(game_id, market_id, m.yes_pool, m.no_pool)
    await db.record_market_history(game_id, market_id, m.prob_yes, "creation", user.get("display_name"))
    markets[market_id] = m

    return {
        "market_id": market_id,
        "question": question,
        "prob_yes": round(m.prob_yes, 4),
        "prob_no": round(m.prob_no, 4),
    }


@wager_router.get("/api/wager/games/{game_id}/markets/{market_id}/history")
async def get_market_history(game_id: str, market_id: str):
    """Get probability history for a market (for charting)."""
    history = await db.get_market_history(game_id, market_id)
    return {
        "market_id": market_id,
        "history": [
            {
                "prob_yes": round(h["prob_yes"], 4),
                "event_type": h["event_type"],
                "actor": h.get("actor"),
                "timestamp": h["timestamp"],
            }
            for h in history
        ],
    }


@wager_router.get("/api/wager/games/{game_id}/quote")
async def quote_bet(game_id: str, market_id: str, side: str, crowns: float):
    """Preview a bet: how many shares, what price, new probability."""
    info = _get_runner_info(game_id)
    if not info:
        raise HTTPException(404, "Game not found")

    markets = await _ensure_markets(game_id, info.get("total_players", 10))
    market = markets.get(market_id)
    if not market:
        raise HTTPException(404, f"Market '{market_id}' not found")

    if side == "yes":
        shares = market.quote_yes(crowns)
        current_prob = market.prob_yes
    else:
        shares = market.quote_no(crowns)
        current_prob = market.prob_no

    implied_payout = shares  # 1 Crown per share if correct
    implied_odds = shares / crowns if crowns > 0 else 0

    return {
        "market_id": market_id,
        "side": side,
        "crowns": crowns,
        "shares": round(shares, 2),
        "current_prob": round(current_prob, 4),
        "implied_odds": round(implied_odds, 3),
        "potential_payout": round(implied_payout, 2),
        "potential_profit": round(implied_payout - crowns, 2),
    }


# ═══════════════════════════════════════════════════════════════════
# BETTING
# ═══════════════════════════════════════════════════════════════════

@wager_router.post("/api/wager/games/{game_id}/bets")
async def place_bet(game_id: str, req: PlaceBetRequest, user: dict = Depends(require_user)):
    """Place a wager — buys shares in a prediction market."""
    info = _get_runner_info(game_id)
    if not info:
        raise HTTPException(404, "Game not found")

    session = await db.get_session(user["id"], game_id)
    if not session:
        raise HTTPException(400, "Join the game first.")
    if session["settled"]:
        raise HTTPException(403, "This game's wagers have been settled.")
    if session["crowns_budget"] < req.crowns:
        raise HTTPException(400, f"Insufficient Crowns. Thou hast {session['crowns_budget']:.0f} remaining.")

    markets = await _ensure_markets(game_id, info.get("total_players", 10))
    market = markets.get(req.market_id)
    if not market:
        raise HTTPException(404, f"Market '{req.market_id}' not found")

    # Record probability before the trade
    prob_before = market.prob_yes if req.side == "yes" else market.prob_no

    # Execute trade on the CPMM
    if req.side == "yes":
        shares = market.buy_yes(req.crowns)
    else:
        shares = market.buy_no(req.crowns)

    # Persist new pool state + record history
    await db.update_market_pools(game_id, req.market_id, market.yes_pool, market.no_pool)
    await db.record_market_history(game_id, req.market_id, market.prob_yes, "bet", user.get("display_name"))

    # Record the bet
    bet = await db.create_bet(
        session_id=session["id"],
        user_id=user["id"],
        game_id=game_id,
        market_id=req.market_id,
        side=req.side,
        crowns_spent=req.crowns,
        shares_acquired=shares,
        prob_at_purchase=prob_before,
        phase_placed=info.get("phase", "unknown"),
        day_placed=info.get("day_number", 0),
    )

    prob_after = market.prob_yes if req.side == "yes" else market.prob_no

    return _format_bet(bet) | {
        "prob_before": round(prob_before, 4),
        "prob_after": round(prob_after, 4),
        "market": {
            "market_id": market.market_id,
            "prob_yes": round(market.prob_yes, 4),
            "prob_no": round(market.prob_no, 4),
        },
    }


@wager_router.get("/api/wager/games/{game_id}/bets")
async def list_bets(game_id: str, user: dict = Depends(require_user)):
    bets = await db.get_bets(user["id"], game_id)
    return [_format_bet(b) for b in bets]


@wager_router.post("/api/wager/games/{game_id}/bets/{bet_id}/sell")
async def sell_bet(game_id: str, bet_id: int, user: dict = Depends(require_user)):
    """Sell shares back to the market at current price minus 10% spread."""
    bet = await db.get_bet(bet_id)
    if not bet or bet["user_id"] != user["id"]:
        raise HTTPException(404, "Bet not found")
    if bet["settled"]:
        raise HTTPException(400, "This wager hath been settled already.")

    info = _get_runner_info(game_id)
    if not info:
        raise HTTPException(404, "Game not found")

    markets = await _ensure_markets(game_id, info.get("total_players", 10))
    market = markets.get(bet["market_id"])
    if not market:
        raise HTTPException(404, "Market not found")

    shares = bet["shares_acquired"]
    side = bet["side"]

    # Sell shares back to CPMM
    if side == "yes":
        gross = market.sell_yes(shares)
    else:
        gross = market.sell_no(shares)

    # 10% market maker spread
    tax = gross * 0.10
    net = gross - tax

    # Update pool state + record history
    await db.update_market_pools(game_id, bet["market_id"], market.yes_pool, market.no_pool)
    await db.record_market_history(game_id, bet["market_id"], market.prob_yes, "sell", user.get("display_name"))

    # Mark bet as settled (sold) — store net as payout so frontend can distinguish sold vs lost
    await db.settle_bet(bet_id, correct=None, payout=net)
    await db.update_session_budget(bet["session_id"], net)

    return {
        "sold": True,
        "gross": round(gross, 1),
        "tax": round(tax, 1),
        "net": round(net, 1),
        "market": {
            "market_id": market.market_id,
            "prob_yes": round(market.prob_yes, 4),
            "prob_no": round(market.prob_no, 4),
        },
    }


@wager_router.post("/api/wager/games/{game_id}/settle")
async def trigger_settle(game_id: str, user: dict = Depends(require_user)):
    """Manually trigger settlement (for replay mode)."""
    from .settlement import settle_game
    result = await settle_game(game_id)
    # Reload user's session
    session = await db.get_session(user["id"], game_id)
    return {
        "settled": result.get("settled", 0),
        "session": {
            "crowns_won": session["crowns_won"] if session else 0,
            "settled": session["settled"] if session else False,
        },
    }


def _format_bet(bet: dict[str, Any]) -> dict[str, Any]:
    shares = bet.get("shares_acquired", 0)
    spent = bet.get("crowns_spent", 0)
    return {
        "id": bet["id"],
        "market_id": bet["market_id"],
        "side": bet["side"],
        "crowns_spent": round(spent, 1),
        "shares": round(shares, 2),
        "prob_at_purchase": round(bet.get("prob_at_purchase", 0.5), 4),
        "potential_payout": round(shares, 2),  # 1 Crown per share
        "potential_profit": round(shares - spent, 2),
        "phase_placed": bet["phase_placed"],
        "day_placed": bet["day_placed"],
        "settled": bet["settled"],
        "correct": bet.get("correct"),
        "crowns_payout": round(bet["crowns_payout"], 2) if bet.get("crowns_payout") is not None else None,
    }


# ═══════════════════════════════════════════════════════════════════
# LEADERBOARD
# ═══════════════════════════════════════════════════════════════════

@wager_router.get("/api/wager/leaderboard")
async def get_leaderboard():
    rows = await db.get_leaderboard(50)
    entries = []
    for rank, row in enumerate(rows, 1):
        total = row.get("total_bets", 0)
        correct = row.get("correct_bets", 0)
        entries.append({
            "rank": rank,
            "display_name": row["display_name"],
            "total_crowns_earned": row.get("total_crowns_earned", 0),
            "accuracy_pct": round(100 * correct / total, 1) if total > 0 else 0.0,
            "games_watched": row.get("games_watched", 0),
        })
    return entries


# ═══════════════════════════════════════════════════════════════════
# SPECTATOR WEBSOCKET
# ═══════════════════════════════════════════════════════════════════

@wager_router.websocket("/ws/spectator/{game_id}")
async def spectator_websocket(websocket: WebSocket, game_id: str):
    """Public-only event stream for spectators."""
    from botc.api.routes import _runners, _games
    from botc.api.websocket import ws_manager
    from botc.engine.state import snapshot_public
    from botc.monitor.event_filter import filter_public_events

    await ws_manager.connect(websocket, game_id)

    runner = _runners.get(game_id)
    if runner and runner.state:
        public_state = snapshot_public(runner.state)
        await websocket.send_json({"type": "game.state", "data": public_state})

        if runner.event_history:
            filtered = filter_public_events(runner.event_history)
            await websocket.send_json({"type": "event.history", "data": {"events": filtered}})

    elif game_id in _games:
        info = _games[game_id]
        if not info.get("events"):
            from botc.api.persistence import _GAMES_DIR
            import json
            saved_path = _GAMES_DIR / f"game_{game_id}.json"
            if saved_path.exists():
                try:
                    saved_data = json.loads(saved_path.read_text())
                    info["events"] = saved_data.get("events")
                    info["initial_state"] = saved_data.get("initial_state")
                except Exception:
                    log.exception("Failed to load game %s for spectator WS", game_id)

        initial = info.get("initial_state")
        if initial:
            public_initial = _strip_observer_from_state(initial)
            await websocket.send_json({"type": "game.state", "data": public_initial})
        if info.get("events"):
            filtered = filter_public_events(info["events"])
            await websocket.send_json({"type": "event.history", "data": {"events": filtered}})

    try:
        while True:
            data = await websocket.receive_json()
            command = data.get("command")
            if command == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, game_id)


def _strip_observer_from_state(state: dict[str, Any]) -> dict[str, Any]:
    result = {k: v for k, v in state.items() if k not in ("demon_bluffs", "rng_seed")}
    if "players" in result:
        result["players"] = [
            {
                "seat": p.get("seat"),
                "agent_id": p.get("agent_id", ""),
                "character_name": p.get("character_name", ""),
                "model_name": p.get("model_name", ""),
                "is_alive": p.get("is_alive", True),
                "ghost_vote_used": p.get("ghost_vote_used", False),
            }
            for p in result["players"]
        ]
    return result


# ═══════════════════════════════════════════════════════════════════
# SETTLEMENT BACKGROUND TASK
# ═══════════════════════════════════════════════════════════════════

_settled_games: set[str] = set()
_last_event_counts: dict[str, int] = {}  # game_id → last known event count
_last_phases: dict[str, str] = {}  # game_id → last known phase


async def _check_and_settle():
    from .settlement import settle_game
    runners, games = _get_game_state()

    # 1. Drive bot betting for running games
    for game_id, runner in runners.items():
        if not runner.state or game_id in _settled_games:
            continue

        total_players = len(runner.state.players)
        phase = runner.state.phase.value
        day = runner.state.day_number
        event_count = len(runner.event_history)

        # Only act if new events have arrived
        if event_count <= _last_event_counts.get(game_id, 0):
            continue
        _last_event_counts[game_id] = event_count

        # Detect phase change → tell bots
        if phase != _last_phases.get(game_id):
            _last_phases[game_id] = phase
            on_phase_change(game_id)

        # Ensure markets + bots exist
        try:
            markets = await _ensure_markets(game_id, total_players)
        except Exception:
            continue

        # Get bot manager and have bots bet
        mgr = _managers.get(game_id)
        if mgr:
            try:
                from botc.monitor.event_filter import filter_public_events
                public_events = filter_public_events(runner.event_history)
                results = await generate_bot_bets(mgr, markets, public_events, phase, day)
                if results:
                    log.info("Bots placed %d bets for game %s: %s",
                             len(results), game_id[:8],
                             ", ".join(f"{r['bot']}→{r['market'].split('_')[-1]} {r['side']}" for r in results))
            except Exception:
                log.exception("Bot betting error for game %s", game_id)

    # 2. Settle completed games
    for game_id, info in games.items():
        if game_id in _settled_games:
            continue
        status = info.get("status", "")
        if status in ("completed", "failed"):
            sessions = await db.get_unsettled_sessions(game_id)
            if sessions:
                log.info("Auto-settling bets for completed game %s", game_id)
                await settle_game(game_id)
            _settled_games.add(game_id)


async def settlement_loop():
    """Background task: drive bot bets + settle completed games."""
    while True:
        try:
            await _check_and_settle()
        except Exception:
            log.exception("Settlement/bot loop error")
        await asyncio.sleep(3)  # Check every 3s for snappier bot reactions
