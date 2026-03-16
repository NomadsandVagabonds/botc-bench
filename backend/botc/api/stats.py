"""Compute aggregate per-model stats from saved game JSON files.

Scans backend/games/game_*.json, extracts seat→model mappings from events,
and computes win rates by alignment/role type for each model.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_GAMES_DIR = Path(__file__).parent.parent.parent / "games"

# Known demon role names across all scripts.
# We check role_type from game.state events first, but fall back to this
# list when only the role name is available from result.players.
_DEMON_ROLE_NAMES = {
    # Trouble Brewing
    "Imp",
    # Sects & Violets
    "Fang Gu", "Vigormortis", "No Dashii", "Vortox",
    # Bad Moon Rising
    "Po", "Pukka", "Shabaloth", "Zombuul",
}


def _extract_seat_models(data: dict) -> dict[int, str]:
    """Extract seat → model name mapping from game events.

    Tries game.created event first (has seat/model), then game.state event
    (has seat/model_name). Falls back to empty dict if neither found.
    """
    seat_models: dict[int, str] = {}

    events = data.get("events") or []
    for event in events:
        etype = event.get("type", "")
        edata = event.get("data", {})

        if etype == "game.created":
            for p in edata.get("players", []):
                seat = p.get("seat")
                model = p.get("model", "")
                if seat is not None and model:
                    seat_models[seat] = model
            if seat_models:
                return seat_models

        if etype == "game.state":
            for p in edata.get("players", []):
                seat = p.get("seat")
                model = p.get("model_name", "")
                if seat is not None and model:
                    seat_models[seat] = model
            if seat_models:
                return seat_models

    return seat_models


def _extract_seat_role_types(data: dict) -> dict[int, str]:
    """Extract seat → role_type from game.state events.

    Returns e.g. {0: "townsfolk", 3: "minion", 4: "demon"}.
    """
    seat_role_types: dict[int, str] = {}

    events = data.get("events") or []
    for event in events:
        if event.get("type") == "game.state":
            for p in event.get("data", {}).get("players", []):
                seat = p.get("seat")
                role_type = p.get("role_type", "")
                if seat is not None and role_type:
                    seat_role_types[seat] = role_type
            if seat_role_types:
                return seat_role_types

    return seat_role_types


def _is_demon(role_name: str, seat: int, seat_role_types: dict[int, str]) -> bool:
    """Check whether a player was the Demon."""
    # Prefer role_type from game.state events
    if seat in seat_role_types:
        return seat_role_types[seat] == "demon"
    # Fall back to known demon role names
    return role_name in _DEMON_ROLE_NAMES


def compute_model_stats() -> dict[str, Any]:
    """Scan all saved games and compute per-model aggregate stats.

    Returns:
        {
            "models": {
                "<model_name>": {
                    "games_played": int,
                    "as_good": {"played": int, "wins": int, "win_rate": float},
                    "as_evil": {"played": int, "wins": int, "win_rate": float},
                    "as_demon": {"played": int, "wins": int, "win_rate": float},
                },
                ...
            },
            "rankings": {
                "good": [...],     # sorted by good win rate desc
                "evil": [...],     # sorted by evil win rate desc
                "demon": [...],    # sorted by demon win rate desc
                "overall": [...],  # sorted by overall win rate desc
            },
            "total_games": int,
        }
    """
    games_dir = _GAMES_DIR
    if not games_dir.exists():
        return {"models": {}, "rankings": {"good": [], "evil": [], "demon": [], "overall": []}, "total_games": 0}

    # Per-model accumulators
    # model -> {"good_played", "good_wins", "evil_played", "evil_wins",
    #           "demon_played", "demon_wins", "games": set of game_ids}
    accum: dict[str, dict[str, Any]] = {}
    total_games = 0

    for path in sorted(games_dir.glob("game_*.json")):
        try:
            data = json.loads(path.read_text())
        except Exception:
            logger.warning("Failed to parse %s, skipping", path.name)
            continue

        # Only count completed games
        status = data.get("status", "")
        if status != "completed":
            # Legacy files without status field — check if result exists
            if "result" not in data and "result_data" not in data:
                continue

        # Get result data (handles both formats)
        result = data.get("result") or data.get("result_data")
        if not result:
            continue

        winner = result.get("winner")
        if not winner:
            continue

        game_id = result.get("game_id") or data.get("game_id") or path.stem.removeprefix("game_")
        players = result.get("players", [])
        if not players:
            continue

        total_games += 1

        # Get seat → model mapping from events
        seat_models = _extract_seat_models(data)
        # Get seat → role_type mapping from events
        seat_role_types = _extract_seat_role_types(data)

        for p in players:
            seat = p.get("seat")
            alignment = p.get("alignment", "")
            role_name = p.get("role", "")

            # Resolve model name: prefer events, fall back to agent_id
            model = seat_models.get(seat, "") if seat is not None else ""
            if not model:
                # Some older games might not have events; skip these players
                # since we can't attribute them to a model
                continue

            if model not in accum:
                accum[model] = {
                    "good_played": 0, "good_wins": 0,
                    "evil_played": 0, "evil_wins": 0,
                    "demon_played": 0, "demon_wins": 0,
                    "games": set(),
                }

            accum[model]["games"].add(game_id)
            team_won = alignment == winner

            if alignment == "good":
                accum[model]["good_played"] += 1
                if team_won:
                    accum[model]["good_wins"] += 1
            elif alignment == "evil":
                accum[model]["evil_played"] += 1
                if team_won:
                    accum[model]["evil_wins"] += 1

            if _is_demon(role_name, seat, seat_role_types):
                accum[model]["demon_played"] += 1
                if team_won:
                    accum[model]["demon_wins"] += 1

    # Build output
    models: dict[str, dict[str, Any]] = {}
    for model, a in accum.items():
        games_played = len(a["games"])

        def _rate(wins: int, played: int) -> float:
            return round(wins / played, 3) if played > 0 else 0.0

        total_played = a["good_played"] + a["evil_played"]
        total_wins = a["good_wins"] + a["evil_wins"]

        models[model] = {
            "games_played": games_played,
            "total_played": total_played,
            "total_wins": total_wins,
            "overall_win_rate": _rate(total_wins, total_played),
            "as_good": {
                "played": a["good_played"],
                "wins": a["good_wins"],
                "win_rate": _rate(a["good_wins"], a["good_played"]),
            },
            "as_evil": {
                "played": a["evil_played"],
                "wins": a["evil_wins"],
                "win_rate": _rate(a["evil_wins"], a["evil_played"]),
            },
            "as_demon": {
                "played": a["demon_played"],
                "wins": a["demon_wins"],
                "win_rate": _rate(a["demon_wins"], a["demon_played"]),
            },
        }

    # Build rankings
    def _rank(key: str) -> list[str]:
        """Sort models by win rate descending for a given category."""
        return sorted(
            models.keys(),
            key=lambda m: (models[m][key]["win_rate"], models[m][key]["played"]),
            reverse=True,
        )

    rankings = {
        "good": _rank("as_good"),
        "evil": _rank("as_evil"),
        "demon": _rank("as_demon"),
        "overall": sorted(
            models.keys(),
            key=lambda m: (models[m]["overall_win_rate"], models[m]["total_played"]),
            reverse=True,
        ),
    }

    return {
        "models": models,
        "rankings": rankings,
        "total_games": total_games,
    }


def build_stats_prompt_section() -> str:
    """Build a Markdown section summarizing model performance for injection into system prompts.

    Returns an empty string if no stats are available.
    """
    stats = compute_model_stats()
    if not stats["models"]:
        return ""

    lines = ["## Model Performance (historical)"]
    rankings = stats["rankings"]

    for model in rankings["overall"]:
        m = stats["models"][model]
        good_rate = f"{m['as_good']['win_rate']:.0%}" if m["as_good"]["played"] else "n/a"
        evil_rate = f"{m['as_evil']['win_rate']:.0%}" if m["as_evil"]["played"] else "n/a"
        games = m["games_played"]

        # Compute rank for good and evil
        good_rank = rankings["good"].index(model) + 1 if model in rankings["good"] else "?"
        evil_rank = rankings["evil"].index(model) + 1 if model in rankings["evil"] else "?"

        lines.append(
            f"- {model}: {good_rate} good win rate (#{good_rank}), "
            f"{evil_rate} evil win rate (#{evil_rank}), "
            f"{games} game{'s' if games != 1 else ''} played"
        )

    return "\n".join(lines)
