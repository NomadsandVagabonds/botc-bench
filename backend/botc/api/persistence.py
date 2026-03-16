"""Disk persistence for game results and event histories.

Saves completed/failed games to backend/games/ as JSON files.
Loads them back on server startup so the lobby survives restarts.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Default to backend/games/ relative to the backend package root
_GAMES_DIR = Path(__file__).parent.parent.parent / "games"


def _ensure_dir() -> Path:
    _GAMES_DIR.mkdir(parents=True, exist_ok=True)
    return _GAMES_DIR


def save_game(
    game_id: str,
    status: str,
    *,
    result: dict | None = None,
    events: list[dict] | None = None,
    initial_state: dict | None = None,
    error: str | None = None,
) -> Path:
    """Save a game to disk. Returns the path written."""
    out_dir = _ensure_dir()
    path = out_dir / f"game_{game_id}.json"

    payload: dict[str, Any] = {
        "game_id": game_id,
        "status": status,
    }
    if result is not None:
        payload["result"] = result
    if events is not None:
        payload["events"] = events
    if initial_state is not None:
        payload["initial_state"] = initial_state
    if error is not None:
        payload["error"] = error

    path.write_text(json.dumps(payload, default=str, indent=2))
    logger.info("Saved game %s to %s (%d events)", game_id, path.name, len(events or []))
    return path


def load_all_games() -> dict[str, dict[str, Any]]:
    """Load all saved games from disk. Returns {game_id: info_dict}.

    Handles both the new format (with top-level game_id/status) and the
    legacy format from run_game.py (result + events only).
    """
    games_dir = _ensure_dir()
    loaded: dict[str, dict[str, Any]] = {}

    for path in sorted(games_dir.glob("game_*.json")):
        try:
            data = json.loads(path.read_text())

            # New format has game_id at top level
            if "game_id" in data:
                game_id = data["game_id"]
            elif "result" in data and "game_id" in data["result"]:
                # Legacy format from run_game.py
                game_id = data["result"]["game_id"]
            else:
                game_id = path.stem.removeprefix("game_")

            # Normalize legacy format to match new format
            if "status" not in data:
                data["status"] = "completed" if "result" in data else "unknown"
            if "result" in data and "result_data" not in data and "game_id" not in data:
                # Legacy: result is at top level, rename for consistency
                data["result_data"] = data.pop("result")
                data["game_id"] = game_id

            loaded[game_id] = data
            logger.info("Loaded saved game %s (%s)", game_id, data.get("status", "?"))
        except Exception:
            logger.exception("Failed to load %s", path)

    return loaded
