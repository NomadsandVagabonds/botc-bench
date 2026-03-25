"""REST + WebSocket API routes."""

from __future__ import annotations

import asyncio
import base64
import json as json_mod
import logging
import os
import urllib.request
import urllib.parse
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from botc.api.persistence import load_all_games, save_game
from botc.api.websocket import ws_manager
from botc.engine.roles import load_script
from botc.engine.types import BreakoutConfig, GameConfig, ROLE_DISTRIBUTION, RoleType
from botc.llm.provider import AgentConfig
from botc.orchestrator.game_runner import GameResult, GameRunner
from botc.payments.cost_estimator import estimate_game_cost, estimate_monitor_cost, PAID_ALLOWED_MODELS

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory game registry — populated from disk on import
_games: dict[str, dict[str, Any]] = {}
_runners: dict[str, GameRunner] = {}

# Payment tracking: game_id → payment info
_payment_info: dict[str, dict[str, Any]] = {}


def _load_saved_games() -> None:
    """Load previously saved games from disk into the in-memory registry."""
    saved = load_all_games()
    for game_id, data in saved.items():
        status = data.get("status", "unknown")
        info: dict[str, Any] = {"status": status, "saved": True}
        if data.get("error"):
            info["error"] = data["error"]
        if data.get("result_data"):
            info["result_data"] = data["result_data"]
        elif data.get("result"):
            # New format: result is already a dict
            info["result_data"] = data["result"]
        if data.get("events"):
            info["events"] = data["events"]
        if data.get("initial_state"):
            info["initial_state"] = data["initial_state"]
        _games[game_id] = info
    if saved:
        logger.info("Loaded %d saved games from disk", len(saved))


# Load on module import (server startup)
_load_saved_games()


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class AgentConfigRequest(BaseModel):
    agent_id: str
    provider: str  # "anthropic" | "openai" | "google"
    model: str
    api_key: str
    temperature: float = 0.7


class BreakoutConfigRequest(BaseModel):
    num_rounds: int = 2
    messages_per_agent: int = 2
    max_groups: int = 4
    min_group_size: int = 2
    whispers_per_round: int = 1
    max_whisper_chars: int = 200


class CreateGameRequest(BaseModel):
    script: str = "trouble_brewing"
    num_players: int = 10
    agents: list[AgentConfigRequest]
    breakout: BreakoutConfigRequest = BreakoutConfigRequest()
    seed: int | None = None
    narrator_enabled: bool = False
    max_days: int = 20
    reveal_models: str = "true"  # "true" | "false" | "scramble"


class SeatModelConfig(BaseModel):
    provider: str  # "anthropic" | "openai" | "google"
    model: str  # actual model ID, e.g. "claude-haiku-4-5-20251001"


class ConfiguredGameRequest(BaseModel):
    script: str = "trouble_brewing"
    num_players: int = 10
    seat_models: list[SeatModelConfig]  # one per player
    seat_roles: list[str] | None = None  # optional pre-assigned role IDs per seat ('' = random for that seat)
    seat_characters: list[int | None] | None = None  # optional sprite IDs per seat
    seed: int | None = None
    max_days: int = 50
    reveal_models: str = "true"  # "true" | "false" | "scramble"
    share_stats: bool = False
    speech_style: str | None = None  # Optional speech style directive
    provider_keys: dict[str, str] | None = None  # Optional client-provided API keys (BYOK)


class GameResponse(BaseModel):
    game_id: str
    status: str
    winner: str | None = None
    total_days: int | None = None
    created_at: str | None = None     # ISO date string from file timestamp
    has_audio: bool = False
    has_monitors: bool = False


# Provider name → environment variable name
_PROVIDER_ENV_KEYS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


MAX_CONCURRENT_GAMES = 10


async def require_auth(request: Request) -> dict:
    """Require a valid wager_token for protected endpoints.

    Returns the user dict if authenticated, raises 401 otherwise.
    On localhost, allows unauthenticated access for local dev.
    """
    host = request.headers.get("host", "")
    if "localhost" in host or "127.0.0.1" in host:
        return {"github_id": "local", "github_login": "local"}

    token = request.headers.get("X-Wager-Token")
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    from botc.wager.db import get_db
    db = get_db()
    user = db.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


def _check_concurrent_limit() -> None:
    """Raise 429 if too many games are already running."""
    running = sum(1 for info in _games.values() if info.get("status") == "running")
    if running >= MAX_CONCURRENT_GAMES:
        raise HTTPException(
            status_code=429,
            detail=f"Server limit: {MAX_CONCURRENT_GAMES} concurrent game(s). Please wait for a game to finish.",
        )


def _mark_game_failed(runner: GameRunner, exc: Exception) -> None:
    """Persist failure status so clients can show useful errors."""
    game_id = runner.state.game_id if runner.state else "pending"
    error_msg = str(exc) or exc.__class__.__name__
    _games[game_id] = {
        "status": "failed",
        "error": error_msg,
    }
    # Save to disk so failed games survive restarts
    try:
        save_game(
            game_id,
            "failed",
            events=runner.event_history if runner.event_history else None,
            error=error_msg,
        )
    except Exception:
        logger.exception("Failed to save game %s to disk", game_id)


