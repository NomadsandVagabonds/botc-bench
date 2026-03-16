"""Disk persistence for monitor results.

Saves to the same ``backend/games/`` directory used by game persistence,
with filenames like ``monitor_{game_id}_{monitor_id}.json``.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Same directory as game persistence
_GAMES_DIR = Path(__file__).parent.parent.parent / "games"


def _ensure_dir() -> Path:
    _GAMES_DIR.mkdir(parents=True, exist_ok=True)
    return _GAMES_DIR


def save_monitor_result(result: dict[str, Any]) -> Path:
    """Save a monitor result to disk.

    The result dict must contain ``game_id`` and ``monitor_id`` keys.

    Returns
    -------
    Path
        The path written.
    """
    out_dir = _ensure_dir()
    game_id = result["game_id"]
    monitor_id = result["monitor_id"]
    path = out_dir / f"monitor_{game_id}_{monitor_id}.json"
    path.write_text(json.dumps(result, default=str, indent=2))
    logger.info("Saved monitor result %s for game %s", monitor_id, game_id)
    return path


def load_monitor_results(game_id: str) -> list[dict[str, Any]]:
    """Load all monitor results for a game.

    Returns
    -------
    list[dict]
        List of monitor result dicts, sorted by monitor_id.
    """
    games_dir = _ensure_dir()
    results: list[dict[str, Any]] = []

    for path in sorted(games_dir.glob(f"monitor_{game_id}_*.json")):
        try:
            data = json.loads(path.read_text())
            results.append(data)
        except Exception:
            logger.exception("Failed to load %s", path)

    return results


def load_monitor_result(game_id: str, monitor_id: str) -> dict[str, Any] | None:
    """Load a specific monitor result.

    Returns
    -------
    dict | None
        The monitor result dict, or None if not found.
    """
    games_dir = _ensure_dir()
    path = games_dir / f"monitor_{game_id}_{monitor_id}.json"
    if not path.exists():
        return None

    try:
        return json.loads(path.read_text())
    except Exception:
        logger.exception("Failed to load %s", path)
        return None
