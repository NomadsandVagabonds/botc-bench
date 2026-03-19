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


def compute_leaderboard_stats() -> dict[str, Any]:
    """Extended stats for the leaderboard — nominations, votes, kills, tokens, role breakdown.

    Good metrics (only counted when player is good):
      - noms_made, noms_hit_evil, nom_accuracy
      - votes_cast, votes_correct, vote_accuracy (YES on evil, NO on good)

    Evil metrics:
      - night_kills (kills outside executions)
      - mislynch_caused (good players executed when this evil player was alive)
      - survival_rate (days survived / total days)
      - wins as evil, wins as demon

    General:
      - win_rate by role (TB roles only)
      - avg tokens per day
      - avg cost per day
    """
    games_dir = _GAMES_DIR
    if not games_dir.exists():
        return {"models": {}, "role_stats": {}, "total_games": 0}

    accum: dict[str, dict[str, Any]] = {}
    role_accum: dict[str, dict[str, dict[str, Any]]] = {}  # model -> role -> stats
    total_games = 0

    for path in sorted(games_dir.glob("game_*.json")):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue

        result = data.get("result") or data.get("result_data")
        if not result:
            continue
        winner = result.get("winner")
        if not winner:
            continue

        players = result.get("players", [])
        if not players:
            continue

        total_games += 1
        total_days = result.get("total_days", 1) or 1
        events = data.get("events", [])
        seat_models = _extract_seat_models(data)
        seat_role_types = _extract_seat_role_types(data)

        # Build seat -> player info
        seat_info: dict[int, dict] = {}
        for p in players:
            seat = p.get("seat")
            if seat is not None:
                seat_info[seat] = p

        # Extract nominations, votes, deaths from events
        nominations = []
        votes: list[dict] = []
        deaths: list[dict] = []
        executions: list[dict] = []
        token_events: list[dict] = []

        for e in events:
            t = e.get("type", "")
            d = e.get("data", {})
            if t == "nomination.result":
                nominations.append(d)
            elif t == "vote.cast":
                votes.append(d)
            elif t == "death":
                deaths.append(d)
            elif t == "execution":
                executions.append(d)
            elif t == "agent.tokens":
                token_events.append(d)

        # Executed seats
        executed_seats = {e.get("seat") for e in executions}
        # Night kill seats
        night_kill_seats = {d.get("seat") for d in deaths if d.get("cause") in ("night_kill", "demon_kill")}

        for p in players:
            seat = p.get("seat")
            model = seat_models.get(seat, "") if seat is not None else ""
            if not model:
                continue
            alignment = p.get("alignment", "")
            role = p.get("role", "")
            survived = p.get("survived", True)
            team_won = alignment == winner

            if model not in accum:
                accum[model] = {
                    "games": set(),
                    # Good metrics
                    "good_noms_made": 0, "good_noms_hit_evil": 0,
                    "good_votes_cast": 0, "good_votes_correct": 0,
                    "good_played": 0, "good_wins": 0,
                    # Evil metrics
                    "evil_played": 0, "evil_wins": 0,
                    "evil_night_kills": 0, "evil_mislynch_caused": 0,
                    "evil_days_survived": 0, "evil_total_days": 0,
                    # Demon
                    "demon_played": 0, "demon_wins": 0,
                    # Tokens
                    "total_tokens": 0, "total_cost": 0.0, "total_days": 0,
                }

            a = accum[model]
            a["games"].add(path.stem)
            a["total_days"] += total_days

            # Per-agent token cost
            agent_tokens_for_seat = [
                te for te in token_events if te.get("seat") == seat
            ]
            for te in agent_tokens_for_seat:
                a["total_tokens"] += te.get("input_tokens", 0) + te.get("output_tokens", 0)
                a["total_cost"] += te.get("cost_usd", 0.0)

            if alignment == "good":
                a["good_played"] += 1
                if team_won:
                    a["good_wins"] += 1

                # Good nomination accuracy: did they nominate evil?
                for nom in nominations:
                    if nom.get("nominator") == seat:
                        a["good_noms_made"] += 1
                        nominee_seat = nom.get("nominee")
                        nominee_info = seat_info.get(nominee_seat, {})
                        if nominee_info.get("alignment") == "evil":
                            a["good_noms_hit_evil"] += 1

                # Good vote accuracy: YES on evil nominee, NO on good nominee
                for v in votes:
                    if v.get("seat") == seat:
                        a["good_votes_cast"] += 1
                        nominee_seat = v.get("nominee")
                        nominee_info = seat_info.get(nominee_seat, {})
                        voted_yes = v.get("vote", False)
                        nominee_evil = nominee_info.get("alignment") == "evil"
                        if (voted_yes and nominee_evil) or (not voted_yes and not nominee_evil):
                            a["good_votes_correct"] += 1

            elif alignment == "evil":
                a["evil_played"] += 1
                if team_won:
                    a["evil_wins"] += 1

                # Survival rate: estimate days survived
                death_event = next((d for d in deaths if d.get("seat") == seat), None)
                if death_event:
                    death_day = death_event.get("death_day", total_days)
                    a["evil_days_survived"] += death_day
                else:
                    a["evil_days_survived"] += total_days
                a["evil_total_days"] += total_days

                # Night kills (demon only)
                if _is_demon(role, seat, seat_role_types):
                    a["demon_played"] += 1
                    if team_won:
                        a["demon_wins"] += 1
                    a["evil_night_kills"] += len(night_kill_seats)

                # Mislynch: good players executed while this evil player was alive
                for ex_seat in executed_seats:
                    ex_info = seat_info.get(ex_seat, {})
                    if ex_info.get("alignment") == "good":
                        # Was this evil player alive at the time? Approximate: they survived or died after
                        if not death_event or death_event.get("death_day", 999) >= ex_info.get("death_day", 0):
                            a["evil_mislynch_caused"] += 1

            # Role stats
            if model not in role_accum:
                role_accum[model] = {}
            if role not in role_accum[model]:
                role_accum[model][role] = {"played": 0, "wins": 0}
            role_accum[model][role]["played"] += 1
            if team_won:
                role_accum[model][role]["wins"] += 1

    # Build output
    def _rate(n: int, d: int) -> float:
        return round(n / d, 3) if d > 0 else 0.0

    models: dict[str, dict[str, Any]] = {}
    for model, a in accum.items():
        games_played = len(a["games"])
        total_played = a["good_played"] + a["evil_played"]
        total_wins = a["good_wins"] + a["evil_wins"]
        total_days_sum = a["total_days"] or 1

        models[model] = {
            "games_played": games_played,
            "overall_win_rate": _rate(total_wins, total_played),
            # Good
            "good": {
                "played": a["good_played"], "wins": a["good_wins"],
                "win_rate": _rate(a["good_wins"], a["good_played"]),
                "noms_made": a["good_noms_made"],
                "noms_hit_evil": a["good_noms_hit_evil"],
                "nom_accuracy": _rate(a["good_noms_hit_evil"], a["good_noms_made"]),
                "votes_cast": a["good_votes_cast"],
                "votes_correct": a["good_votes_correct"],
                "vote_accuracy": _rate(a["good_votes_correct"], a["good_votes_cast"]),
            },
            # Evil
            "evil": {
                "played": a["evil_played"], "wins": a["evil_wins"],
                "win_rate": _rate(a["evil_wins"], a["evil_played"]),
                "night_kills": a["evil_night_kills"],
                "mislynch_caused": a["evil_mislynch_caused"],
                "survival_rate": _rate(a["evil_days_survived"], a["evil_total_days"]),
            },
            # Demon
            "demon": {
                "played": a["demon_played"], "wins": a["demon_wins"],
                "win_rate": _rate(a["demon_wins"], a["demon_played"]),
            },
            # Tokens
            "avg_tokens_per_day": round(a["total_tokens"] / total_days_sum) if total_days_sum else 0,
            "avg_cost_per_day": round(a["total_cost"] / total_days_sum, 4) if total_days_sum else 0,
            # Role breakdown
            "roles": {
                role: {
                    "played": rs["played"], "wins": rs["wins"],
                    "win_rate": _rate(rs["wins"], rs["played"]),
                }
                for role, rs in role_accum.get(model, {}).items()
            },
        }

    return {"models": models, "total_games": total_games}


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