def _save_to_github(game_id: str, content: str) -> None:
    """Save game JSON to GitHub repo (non-blocking, best-effort)."""
    token = os.environ.get("GITHUB_REPO_TOKEN", "")
    if not token:
        return
    repo = os.environ.get("GITHUB_REPO", "NomadsandVagabonds/botc-bench")
    path = f"backend/games/game_{game_id}.json"
    url = f"https://api.github.com/repos/{repo}/contents/{path}"
    body = json_mod.dumps({
        "message": f"Auto-save game {game_id[:8]}",
        "content": base64.b64encode(content.encode()).decode(),
    }).encode()
    req = urllib.request.Request(url, data=body, method="PUT", headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            logger.info("Game %s saved to GitHub (%d)", game_id[:8], resp.status)
    except Exception as e:
        logger.warning("Failed to save game %s to GitHub: %s", game_id[:8], e)


def _save_completed_game(runner: GameRunner, result: GameResult) -> None:
    """Save a completed game's result and full event history to disk."""
    game_id = result.game_id
    result_data = {
        "game_id": result.game_id,
        "winner": result.winner,
        "win_condition": result.win_condition,
        "total_days": result.total_days,
        "players": result.players,
        "token_summary": result.token_summary,
        "duration_seconds": result.duration_seconds,
    }
    # Use the snapshot captured at game start (not the mutated final state)
    initial_state = runner._initial_snapshot

    try:
        save_game(
            game_id,
            "completed",
            result=result_data,
            events=runner.event_history,
            initial_state=initial_state,
        )
    except Exception:
        logger.exception("Failed to save game %s to disk", game_id)

    # Auto-save to GitHub (best-effort, non-blocking)
    try:
        from botc.api.persistence import _GAMES_DIR
        game_path = _GAMES_DIR / f"game_{game_id}.json"
        if game_path.exists():
            asyncio.get_event_loop().run_in_executor(
                None, _save_to_github, game_id, game_path.read_text()
            )
    except Exception:
        logger.warning("GitHub auto-save skipped for game %s", game_id)


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@router.post("/api/games", response_model=GameResponse)
async def create_game(request: CreateGameRequest) -> GameResponse:
    """Create and start a new game."""
    _check_concurrent_limit()
    if len(request.agents) != request.num_players:
        raise HTTPException(
            status_code=422,
            detail=f"Need {request.num_players} agents, got {len(request.agents)}",
        )

    game_config = GameConfig(
        script=request.script,
        num_players=request.num_players,
        breakout=BreakoutConfig(
            num_rounds=request.breakout.num_rounds,
            messages_per_agent=request.breakout.messages_per_agent,
            max_groups=request.breakout.max_groups,
            min_group_size=request.breakout.min_group_size,
            whispers_per_round=request.breakout.whispers_per_round,
            max_whisper_chars=request.breakout.max_whisper_chars,
        ),
        seed=request.seed,
        narrator_enabled=request.narrator_enabled,
        max_days=request.max_days,
        reveal_models=request.reveal_models,
    )

    agent_configs = [
        AgentConfig(
            agent_id=a.agent_id,
            provider=a.provider,
            model=a.model,
            api_key=a.api_key,
            temperature=a.temperature,
        )
        for a in request.agents
    ]

    def on_event(event_type: str, data: dict) -> None:
        asyncio.create_task(ws_manager.broadcast(runner.state.game_id, event_type, data))

    runner = GameRunner(game_config, agent_configs, on_event=on_event)

    # Start the game in the background
    async def run_game():
        try:
            result = await runner.run()
            game_id = result.game_id
            _games[game_id] = {
                "status": "completed",
                "result": result,
            }
            _save_completed_game(runner, result)
            logger.info("Game %s completed: %s wins", game_id, result.winner)
        except Exception as e:
            logger.exception("Game failed")
            _mark_game_failed(runner, e)

    task = asyncio.create_task(run_game())

    # Wait briefly for game_id to be assigned
    await asyncio.sleep(0.1)
    game_id = runner.state.game_id if runner.state else "pending"

    _games[game_id] = {"status": "running", "runner": runner, "task": task}
    _runners[game_id] = runner

    return GameResponse(game_id=game_id, status="running")


@router.post("/api/games/configured", response_model=GameResponse)
async def configured_game(request: ConfiguredGameRequest) -> GameResponse:
    """Start a game with per-seat model choices, using server-side API keys from .env.

    Bridges the gap between /api/games (requires per-agent API keys in the request)
    and /api/games/quick (ignores model choices, round-robins automatically).
    """
    _check_concurrent_limit()
    if len(request.seat_models) != request.num_players:
        raise HTTPException(
            status_code=422,
            detail=f"Need {request.num_players} seat_models, got {len(request.seat_models)}",
        )

    # Collect required providers and look up their API keys
    # Priority: client-provided keys > server .env
    required_providers = {sm.provider for sm in request.seat_models}
    provider_keys: dict[str, str] = {}
    missing: list[str] = []

    for provider in required_providers:
        # Check client-provided keys first (BYOK mode)
        if request.provider_keys and provider in request.provider_keys:
            provider_keys[provider] = request.provider_keys[provider]
            continue
        # Fall back to server .env
        env_var = _PROVIDER_ENV_KEYS.get(provider)
        if not env_var:
            raise HTTPException(
                status_code=422,
                detail=f"Unknown provider: {provider}. Valid providers: {list(_PROVIDER_ENV_KEYS.keys())}",
            )
        key = os.environ.get(env_var, "")
        if not key:
            missing.append(f"{env_var} (for {provider})")
        else:
            provider_keys[provider] = key

    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing API keys — provide them in provider_keys or set in server .env: {', '.join(missing)}",
        )

    # Build agent configs — agent_ids are placeholders; setup.py assigns character names
    agent_configs = [
        AgentConfig(
            agent_id=f"seat-{i}",
            provider=sm.provider,
            model=sm.model,
            api_key=provider_keys[sm.provider],
            temperature=0.8,
        )
        for i, sm in enumerate(request.seat_models)
    ]

    # Validate seat_roles if provided — fail fast with 422 before starting background task
    if request.seat_roles is not None:
        if len(request.seat_roles) != request.num_players:
            raise HTTPException(
                status_code=422,
                detail=f"seat_roles has {len(request.seat_roles)} entries, need {request.num_players}",
            )
        # Validate role IDs exist and distribution is correct
        # Support partial assignment: empty strings ('') mean "random for this seat"
        has_random = any(r == '' for r in request.seat_roles)
        try:
            script_data = load_script(request.script)
            if has_random:
                from botc.engine.setup import _resolve_partial_roles
                import random as _rng
                _resolve_partial_roles(request.num_players, request.seat_roles, script_data, _rng.Random(0))
            else:
                from botc.engine.setup import _resolve_assigned_roles
                _resolve_assigned_roles(request.num_players, request.seat_roles, script_data)
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(status_code=422, detail=str(e))

    game_config = GameConfig(
        script=request.script,
        num_players=request.num_players,
        breakout=BreakoutConfig(
            num_rounds=1,
            messages_per_agent=2,
            max_groups=3,
            min_group_size=2,
            whispers_per_round=1,
            max_whisper_chars=150,
        ),
        opening_statements=True,
        breakout_min_players=6,
        seed=request.seed,
        max_days=request.max_days,
        max_concurrent_llm_calls=3,
        reveal_models=request.reveal_models,
        share_stats=request.share_stats,
        seat_roles=request.seat_roles,
        seat_characters=request.seat_characters,
        speech_style=request.speech_style,
    )

    def on_event(event_type: str, data: dict) -> None:
        if runner.state:
            asyncio.create_task(
                ws_manager.broadcast(runner.state.game_id, event_type, data)
            )

    runner = GameRunner(game_config, agent_configs, on_event=on_event)

    async def run_game():
        try:
            result = await runner.run()
            game_id = result.game_id
            _games[game_id] = {"status": "completed", "result": result}
            _save_completed_game(runner, result)
            logger.info("Game %s completed: %s wins", game_id, result.winner)
        except Exception as e:
            logger.exception("Game failed")
            _mark_game_failed(runner, e)

    task = asyncio.create_task(run_game())

    await asyncio.sleep(0.2)
    game_id = runner.state.game_id if runner.state else "pending"
    _games[game_id] = {"status": "running", "runner": runner, "task": task}
    _runners[game_id] = runner

    return GameResponse(game_id=game_id, status="running")


