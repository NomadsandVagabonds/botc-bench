"""WebSocket manager for live game observation."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages WebSocket connections for game observation.

    Multiple observers can connect to watch a game in real-time.
    Events are broadcast to all connected observers.
    """

    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = {}  # game_id -> websockets
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, game_id: str) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.setdefault(game_id, []).append(websocket)
        logger.info("Observer connected to game %s", game_id)

    async def disconnect(self, websocket: WebSocket, game_id: str) -> None:
        async with self._lock:
            conns = self._connections.get(game_id, [])
            if websocket in conns:
                conns.remove(websocket)
            if not conns:
                self._connections.pop(game_id, None)
        logger.info("Observer disconnected from game %s", game_id)

    async def broadcast(self, game_id: str, event_type: str, data: dict) -> None:
        """Send an event to all observers of a game."""
        message = json.dumps({"type": event_type, "data": data})
        async with self._lock:
            conns = list(self._connections.get(game_id, []))

        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(message)
            except (WebSocketDisconnect, RuntimeError):
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    conns = self._connections.get(game_id, [])
                    if ws in conns:
                        conns.remove(ws)

    def observer_count(self, game_id: str) -> int:
        return len(self._connections.get(game_id, []))


# Singleton instance
ws_manager = WebSocketManager()
