"""Information modification for Drunk and Poisoned players.

When a malfunctioning player (drunk or poisoned) receives information,
the engine generates plausible but WRONG information instead.
"""

from __future__ import annotations

import random
from typing import Any

from .types import GameState, Player


def should_malfunction(player: Player) -> bool:
    """Check if a player's ability should malfunction."""
    return player.is_drunk or player.is_poisoned


def wrong_number(true_value: int, max_value: int, rng: random.Random) -> int:
    """Return a wrong number for malfunctioning info roles (Chef, Empath)."""
    candidates = [i for i in range(0, max_value + 1) if i != true_value]
    if not candidates:
        return true_value
    return rng.choice(candidates)


def wrong_player_pair(
    true_seat: int,
    other_seat: int,
    all_seats: list[int],
    rng: random.Random,
) -> tuple[int, int]:
    """Return a wrong pair of players for malfunctioning Washerwoman/Librarian/Investigator.

    One of the pair should be wrong — the true target is replaced.
    """
    wrong_candidates = [s for s in all_seats if s != true_seat and s != other_seat]
    if not wrong_candidates:
        return (true_seat, other_seat)
    wrong_seat = rng.choice(wrong_candidates)
    pair = [wrong_seat, other_seat]
    rng.shuffle(pair)
    return (pair[0], pair[1])


def wrong_role(
    true_role_id: str,
    available_role_ids: list[str],
    rng: random.Random,
) -> str:
    """Return a wrong role for malfunctioning info."""
    candidates = [r for r in available_role_ids if r != true_role_id]
    if not candidates:
        return true_role_id
    return rng.choice(candidates)


def wrong_fortune_teller(true_result: bool, rng: random.Random) -> bool:
    """Return the opposite result for a malfunctioning Fortune Teller."""
    return not true_result