@router.post("/api/games/quick", response_model=GameResponse)
async def quick_game(
    num_players: int = 7,
    seed: int = 99,
    reveal_models: str = "true",
    post_vote_discussion: bool = True,
) -> GameResponse:
    """Start a game using API keys from environment variables.

    Round-robins across available providers (Anthropic, OpenAI, Google).
    """
    _check_concurrent_limit()
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    google_key = os.environ.get("GOOGLE_API_KEY", "")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY", "")

    providers: list[tuple[str, str, str, str]] = []
    if anthropic_key:
        providers.append(("anthropic", "claude-haiku-4-5-20251001", anthropic_key, "Claude"))
    if openai_key:
        providers.append(("openai", "gpt-4o-mini", openai_key, "GPT"))
    if google_key:
        providers.append(("google", "gemini-2.5-flash", google_key, "Gemini"))
    if openrouter_key:
        providers.append(("openrouter", "openai/gpt-4o-mini", openrouter_key, "OR"))

    if not providers:
        raise HTTPException(
            status_code=400,
            detail="No API keys found in environment",
        )

    agent_configs = [
        AgentConfig(
            agent_id=f"{providers[i % len(providers)][3]}-{i}",
            provider=providers[i % len(providers)][0],
            model=providers[i % len(providers)][1],
            api_key=providers[i % len(providers)][2],
            temperature=0.8,
        )
        for i in range(num_players)
    ]

    game_config = GameConfig(
        script="trouble_brewing",
        num_players=num_players,
        breakout=BreakoutConfig(
            num_rounds=1,
            messages_per_agent=2,
            max_groups=3,
            min_group_size=2,
            whispers_per_round=1,
            max_whisper_chars=150,
        ),
        opening_statements=True,
        post_vote_discussion=post_vote_discussion,
        breakout_min_players=6,
        seed=seed,
        max_days=50,  # Safety only — real BotC has no day limit
        max_concurrent_llm_calls=3,
        reveal_models=reveal_models,
    )

    def on_event(event_type: str, data: dict) -> None:
        if runner.state:
            asyncio.create_task(
                ws_manager.broadcast(runner.state.game_id, event_type, data)
            )

    runner = GameRunner(game_config, agent_configs, on_event=on_event)

    async def run_game():
        try:
            result = await runner.run()
            game_id = result.game_id
            _games[game_id] = {"status": "completed", "result": result}
            _save_completed_game(runner, result)
            logger.info("Game %s completed: %s wins", game_id, result.winner)
        except Exception as e:
            logger.exception("Game failed")
            _mark_game_failed(runner, e)

    task = asyncio.create_task(run_game())

    await asyncio.sleep(0.2)
    game_id = runner.state.game_id if runner.state else "pending"
    _games[game_id] = {"status": "running", "runner": runner, "task": task}
    _runners[game_id] = runner

    return GameResponse(game_id=game_id, status="running")


