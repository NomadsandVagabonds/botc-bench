"""Extract turns from saved game JSON files for claim labeling.

Walks the event array once, building PlayerInfo for each seat and
yielding a Turn for each public speech event (public, group,
accusation, defense).  Pairs message.new events with the
player.reasoning event that follows for the same seat.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class PlayerInfo:
    """Ground truth for a single player, assembled from game data."""

    seat: int
    character_name: str
    true_role: str          # e.g. "Imp", "Washerwoman"
    role_type: str          # "townsfolk", "outsider", "minion", "demon"
    alignment: str          # "good" / "evil"
    model_name: str         # API model identifier
    private_info: list[str] = field(default_factory=list)
    # Evil-team specifics (populated for evil players only)
    evil_teammates: list[dict[str, str]] = field(default_factory=list)
    demon_bluffs: list[str] = field(default_factory=list)


@dataclass
class Turn:
    """A single speech act by one player, ready for claim extraction."""

    game_id: str
    seat: int
    day: int
    phase: str              # "day_discussion", "day_breakout", "nominations", etc.
    message_type: str       # "public", "group", "accusation", "defense"
    say_text: str
    think_text: str | None  # from player.reasoning (when available)
    player_info: PlayerInfo
    turn_index: int         # monotonic position in the game


# Message sub-types that represent player speech (not system/private/narration)
_SPEECH_TYPES = frozenset({"public", "group", "accusation", "defense"})


def extract_turns(game_path: str | Path) -> tuple[list[Turn], dict[int, PlayerInfo]]:
    """Extract all speech turns and player info from a game JSON.

    Returns
    -------
    turns : list[Turn]
        Chronological list of every speech turn in the game.
    player_info : dict[int, PlayerInfo]
        Mapping from seat number to ground truth player info.
    """
    with open(game_path) as f:
        game = json.load(f)

    game_id = game.get("game_id", Path(game_path).stem)
    player_info = _build_player_info(game)
    turns = _walk_events(game_id, game.get("events", []), player_info)
    return turns, player_info


def _build_player_info(game: dict[str, Any]) -> dict[int, PlayerInfo]:
    """Build PlayerInfo for each seat from result + events."""
    info: dict[int, PlayerInfo] = {}

    # Primary source: result.players (always present for completed games)
    result = game.get("result", {})
    players = result.get("players", [])

    # Model names come from game.state or game.created events
    model_map = _extract_model_names(game.get("events", []))

    for p in players:
        seat = p["seat"]
        info[seat] = PlayerInfo(
            seat=seat,
            character_name=p.get("character_name", f"Seat {seat}"),
            true_role=p.get("role", "unknown"),
            role_type=_infer_role_type(p.get("role", ""), p.get("alignment", "")),
            alignment=p.get("alignment", "unknown"),
            model_name=model_map.get(seat, "unknown"),
        )

    # Collect private_info and evil team knowledge from events
    for event in game.get("events", []):
        if event.get("type") != "message.new":
            continue
        data = event.get("data", {})
        if data.get("type") != "private_info":
            continue
        seat = data.get("seat")
        if seat is None or seat not in info:
            continue
        content = data.get("content", "")
        if not content:
            continue
        info[seat].private_info.append(content)
        # Parse evil team info from the first private_info message
        _parse_evil_knowledge(info[seat], content)

    return info


def _extract_model_names(events: list[dict]) -> dict[int, str]:
    """Get model name per seat from game.state or agent.tokens events."""
    models: dict[int, str] = {}

    for event in events:
        etype = event.get("type", "")
        data = event.get("data", {})

        if etype == "game.state":
            for p in data.get("players", []):
                seat = p.get("seat")
                model = p.get("model_name") or p.get("model", "")
                if seat is not None and model:
                    models[seat] = model

        elif etype == "agent.tokens" and "seat" in data:
            seat = data["seat"]
            model = data.get("model", "")
            if model and seat not in models:
                models[seat] = model

    return models


def _parse_evil_knowledge(player: PlayerInfo, content: str) -> None:
    """Extract evil teammates and demon bluffs from private_info text."""
    if "evil teammates:" in content.lower() or "your evil teammates" in content.lower():
        # Parse lines like "Your evil teammates: Iona [Seat 1] (Baron)."
        for line in content.split("\n"):
            lower = line.lower()
            if "teammates" in lower:
                # Extract teammate info from the line
                import re
                teammates = re.findall(
                    r"(\w+)\s*\[Seat\s*(\d+)\]\s*\((\w+(?:\s+\w+)*)\)",
                    line,
                )
                for name, seat_str, role in teammates:
                    player.evil_teammates.append({
                        "name": name,
                        "seat": int(seat_str),
                        "role": role,
                    })
            if "bluff" in lower:
                import re
                bluffs = re.findall(r"(\w+(?:\s+\w+)*)", line.split(":")[-1])
                player.demon_bluffs = [b.strip() for b in bluffs if b.strip() and b.strip() != "Your"]


_ROLE_TYPE_MAP: dict[str, str] = {}  # populated lazily


def _infer_role_type(role: str, alignment: str) -> str:
    """Infer role_type from role name and alignment."""
    # Common mappings for Trouble Brewing
    demons = {"Imp"}
    minions = {"Poisoner", "Spy", "Scarlet Woman", "Baron"}
    outsiders = {"Butler", "Drunk", "Recluse", "Saint"}
    # Everything else that's good is townsfolk

    if role in demons:
        return "demon"
    if role in minions:
        return "minion"
    if role in outsiders:
        return "outsider"
    if alignment == "evil":
        return "minion"  # fallback for unknown evil roles
    return "townsfolk"


def _walk_events(
    game_id: str,
    events: list[dict[str, Any]],
    player_info: dict[int, PlayerInfo],
) -> list[Turn]:
    """Walk events chronologically, pairing messages with reasoning."""
    turns: list[Turn] = []
    turn_index = 0

    # Track current phase/day from phase.change events
    current_phase = "setup"
    current_day = 0

    # Buffer: pending message awaiting possible reasoning pairing
    pending_message: dict[str, Any] | None = None
    pending_phase: str = "setup"
    pending_day: int = 0

    def _flush_pending(think: str | None = None) -> None:
        nonlocal pending_message, turn_index
        if pending_message is None:
            return
        data = pending_message
        seat = data["seat"]
        if seat in player_info:
            turns.append(Turn(
                game_id=game_id,
                seat=seat,
                day=pending_day,
                phase=pending_phase,
                message_type=data.get("type", "public"),
                say_text=data.get("content", ""),
                think_text=think,
                player_info=player_info[seat],
                turn_index=turn_index,
            ))
            turn_index += 1
        pending_message = None

    for event in events:
        etype = event.get("type", "")
        data = event.get("data", {})

        if etype == "phase.change":
            _flush_pending()
            current_phase = data.get("phase", current_phase)
            current_day = data.get("day", current_day)
            continue

        if etype == "message.new":
            msg_type = data.get("type", "")
            if msg_type in _SPEECH_TYPES:
                # Flush any pending message (no reasoning followed it)
                _flush_pending()
                pending_message = data
                pending_phase = current_phase
                pending_day = current_day
            continue

        if etype == "player.reasoning":
            if (
                pending_message is not None
                and data.get("seat") == pending_message.get("seat")
            ):
                # This reasoning belongs to the pending message
                _flush_pending(think=data.get("reasoning"))
            else:
                # Reasoning for a different seat or no pending message
                _flush_pending()
            continue

    # Flush any remaining pending message
    _flush_pending()

    return turns
