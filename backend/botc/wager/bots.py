"""Automated bot bettors that create market liquidity.

Each bot has a personality that determines how it reacts to game events.
Bots join every game automatically, place bets based on public information
(nominations, votes, deaths), and create enough price movement that
human bets feel meaningful.

Zero API cost — purely programmatic.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

from . import db
from .scoring import Market

log = logging.getLogger(__name__)


# ── Bot Personalities ───────────────────────────────────────────────

@dataclass
class BotPersonality:
    name: str
    display_name: str
    # How much to bet each round (fraction of remaining budget)
    bet_fraction: float = 0.15
    # Bias toward evil predictions (>0.5 = suspects everyone, <0.5 = trusting)
    suspicion: float = 0.5
    # How much nominations/votes influence their suspicion
    event_reactivity: float = 1.0
    # Chance of betting on winner market vs alignment
    winner_focus: float = 0.2
    # Whether to bet against the current market consensus
    contrarian: bool = False
    # Minimum phase index before first bet (0 = bets immediately)
    patience: int = 0


BOT_ROSTER = [
    BotPersonality(
        name="fool",
        display_name="The Fool",
        bet_fraction=0.20,
        suspicion=0.5,
        event_reactivity=0.5,
        winner_focus=0.15,
        contrarian=False,
        patience=0,
    ),
    BotPersonality(
        name="fortuna",
        display_name="Lady Fortuna",
        bet_fraction=0.12,
        suspicion=0.4,
        event_reactivity=1.5,
        winner_focus=0.3,
        contrarian=False,
        patience=1,
    ),
    BotPersonality(
        name="skeptic",
        display_name="The Skeptic",
        bet_fraction=0.18,
        suspicion=0.65,
        event_reactivity=1.2,
        winner_focus=0.1,
        contrarian=True,
        patience=2,
    ),
    BotPersonality(
        name="oracle",
        display_name="The Oracle",
        bet_fraction=0.10,
        suspicion=0.5,
        event_reactivity=2.0,
        winner_focus=0.25,
        contrarian=False,
        patience=1,
    ),
]


# ── Bot State ───────────────────────────────────────────────────────

@dataclass
class BotState:
    """Tracks a single bot's state for one game."""
    personality: BotPersonality
    user_id: str = ""
    token: str = ""
    session_id: int = 0
    budget: float = 100.0
    # Per-seat suspicion scores (0 = definitely good, 1 = definitely evil)
    suspicion_map: dict[int, float] = field(default_factory=dict)
    # Track what events we've already reacted to
    last_event_count: int = 0
    phase_count: int = 0
    rng: random.Random = field(default_factory=random.Random)


@dataclass
class GameBotManager:
    """Manages all bots for a single game."""
    game_id: str
    total_players: int
    bots: list[BotState] = field(default_factory=list)
    _initialized: bool = False
    _rng: random.Random = field(default_factory=random.Random)


# ── Active managers ─────────────────────────────────────────────────

_managers: dict[str, GameBotManager] = {}


async def ensure_bots_for_game(game_id: str, total_players: int) -> GameBotManager:
    """Initialize bot accounts and join them to a game."""
    if game_id in _managers and _managers[game_id]._initialized:
        return _managers[game_id]

    mgr = GameBotManager(game_id=game_id, total_players=total_players)
    mgr._rng = random.Random(hash(game_id))

    for personality in BOT_ROSTER:
        bot = BotState(personality=personality)
        bot.rng = random.Random(hash(f"{game_id}_{personality.name}"))

        # Initialize suspicion at prior
        num_evil = _estimate_evil(total_players)
        base_suspicion = num_evil / total_players
        for seat in range(total_players):
            bot.suspicion_map[seat] = base_suspicion

        # Create or get user account
        user = await db.get_user_by_name(personality.display_name)
        if not user:
            user = await db.create_user(personality.display_name)
        bot.user_id = user["id"]
        bot.token = user.get("token", "")

        # Join the game
        session = await db.create_session(bot.user_id, game_id)
        bot.session_id = session["id"]
        bot.budget = session["crowns_budget"]

        mgr.bots.append(bot)

    mgr._initialized = True
    _managers[game_id] = mgr
    log.info("Initialized %d bots for game %s", len(mgr.bots), game_id)
    return mgr


