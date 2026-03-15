"""REST + WebSocket API routes."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from botc.api.websocket import ws_manager
from botc.engine.roles import load_script
from botc.engine.types import BreakoutConfig, GameConfig, ROLE_DISTRIBUTION, RoleType
from botc.llm.provider import AgentConfig
from botc.orchestrator.game_runner import GameResult, GameRunner

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory game registry
_games: dict[str, dict[str, Any]] = {}
_runners: dict[str, GameRunner] = {}


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
    messages_per_agent: int = 3
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
    reveal_models: bool = True


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
    reveal_models: bool = True


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
}


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
            logger.info("Game %s completed: %s wins", game_id, result.winner)
        except Exception:
            logger.exception("Game failed")

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
            logger.info("Game %s completed: %s wins", game_id, result.winner)
        except Exception:
            logger.exception("Game failed")
            if runner.state:
                _games[runner.state.game_id] = {"status": "failed"}

    task = asyncio.create_task(run_game())

    await asyncio.sleep(0.2)
    game_id = runner.state.game_id if runner.state else "pending"
    _games[game_id] = {"status": "running", "runner": runner, "task": task}
    _runners[game_id] = runner

    return GameResponse(game_id=game_id, status="running")


@router.post("/api/games/quick", response_model=GameResponse)
async def quick_game(num_players: int = 7, seed: int = 99, reveal_models: bool = True) -> GameResponse:
    """Start a game using API keys from environment variables.

    Round-robins across available providers (Anthropic, OpenAI, Google).
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    google_key = os.environ.get("GOOGLE_API_KEY", "")

    providers: list[tuple[str, str, str, str]] = []
    if anthropic_key:
        providers.append(("anthropic", "claude-haiku-4-5-20251001", anthropic_key, "Claude"))
    if openai_key:
        providers.append(("openai", "gpt-4o-mini", openai_key, "GPT"))
    if google_key:
        providers.append(("google", "gemini-2.5-flash", google_key, "Gemini"))

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
            logger.info("Game %s completed: %s wins", game_id, result.winner)
        except Exception:
            logger.exception("Game failed")
            if runner.state:
                _games[runner.state.game_id] = {"status": "failed"}

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
            result: GameResult = info["result"]
            resp.winner = result.winner
            resp.total_days = result.total_days
        results.append(resp)
    return results


@router.get("/api/games/{game_id}")
async def get_game(game_id: str) -> dict:
    """Get game state or result."""
    if game_id not in _games:
        return {"error": "Game not found"}

    info = _games[game_id]
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
# WebSocket
# ---------------------------------------------------------------------------

@router.websocket("/ws/game/{game_id}")
async def game_websocket(websocket: WebSocket, game_id: str):
    """WebSocket endpoint for live game observation."""
    await ws_manager.connect(websocket, game_id)

    # Send current state if game is running
    runner = _runners.get(game_id)
    if runner and runner.state:
        from botc.engine.state import snapshot_observer
        await websocket.send_json({
            "type": "game.state",
            "data": snapshot_observer(runner.state),
        })

        # Replay historical events so late-joining clients can catch up.
        # Events are sent as a single batch to avoid flooding with individual frames.
        if runner.event_history:
            await websocket.send_json({
                "type": "event.history",
                "data": {
                    "events": runner.event_history,
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
