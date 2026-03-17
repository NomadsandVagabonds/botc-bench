"""REST + WebSocket API routes."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from botc.api.persistence import load_all_games, save_game
from botc.api.websocket import ws_manager
from botc.engine.roles import load_script
from botc.engine.types import BreakoutConfig, GameConfig, ROLE_DISTRIBUTION, RoleType
from botc.llm.provider import AgentConfig
from botc.orchestrator.game_runner import GameResult, GameRunner

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory game registry — populated from disk on import
_games: dict[str, dict[str, Any]] = {}
_runners: dict[str, GameRunner] = {}


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
    seat_roles: list[str] | None = None  # optional pre-assigned role IDs per seat
    seed: int | None = None
    max_days: int = 50
    reveal_models: str = "true"  # "true" | "false" | "scramble"
    share_stats: bool = False


class GameResponse(BaseModel):
    game_id: str
    status: str
    winner: str | None = None
    total_days: int | None = None


# Provider name → environment variable name
_PROVIDER_ENV_KEYS: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


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


# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@router.post("/api/games", response_model=GameResponse)
async def create_game(request: CreateGameRequest) -> GameResponse:
    """Create and start a new game."""
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
    if len(request.seat_models) != request.num_players:
        raise HTTPException(
            status_code=422,
            detail=f"Need {request.num_players} seat_models, got {len(request.seat_models)}",
        )

    # Collect required providers and look up their API keys from environment
    required_providers = {sm.provider for sm in request.seat_models}
    provider_keys: dict[str, str] = {}
    missing: list[str] = []

    for provider in required_providers:
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
            detail=f"Missing API keys in server .env: {', '.join(missing)}",
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
        # Validate all role IDs exist and distribution is correct
        try:
            from botc.engine.setup import _resolve_assigned_roles
            script_data = load_script(request.script)
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
        regroup_messages=1,
        seed=request.seed,
        max_days=request.max_days,
        max_concurrent_llm_calls=3,
        reveal_models=request.reveal_models,
        share_stats=request.share_stats,
        seat_roles=request.seat_roles,
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
async def quick_game(num_players: int = 7, seed: int = 99, reveal_models: str = "true") -> GameResponse:
    """Start a game using API keys from environment variables.

    Round-robins across available providers (Anthropic, OpenAI, Google).
    """
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
        regroup_messages=1,
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


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/api/stats/models")
async def model_stats() -> dict:
    """Return aggregate per-model performance stats from saved games."""
    from botc.api.stats import compute_model_stats
    return compute_model_stats()


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
    clip_path = GAMES_DIR / f"audio_{game_id}" / filename
    if not clip_path.exists() or not filename.endswith(".mp3"):
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