# ── Event Processing ────────────────────────────────────────────────

def update_suspicion_from_events(
    bot: BotState,
    events: list[dict[str, Any]],
    total_players: int,
) -> None:
    """Update bot suspicion scores based on new game events."""
    reactivity = bot.personality.event_reactivity

    for event in events:
        etype = event.get("type", "")
        data = event.get("data", {})

        if etype == "nomination.start":
            # Being nominated increases suspicion slightly
            nominee = data.get("nominee")
            if nominee is not None and nominee in bot.suspicion_map:
                bot.suspicion_map[nominee] = min(1.0,
                    bot.suspicion_map[nominee] + 0.08 * reactivity)
            # Nominator might be evil (aggressive play) — tiny bump
            nominator = data.get("nominator")
            if nominator is not None and nominator in bot.suspicion_map:
                bot.suspicion_map[nominator] = min(1.0,
                    bot.suspicion_map[nominator] + 0.03 * reactivity)

        elif etype == "vote.cast":
            seat = data.get("seat")
            vote = data.get("vote")
            nominee = data.get("nominee")
            # Voting YES on someone who dies increases the voter's innocence
            # (good players vote to execute evil). Weak signal.
            if vote and seat is not None and seat in bot.suspicion_map:
                bot.suspicion_map[seat] = max(0.0,
                    bot.suspicion_map[seat] - 0.02 * reactivity)

        elif etype == "execution":
            # Executed player: suspicion is now moot (market still settles though)
            seat = data.get("seat")
            if seat is not None:
                # Spike suspicion — townsfolk don't usually get executed
                bot.suspicion_map[seat] = min(1.0,
                    bot.suspicion_map.get(seat, 0.5) + 0.15 * reactivity)

        elif etype == "death":
            seat = data.get("seat")
            cause = data.get("cause", "")
            if seat is not None and ("night" in cause or "demon" in cause):
                # Night kill victim is almost certainly good
                bot.suspicion_map[seat] = max(0.0, 0.05)
                # With one confirmed good dead, redistribute suspicion upward
                alive_seats = [s for s in bot.suspicion_map
                               if s != seat and bot.suspicion_map[s] < 0.95]
                if alive_seats:
                    bump = 0.04 * reactivity / max(len(alive_seats), 1)
                    for s in alive_seats:
                        bot.suspicion_map[s] = min(1.0, bot.suspicion_map[s] + bump)

        elif etype == "whisper.notification":
            # Whispering is slightly suspicious (evil coordinate via whispers)
            from_seat = data.get("from")
            to_seat = data.get("to")
            for s in (from_seat, to_seat):
                if s is not None and s in bot.suspicion_map:
                    bot.suspicion_map[s] = min(1.0,
                        bot.suspicion_map[s] + 0.02 * reactivity)


# ── Bet Selection ───────────────────────────────────────────────────

