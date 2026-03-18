"""Game state serialization and snapshot utilities."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from .types import GameState, Player, Message, Alignment, RoleType


def snapshot_public(state: GameState) -> dict[str, Any]:
    """Create a public-facing snapshot of the game state.

    This includes only information visible to all players:
    - Who is alive/dead
    - Current phase and day number
    - Public messages
    - Breakout group membership (not conversations)
    - Nomination and voting results
    """
    return {
        "game_id": state.game_id,
        "phase": state.phase.value,
        "day_number": state.day_number,
        "players": [
            {
                "seat": p.seat,
                "agent_id": p.agent_id,
                "character_name": p.character_name,
                "model_name": p.model_name,
                "is_alive": p.is_alive,
                "ghost_vote_used": p.ghost_vote_used,
            }
            for p in state.players
        ],
        "breakout_groups": [
            {
                "id": g.id,
                "round_number": g.round_number,
                "members": g.members,
            }
            for g in state.breakout_groups
        ],
        "nominations": [
            {
                "nominator": n.nominator_seat,
                "nominee": n.nominee_seat,
                "votes_for": len(n.votes_for),
                "votes_against": len(n.votes_against),
                "passed": n.passed,
            }
            for n in state.nominations
        ],
        "executed_today": state.executed_today,
        "winner": state.winner.value if state.winner else None,
    }


def snapshot_observer(state: GameState) -> dict[str, Any]:
    """Create a full observer snapshot with all hidden information."""
    public = snapshot_public(state)
    public["players"] = [
        {
            "seat": p.seat,
            "agent_id": p.agent_id,
            "character_name": p.character_name,
            "model_name": p.model_name,
            "role": p.role.name,
            "role_id": p.role.id,
            "role_type": p.role.role_type.value,
            "alignment": p.alignment.value,
            "is_alive": p.is_alive,
            "is_poisoned": p.is_poisoned,
            "is_drunk": p.is_drunk,
            "is_protected": p.is_protected,
            "ghost_vote_used": p.ghost_vote_used,
            "perceived_role": p.perceived_role.name if p.perceived_role else None,
            "butler_master": p.butler_master,
            "death_cause": p.death_cause,
            "death_day": p.death_day,
            "death_phase": p.death_phase,
            "ability_text": p.role.ability_text if p.role else "",
        }
        for p in state.players
    ]
    public["demon_bluffs"] = [r.name for r in state.demon_bluffs]
    public["night_kills"] = state.night_kills
    public["rng_seed"] = state.rng_seed
    return public