@router.post("/api/games/{game_id}/stop")
async def stop_game(game_id: str) -> dict:
    """Stop a running game immediately."""
    if game_id not in _games:
        raise HTTPException(status_code=404, detail="Game not found")

    info = _games[game_id]
    if info["status"] != "running":
        return {"game_id": game_id, "status": info["status"], "message": "Game is not running"}

    # Cancel the async task
    task = info.get("task")
    if task and not task.done():
        task.cancel()

    _games[game_id] = {"status": "stopped"}
    if game_id in _runners:
        del _runners[game_id]

    logger.info("Game %s stopped by user", game_id)
    return {"game_id": game_id, "status": "stopped", "message": "Game stopped"}


@router.get("/api/games")
async def list_games() -> list[GameResponse]:
    """List all games."""
    from botc.api.persistence import _GAMES_DIR
    from datetime import datetime

    results = []
    for game_id, info in _games.items():
        resp = GameResponse(game_id=game_id, status=info["status"])
        if "result" in info:
            # Live game — GameResult dataclass
            result: GameResult = info["result"]
            resp.winner = result.winner
            resp.total_days = result.total_days
        elif "result_data" in info:
            # Loaded from disk — plain dict
            rd = info["result_data"]
            resp.winner = rd.get("winner")
            resp.total_days = rd.get("total_days")

        # Timestamp: prefer stored created_at, fall back to first event ts, then file mtime
        game_path = _GAMES_DIR / f"game_{game_id}.json"
        ts = info.get("created_at")
        if not ts and "events" in info and info["events"]:
            ts = info["events"][0].get("ts")
        if not ts and game_path.exists():
            ts = game_path.stat().st_mtime
        if ts:
            resp.created_at = datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d %H:%M")
        resp.has_audio = (_GAMES_DIR / f"audio_{game_id}").is_dir()
        resp.has_monitors = any(_GAMES_DIR.glob(f"monitor_{game_id}_*.json"))

        results.append(resp)
    return results


@router.get("/api/games/{game_id}")
async def get_game(game_id: str) -> dict:
    """Get game state or result."""
    if game_id not in _games:
        return {"error": "Game not found"}

    info = _games[game_id]

    # Live completed game (GameResult dataclass in memory)
    if info["status"] == "completed" and "result" in info:
        result: GameResult = info["result"]
        return {
            "game_id": result.game_id,
            "status": "completed",
            "winner": result.winner,
            "win_condition": result.win_condition,
            "total_days": result.total_days,
            "players": result.players,
            "token_summary": result.token_summary,
            "duration_seconds": result.duration_seconds,
        }

    # Loaded from disk (plain dict)
    if info["status"] == "completed" and "result_data" in info:
        rd = info["result_data"]
        return {
            "game_id": rd.get("game_id", game_id),
            "status": "completed",
            "winner": rd.get("winner"),
            "win_condition": rd.get("win_condition"),
            "total_days": rd.get("total_days"),
            "players": rd.get("players", []),
            "token_summary": rd.get("token_summary", {}),
            "duration_seconds": rd.get("duration_seconds"),
        }

    if info["status"] != "running":
        return {
            "game_id": game_id,
            "status": info["status"],
            "error": info.get("error"),
        }

    runner = _runners.get(game_id)
    if runner and runner.state:
        from botc.engine.state import snapshot_observer
        return {
            "game_id": game_id,
            "status": "running",
            "state": snapshot_observer(runner.state),
        }

    return {"game_id": game_id, "status": info["status"]}