async def generate_bot_bets(
    mgr: GameBotManager,
    markets: dict[str, Market],
    events: list[dict[str, Any]],
    phase: str,
    day_number: int,
) -> list[dict[str, Any]]:
    """Generate and execute bot bets. Returns list of bet summaries."""
    results = []

    for bot in mgr.bots:
        if bot.budget < 2:
            continue
        if bot.phase_count < bot.personality.patience:
            continue

        # Process new events
        new_events = events[bot.last_event_count:]
        if new_events:
            update_suspicion_from_events(bot, new_events, mgr.total_players)
            bot.last_event_count = len(events)

        # Decide whether to bet this phase (not every phase)
        if bot.rng.random() > 0.6:
            continue

        # Pick market and side
        bet_info = _pick_bet(bot, markets, mgr.total_players)
        if not bet_info:
            continue

        market_id, side, amount = bet_info

        market = markets.get(market_id)
        if not market:
            continue

        # Execute the trade
        prob_before = market.prob_yes if side == "yes" else market.prob_no
        if side == "yes":
            shares = market.buy_yes(amount)
        else:
            shares = market.buy_no(amount)

        # Persist + record history
        from . import db as wdb
        await wdb.update_market_pools(mgr.game_id, market_id, market.yes_pool, market.no_pool)
        await wdb.record_market_history(mgr.game_id, market_id, market.prob_yes, "bet", bot.personality.display_name)
        await wdb.create_bet(
            session_id=bot.session_id,
            user_id=bot.user_id,
            game_id=mgr.game_id,
            market_id=market_id,
            side=side,
            crowns_spent=amount,
            shares_acquired=shares,
            prob_at_purchase=prob_before,
            phase_placed=phase,
            day_placed=day_number,
        )

        bot.budget -= amount
        results.append({
            "bot": bot.personality.display_name,
            "market": market_id,
            "side": side,
            "amount": round(amount, 1),
            "shares": round(shares, 1),
        })

    return results


def _pick_bet(
    bot: BotState,
    markets: dict[str, Market],
    total_players: int,
) -> tuple[str, str, float] | None:
    """Pick which market to bet on, which side, and how much."""
    personality = bot.personality
    budget = bot.budget
    amount = max(2, min(budget * personality.bet_fraction, 30))

    # Decide: winner market or alignment market?
    if bot.rng.random() < personality.winner_focus:
        market = markets.get("winner_evil")
        if not market:
            return None
        # Bet based on overall suspicion level
        avg_suspicion = sum(bot.suspicion_map.values()) / max(len(bot.suspicion_map), 1)
        evil_likely = avg_suspicion > 0.5

        if personality.contrarian:
            # Bet against the market consensus
            side = "no" if market.prob_yes > 0.5 else "yes"
        else:
            side = "yes" if evil_likely else "no"

        return market.market_id, side, round(amount, 1)

    # Alignment market: pick a seat to bet on
    # Weight seats by how far their suspicion deviates from market price
    candidates: list[tuple[str, str, float]] = []
    for seat, suspicion in bot.suspicion_map.items():
        market_id = f"alignment_seat_{seat}"
        market = markets.get(market_id)
        if not market:
            continue

        market_prob = market.prob_yes  # market's P(evil)
        bot_prob = suspicion * personality.suspicion  # bot's belief scaled by personality

        # Look for disagreements between bot belief and market price
        diff = abs(bot_prob - market_prob)
        if diff < 0.08:
            continue  # Not enough edge to bet

        if personality.contrarian:
            # Bet against the market
            side = "no" if market_prob > 0.4 else "yes"
        else:
            # Bet with conviction
            side = "yes" if bot_prob > market_prob else "no"

        candidates.append((market_id, side, diff))

    if not candidates:
        return None

    # Pick the highest-conviction bet
    candidates.sort(key=lambda x: x[2], reverse=True)
    # Add some randomness — don't always pick the top one
    pick_idx = min(bot.rng.randint(0, min(2, len(candidates) - 1)), len(candidates) - 1)
    market_id, side, _ = candidates[pick_idx]

    return market_id, side, round(amount, 1)


def on_phase_change(game_id: str) -> None:
    """Increment phase counter for all bots in this game."""
    mgr = _managers.get(game_id)
    if mgr:
        for bot in mgr.bots:
            bot.phase_count += 1


# ── Helpers ─────────────────────────────────────────────────────────

def _estimate_evil(total_players: int) -> int:
    if total_players <= 6:
        return 2
    elif total_players <= 9:
        return 3
    elif total_players <= 12:
        return 3
    else:
        return 4
