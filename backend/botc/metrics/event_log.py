"""Append-only structured event log for game analysis and replay."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class GameEvent:
    """A single logged game event."""

    event_id: str
    game_id: str
    seq: int  # Monotonic sequence number
    timestamp: float
    event_type: str
    phase_id: str
    actor_seat: int | None = None
    data: dict = field(default_factory=dict)
    think_content: str | None = None  # Agent's private reasoning


class EventLog:
    """Records all game events as JSONL for post-game analysis and replay."""

    def __init__(self, game_id: str, output_dir: str = "./games"):
        self.game_id = game_id
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.output_path = self.output_dir / f"game_{game_id}.jsonl"
        self._events: list[GameEvent] = []
        self._seq = 0

    def record(
        self,
        event_type: str,
        phase_id: str,
        data: dict | None = None,
        actor_seat: int | None = None,
        think_content: str | None = None,
    ) -> GameEvent:
        """Record an event and append to the JSONL file."""
        self._seq += 1
        event = GameEvent(
            event_id=uuid.uuid4().hex[:12],
            game_id=self.game_id,
            seq=self._seq,
            timestamp=time.time(),
            event_type=event_type,
            phase_id=phase_id,
            actor_seat=actor_seat,
            data=data or {},
            think_content=think_content,
        )
        self._events.append(event)

        # Append to file
        with open(self.output_path, "a") as f:
            f.write(json.dumps(asdict(event), default=str) + "\n")

        return event

    @property
    def events(self) -> list[GameEvent]:
        return list(self._events)

    def load_from_file(self) -> list[GameEvent]:
        """Load events from the JSONL file (for replay)."""
        events = []
        if self.output_path.exists():
            with open(self.output_path) as f:
                for line in f:
                    data = json.loads(line.strip())
                    events.append(GameEvent(**data))
        return events

    def to_json(self) -> list[dict]:
        """Export all events as a list of dicts."""
        return [asdict(e) for e in self._events]