@router.get("/api/games/{game_id}/download")
async def download_game(game_id: str):
    """Download the full game JSON file."""
    from botc.api.persistence import _GAMES_DIR
    game_path = _GAMES_DIR / f"game_{game_id}.json"
    if game_path.exists():
        return FileResponse(
            game_path,
            media_type="application/json",
            filename=f"game_{game_id}.json",
        )
    raise HTTPException(404, "Game file not found")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/api/stats/models")
async def model_stats() -> dict:
    """Return aggregate per-model performance stats from saved games."""
    from botc.api.stats import compute_model_stats
    return compute_model_stats()


@router.get("/api/stats/leaderboard")
async def leaderboard_stats() -> dict:
    """Extended leaderboard: nominations, votes, kills, tokens, role breakdown."""
    from botc.api.stats import compute_leaderboard_stats
    return compute_leaderboard_stats()


# ---------------------------------------------------------------------------
# Event Scheduling (for live game events with Crown's Wager)
# ---------------------------------------------------------------------------

from pathlib import Path as _Path
_EVENTS_FILE = _Path(__file__).parent.parent.parent / "events.json"


class ScheduleEventRequest(BaseModel):
    start_time: str  # ISO 8601
    prize_pool: int = 300
    title: str = "The Trial"
    description: str | None = None


@router.post("/api/events/schedule")
async def schedule_event(request: ScheduleEventRequest) -> dict:
    """Schedule a live game event with a countdown and prize pool."""
    data = request.model_dump()
    _EVENTS_FILE.write_text(json_mod.dumps(data))
    logger.info("Event scheduled: %s at %s ($%d)", data["title"], data["start_time"], data["prize_pool"])
    return data


@router.get("/api/events/next")
async def get_next_event() -> dict:
    """Get the next scheduled event (if any)."""
    if _EVENTS_FILE.exists():
        try:
            return json_mod.loads(_EVENTS_FILE.read_text())
        except Exception:
            return {}
    return {}


@router.delete("/api/events/next")
async def clear_event() -> dict:
    """Clear the scheduled event."""
    if _EVENTS_FILE.exists():
        _EVENTS_FILE.unlink()
    return {"status": "cleared"}


# ---------------------------------------------------------------------------
# Payments / Stripe
# ---------------------------------------------------------------------------


class EstimateCostRequest(BaseModel):
    num_players: int
    seat_models: list[SeatModelConfig]
    max_days: int = 20


class CheckoutRequest(BaseModel):
    num_players: int
    seat_models: list[SeatModelConfig]
    seat_roles: list[str] | None = None
    seat_characters: list[int | None] | None = None
    seed: int | None = None
    max_days: int = 50
    reveal_models: str = "true"
    share_stats: bool = False
    speech_style: str | None = None
    script: str = "trouble_brewing"


class RefundRequest(BaseModel):
    reason: str = "game_failed"


@router.post("/api/estimate-cost")
async def api_estimate_cost(request: EstimateCostRequest) -> dict:
    """Return a cost estimate for a game configuration."""
    models = [sm.model for sm in request.seat_models]
    estimate = estimate_game_cost(request.num_players, models, request.max_days)
    return estimate


@router.post("/api/checkout")
async def api_create_checkout(request: CheckoutRequest) -> dict:
    """Create a Stripe Checkout session for a paid game.

    Returns {url, session_id} — frontend redirects the user to url.
    """
    stripe_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not stripe_key:
        raise HTTPException(
            status_code=503,
            detail="Stripe payments not configured on this server",
        )

    # Validate models — paid games are restricted to cheap/high-rate-limit models
    models = [sm.model for sm in request.seat_models]
    disallowed = [m for m in models if m not in PAID_ALLOWED_MODELS]
    if disallowed:
        allowed_list = ", ".join(sorted(PAID_ALLOWED_MODELS))
        raise HTTPException(
            status_code=422,
            detail=f"Paid games only support: {allowed_list}. "
                   f"Use your own API keys for: {', '.join(set(disallowed))}",
        )
    estimate = estimate_game_cost(request.num_players, models, request.max_days)

    # Build the game config to store in Stripe metadata
    game_config = {
        "script": request.script,
        "num_players": request.num_players,
        "seat_models": [{"provider": sm.provider, "model": sm.model} for sm in request.seat_models],
        "max_days": request.max_days,
        "reveal_models": request.reveal_models,
        "share_stats": request.share_stats,
        "speech_style": request.speech_style,
        "seed": request.seed,
    }
    if request.seat_roles:
        game_config["seat_roles"] = request.seat_roles
    if request.seat_characters:
        game_config["seat_characters"] = request.seat_characters

    from botc.payments.stripe_handler import create_checkout_session
    result = await create_checkout_session(
        game_config=game_config,
        charge_amount=estimate["charge_amount"],
        estimated_cost=estimate["estimated_cost"],
        item_type="game",
    )

    return {
        **result,
        "estimate": estimate,
    }


