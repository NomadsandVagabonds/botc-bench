"""Settle all bets when a game ends.

Each bet holds shares in a binary market. On resolution:
- Correct shares pay 1 Crown each
- Wrong shares pay 0
- Profit = payout - crowns_spent
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from . import db

log = logging.getLogger(__name__)

_GAMES_DIR = Path(__file__).parent.parent.parent / "games"


async def settle_game(game_id: str) -> dict[str, Any]:
    """Settle all bets for a completed game."""
    game_path = _GAMES_DIR / f"game_{game_id}.json"
    if not game_path.exists():
        log.warning("Cannot settle game %s: game file not found", game_id)
        return {"error": "game_not_found"}

    game_data = json.loads(game_path.read_text())
    result = game_data.get("result", game_data.get("result_data", {}))
    players = result.get("players", [])
    winner = result.get("winner", "unknown")

    # Build ground truth
    truth_alignment: dict[int, str] = {}
    for p in players:
        seat = p.get("seat", -1)
        truth_alignment[seat] = p.get("alignment", "good")

    # Load unsettled bets
    bets = await db.get_unsettled_bets(game_id)
    if not bets:
        log.info("No unsettled bets for game %s", game_id)
        return {"settled": 0}

    user_results: dict[str, dict[str, Any]] = {}

    for bet in bets:
        market_id = bet["market_id"]
        side = bet["side"]  # 'yes' or 'no'
        shares = bet["shares_acquired"]

        # Determine if the bet's side was correct
        correct = _resolve_market(market_id, side, truth_alignment, winner)

        # Payout: 1 Crown per share if correct, 0 if wrong
        payout = shares if correct else 0.0

        await db.settle_bet(bet["id"], correct, payout)

        uid = bet["user_id"]
        if uid not in user_results:
            user_results[uid] = {"crowns_won": 0.0, "correct": 0, "total": 0}
        user_results[uid]["crowns_won"] += payout
        user_results[uid]["total"] += 1
        if correct:
            user_results[uid]["correct"] += 1

    # Update sessions and user stats
    sessions = await db.get_unsettled_sessions(game_id)
    for session in sessions:
        uid = session["user_id"]
        ur = user_results.get(uid, {"crowns_won": 0.0, "correct": 0, "total": 0})
        await db.settle_session(session["id"], ur["crowns_won"])
        await db.update_user_stats(
            uid,
            crowns_delta=int(ur["crowns_won"]),
            correct_delta=ur["correct"],
            total_delta=ur["total"],
        )

    log.info(
        "Settled %d bets for game %s across %d users",
        len(bets), game_id, len(user_results),
    )
    return {"settled": len(bets), "users": user_results}


def _resolve_market(
    market_id: str,
    side: str,
    truth_alignment: dict[int, str],
    winner: str,
) -> bool:
    """Determine if a bet's side was correct."""
    if market_id.startswith("alignment_seat_"):
        seat = int(market_id.split("_")[-1])
        is_evil = truth_alignment.get(seat, "good") == "evil"
        # YES = "is evil", NO = "is good"
        if side == "yes":
            return is_evil
        else:
            return not is_evil

    if market_id == "winner_evil":
        evil_won = winner.lower() == "evil"
        if side == "yes":
            return evil_won
        else:
            return not evil_won

    return False