@router.post("/api/webhook/stripe")
async def stripe_webhook(request: Request) -> dict:
    """Stripe webhook — handles checkout.session.completed to start paid games."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    from botc.payments.stripe_handler import verify_webhook_signature

    try:
        event = verify_webhook_signature(payload, sig_header)
    except (ValueError, RuntimeError) as e:
        logger.warning("Stripe webhook verification failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    event_type = event.get("type", "")
    logger.info("Stripe webhook: %s", event_type)

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        item_type = metadata.get("type", "game")
        payment_intent_id = session.get("payment_intent", "")

        if item_type == "game":
            try:
                game_config_raw = json_mod.loads(metadata.get("game_config", "{}"))
                await _start_paid_game(game_config_raw, payment_intent_id, metadata)
            except Exception:
                logger.exception("Failed to start paid game from Stripe webhook")
                # Attempt refund on failure
                try:
                    from botc.payments.stripe_handler import issue_refund
                    await issue_refund(payment_intent_id, reason="requested_by_customer")
                    logger.info("Auto-refunded failed game start for pi %s", payment_intent_id)
                except Exception:
                    logger.exception("Auto-refund also failed for pi %s", payment_intent_id)

    return {"status": "ok"}


async def _start_paid_game(game_config_raw: dict, payment_intent_id: str, metadata: dict) -> None:
    """Start a game using server API keys after successful Stripe payment."""
    num_players = game_config_raw["num_players"]
    seat_models_raw = game_config_raw["seat_models"]

    # Collect server-side API keys
    required_providers = {sm["provider"] for sm in seat_models_raw}
    provider_keys: dict[str, str] = {}

    for provider in required_providers:
        env_var = _PROVIDER_ENV_KEYS.get(provider)
        if not env_var:
            raise ValueError(f"Unknown provider: {provider}")
        key = os.environ.get(env_var, "")
        if not key:
            raise ValueError(f"Server missing {env_var} for paid game")
        provider_keys[provider] = key

    agent_configs = [
        AgentConfig(
            agent_id=f"seat-{i}",
            provider=sm["provider"],
            model=sm["model"],
            api_key=provider_keys[sm["provider"]],
            temperature=0.8,
        )
        for i, sm in enumerate(seat_models_raw)
    ]

    game_config = GameConfig(
        script=game_config_raw.get("script", "trouble_brewing"),
        num_players=num_players,
        breakout=BreakoutConfig(
            num_rounds=1,
            messages_per_agent=2,
            max_groups=3,
            min_group_size=2,
            whispers_per_round=1,
            max_whisper_chars=150,
        ),
        opening_statements=True,
        breakout_min_players=6,
        seed=game_config_raw.get("seed"),
        max_days=game_config_raw.get("max_days", 50),
        max_concurrent_llm_calls=3,
        reveal_models=game_config_raw.get("reveal_models", "true"),
        share_stats=game_config_raw.get("share_stats", False),
        seat_roles=game_config_raw.get("seat_roles"),
        seat_characters=game_config_raw.get("seat_characters"),
        speech_style=game_config_raw.get("speech_style"),
    )

    def on_event(event_type: str, data: dict) -> None:
        if runner.state:
            asyncio.create_task(
                ws_manager.broadcast(runner.state.game_id, event_type, data)
            )

    runner = GameRunner(game_config, agent_configs, on_event=on_event)

    async def run_game():
        try:
            result = await runner.run()
            game_id = result.game_id
            _games[game_id] = {"status": "completed", "result": result}
            _save_completed_game(runner, result)

            # Track actual cost vs charged amount
            actual_cost = result.token_summary.get("total_cost_usd", 0) if isinstance(result.token_summary, dict) else 0
            _payment_info[game_id] = {
                "payment_intent_id": payment_intent_id,
                "charged_amount": float(metadata.get("charge_amount", 0)),
                "estimated_cost": float(metadata.get("estimated_cost", 0)),
                "actual_cost": actual_cost,
                "payment_method": "stripe",
            }

            logger.info("Paid game %s completed: %s wins (actual cost: $%.2f)", game_id, result.winner, actual_cost)
        except Exception as e:
            logger.exception("Paid game failed")
            _mark_game_failed(runner, e)
            # Auto-refund on failure
            try:
                from botc.payments.stripe_handler import issue_refund
                await issue_refund(payment_intent_id, reason="requested_by_customer")
                logger.info("Auto-refunded failed game for pi %s", payment_intent_id)
            except Exception:
                logger.exception("Auto-refund failed for pi %s", payment_intent_id)

    task = asyncio.create_task(run_game())

    await asyncio.sleep(0.2)
    game_id = runner.state.game_id if runner.state else "pending"
    _games[game_id] = {"status": "running", "runner": runner, "task": task}
    _runners[game_id] = runner

    logger.info("Paid game %s started (pi: %s)", game_id, payment_intent_id)


@router.post("/api/refund/{game_id}")
async def refund_game(game_id: str, body: RefundRequest | None = None) -> dict:
    """Refund a Stripe-paid game (full refund)."""
    payment = _payment_info.get(game_id)
    if not payment:
        raise HTTPException(status_code=404, detail="No payment record for this game")

    pi_id = payment.get("payment_intent_id")
    if not pi_id:
        raise HTTPException(status_code=400, detail="No payment intent to refund")

    if payment.get("refunded"):
        return {"status": "already_refunded", "game_id": game_id}

    from botc.payments.stripe_handler import issue_refund
    reason = body.reason if body else "requested_by_customer"
    refund = await issue_refund(pi_id, reason=reason)

    payment["refunded"] = True
    payment["refund_id"] = refund.get("id")
    payment["refund_amount"] = refund.get("amount", 0) / 100

    return {
        "status": "refunded",
        "game_id": game_id,
        "refund_amount": payment["refund_amount"],
    }


@router.get("/api/payment-status")
async def payment_status(session_id: str) -> dict:
    """Check if a Stripe checkout session has been completed and return the game_id."""
    from botc.payments.stripe_handler import get_session

    try:
        session = get_session(session_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to retrieve session: {e}")

    status = session.get("status", "unknown")
    payment_status_val = session.get("payment_status", "unknown")

    # Find the game started by this payment
    pi_id = session.get("payment_intent", "")
    game_id = None
    for gid, pinfo in _payment_info.items():
        if pinfo.get("payment_intent_id") == pi_id:
            game_id = gid
            break

    return {
        "session_status": status,
        "payment_status": payment_status_val,
        "game_id": game_id,
    }


@router.get("/api/stripe-config")
async def stripe_config() -> dict:
    """Return the Stripe publishable key for the frontend."""
    pk = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
    return {
        "publishable_key": pk,
        "payments_enabled": bool(pk and os.environ.get("STRIPE_SECRET_KEY", "")),
        "paid_allowed_models": sorted(PAID_ALLOWED_MODELS),
    }


# ---------------------------------------------------------------------------
# TTS / Audio
# ---------------------------------------------------------------------------

@router.get("/api/games/{game_id}/audio/manifest")
async def audio_manifest(game_id: str) -> dict:
    """Return the TTS audio manifest for a game (clip list with durations and event mapping)."""
    from botc.tts.generate import GAMES_DIR
    manifest_path = GAMES_DIR / f"audio_{game_id}" / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="No audio generated for this game")
    import json
    return {"game_id": game_id, "clips": json.loads(manifest_path.read_text())}


@router.get("/api/games/{game_id}/audio/{filename}")
async def audio_clip(game_id: str, filename: str) -> FileResponse:
    """Serve an individual audio clip MP3."""
    from botc.tts.generate import GAMES_DIR
    # Sanitize filename to prevent path traversal
    safe_name = Path(filename).name
    if not safe_name.endswith(".mp3") or safe_name != filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    clip_path = GAMES_DIR / f"audio_{game_id}" / safe_name
    if not clip_path.exists():
        raise HTTPException(status_code=404, detail="Audio clip not found")
    return FileResponse(clip_path, media_type="audio/mpeg")


@router.post("/api/games/{game_id}/audio/generate")
async def generate_audio(game_id: str) -> dict:
    """Generate TTS audio for a saved game (idempotent — skips existing clips)."""
    from botc.tts.generate import generate_game_audio, GAMES_DIR
    game_path = GAMES_DIR / f"game_{game_id}.json"
    if not game_path.exists():
        raise HTTPException(status_code=404, detail="Game not found")

    # Run in thread to avoid blocking the event loop
    import asyncio
    loop = asyncio.get_event_loop()
    out_dir = await loop.run_in_executor(None, lambda: generate_game_audio(game_id))

    import json
    manifest_path = out_dir / "manifest.json"
    clips = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    return {"game_id": game_id, "clips_generated": len(clips), "audio_dir": str(out_dir)}


# ---------------------------------------------------------------------------
# Monitor
# ---------------------------------------------------------------------------

class MonitorRequest(BaseModel):
    provider: str
    model: str
    temperature: float = 0.3
    include_groups: bool = False


@router.post("/api/games/{game_id}/monitors")
async def start_monitor(game_id: str, request: MonitorRequest) -> dict:
    """Start a monitor analysis on a completed game."""
    if game_id not in _games:
        raise HTTPException(status_code=404, detail="Game not found")
    info = _games[game_id]
    if info.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Can only monitor completed games")

    # Get API key from environment
    env_var = _PROVIDER_ENV_KEYS.get(request.provider)
    if not env_var:
        raise HTTPException(status_code=422, detail=f"Unknown provider: {request.provider}")
    api_key = os.environ.get(env_var, "")
    if not api_key:
        raise HTTPException(status_code=400, detail=f"Missing {env_var} in server .env")

    from botc.monitor.runner import MonitorRunner

    def on_monitor_event(event_type: str, data: dict) -> None:
        asyncio.create_task(ws_manager.broadcast(game_id, event_type, data))

    runner = MonitorRunner(
        game_id=game_id,
        provider=request.provider,
        model=request.model,
        api_key=api_key,
        temperature=request.temperature,
        include_groups=request.include_groups,
        on_event=on_monitor_event,
    )

    async def run_monitor():
        try:
            result = await runner.run()
            logger.info("Monitor %s completed for game %s (score: %.1f)",
                       result["monitor_id"], game_id, result["scores"]["total"])
        except Exception:
            logger.exception("Monitor failed for game %s", game_id)

    asyncio.create_task(run_monitor())
    return {"status": "started", "game_id": game_id, "monitor_id": runner.monitor_id}


@router.get("/api/games/{game_id}/monitors")
async def list_monitors(game_id: str) -> list[dict]:
    """List all monitor results for a game."""
    from botc.monitor.persistence import load_monitor_results
    return load_monitor_results(game_id)


@router.get("/api/games/{game_id}/monitors/{monitor_id}")
async def get_monitor(game_id: str, monitor_id: str) -> dict:
    """Get a specific monitor result."""
    from botc.monitor.persistence import load_monitor_result
    result = load_monitor_result(game_id, monitor_id)
    if not result:
        raise HTTPException(status_code=404, detail="Monitor result not found")
    return result


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@router.websocket("/ws/game/{game_id}")
async def game_websocket(websocket: WebSocket, game_id: str):
    """WebSocket endpoint for live game observation."""
    await ws_manager.connect(websocket, game_id)

    # Send current state if game is running (live runner in memory)
    runner = _runners.get(game_id)
    if runner and runner.state:
        from botc.engine.state import snapshot_observer
        await websocket.send_json({
            "type": "game.state",
            "data": snapshot_observer(runner.state),
        })

        # Replay historical events so late-joining clients can catch up.
        if runner.event_history:
            await websocket.send_json({
                "type": "event.history",
                "data": {
                    "events": runner.event_history,
                },
            })

    elif game_id in _games:
        # Completed or saved game — try to serve from disk or in-memory save data
        info = _games[game_id]

        # If not already loaded from disk, try loading the saved JSON file
        if not info.get("saved") and not info.get("events"):
            from botc.api.persistence import _GAMES_DIR
            saved_path = _GAMES_DIR / f"game_{game_id}.json"
            if saved_path.exists():
                import json
                try:
                    saved_data = json.loads(saved_path.read_text())
                    info["events"] = saved_data.get("events")
                    info["initial_state"] = saved_data.get("initial_state")
                    info["result_data"] = saved_data.get("result", saved_data.get("result_data"))
                    info["saved"] = True
                except Exception:
                    logger.exception("Failed to load game %s for WebSocket", game_id)
        initial = info.get("initial_state")

        # Legacy games may not have initial_state — synthesize from result_data
        if not initial and info.get("result_data"):
            rd = info["result_data"]
            initial = {
                "game_id": rd.get("game_id", game_id),
                "phase": "game_over",
                "day_number": rd.get("total_days", 0),
                "players": [
                    {
                        "seat": p.get("seat", i),
                        "agent_id": p.get("agent_id", f"seat-{i}"),
                        "character_name": p.get("character_name", p.get("agent_id", f"Player {i}")),
                        "model_name": p.get("model", ""),
                        "role": p.get("role", ""),
                        "role_id": p.get("role", "").lower().replace(" ", "_"),
                        "role_type": "",
                        "alignment": p.get("alignment", "good"),
                        "is_alive": p.get("survived", True),
                        "is_poisoned": False,
                        "is_drunk": False,
                        "is_protected": False,
                        "ghost_vote_used": False,
                        "perceived_role": None,
                        "butler_master": None,
                    }
                    for i, p in enumerate(rd.get("players", []))
                ],
                "breakout_groups": [],
                "nominations": [],
                "executed_today": None,
                "winner": rd.get("winner"),
                "night_kills": [],
                "demon_bluffs": [],
                "rng_seed": None,
            }

        if initial:
            await websocket.send_json({
                "type": "game.state",
                "data": initial,
            })
        if info.get("events"):
            await websocket.send_json({
                "type": "event.history",
                "data": {
                    "events": info["events"],
                },
            })

    try:
        while True:
            data = await websocket.receive_json()
            # Handle control commands from frontend
            command = data.get("command")
            if command == "ping":
                await websocket.send_json({"type": "pong", "data": {}})
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket, game_id)
