"""Monitor runner — orchestrates the full post-hoc analysis of a game."""

from __future__ import annotations

import json
import logging
import time
import uuid
from pathlib import Path
from collections.abc import Callable
from typing import Any

from botc.llm.provider import AgentConfig, ProviderFactory

# Event callback: (event_type, data) -> Any
EventCallback = Callable[[str, dict[str, Any]], Any]
from botc.monitor.event_filter import (
    filter_public_events,
    format_events_for_monitor,
    segment_by_phase,
)
from botc.monitor.persistence import save_monitor_result
from botc.monitor.prompt_builder import build_phase_message, build_system_prompt
from botc.monitor.response_parser import parse_monitor_response
from botc.monitor.scoring import compute_scores

logger = logging.getLogger(__name__)

# Same directory as game persistence
_GAMES_DIR = Path(__file__).parent.parent.parent / "games"


class MonitorRunner:
    """Run a monitor agent analysis on a completed game.

    The monitor reads the game's public events phase-by-phase, rating
    each player on a 0-100 evil scale.  At the end, scores are computed
    against the ground truth.
    """

    def __init__(
        self,
        game_id: str,
        provider: str,
        model: str,
        api_key: str,
        temperature: float = 0.3,
        include_groups: bool = False,
        on_event: EventCallback | None = None,
    ) -> None:
        self.game_id = game_id
        self.provider_name = provider
        self.model = model
        self.api_key = api_key
        self.temperature = temperature
        self.include_groups = include_groups
        self.monitor_id = uuid.uuid4().hex[:8]
        self._on_event = on_event

    async def run(self) -> dict[str, Any]:
        """Run the full monitor analysis.

        Returns
        -------
        dict
            Complete monitor result including phases, ratings, bets, and scores.
        """
        start_time = time.time()

        # 1. Load the game from disk
        game_data = self._load_game()

        # 2. Extract players and ground truth from result
        result = game_data.get("result", {})
        players = result.get("players", [])
        if not players:
            raise ValueError(f"Game {self.game_id} has no player data in result")

        ground_truth: dict[int, str] = {
            p["seat"]: p["alignment"] for p in players
        }

        # Determine whether to reveal model names
        # Check game.created event for model info, or initial_state players
        reveal_models = self._should_reveal_models(game_data)
        player_info = self._build_player_info(game_data, players)

        # 3. Filter events to public only
        events = game_data.get("events", [])
        public_events = filter_public_events(events, include_groups=self.include_groups)

        # 4. Segment by phase
        segments = segment_by_phase(public_events)
        if not segments:
            raise ValueError(f"Game {self.game_id} has no public events to analyze")

        # 5. Build system prompt
        num_players = len(players)
        system_prompt = build_system_prompt(
            player_info, num_players, reveal_models=reveal_models
        )

        # 6. Create LLM provider
        agent_config = AgentConfig(
            agent_id=f"monitor-{self.monitor_id}",
            provider=self.provider_name,
            model=self.model,
            api_key=self.api_key,
            temperature=self.temperature,
        )
        llm = ProviderFactory.create(agent_config)

        # Emit start event
        self._emit("monitor.started", {
            "monitor_id": self.monitor_id,
            "game_id": self.game_id,
            "model": self.model,
            "total_phases": len(segments),
        })

        # 7. Iterate through phases
        conversation: list[dict[str, str]] = []
        phase_results: list[dict[str, Any]] = []
        all_bets: list[dict[str, Any]] = []
        locked_seats: set[int] = set()
        total_input_tokens = 0
        total_output_tokens = 0

        for phase_idx, segment in enumerate(segments):
            # Skip empty segments (e.g. setup with no events)
            if not segment["events"]:
                continue

            # a. Format events
            formatted = format_events_for_monitor(segment, player_info)

            # b. Build user message
            user_msg = build_phase_message(formatted, phase_idx)

            # c. Add to conversation
            conversation.append({"role": "user", "content": user_msg})

            # d. Call LLM
            response = await llm.complete_with_retry(
                system_prompt=system_prompt,
                messages=conversation,
                temperature=self.temperature,
                max_tokens=2048,
            )

            total_input_tokens += response.input_tokens
            total_output_tokens += response.output_tokens

            # e. Parse response
            parsed = parse_monitor_response(response.content)

            # f. Add assistant response to conversation history
            conversation.append({"role": "assistant", "content": response.content})

            # g. Track new LOCK_IN bets (only new ones, already-locked are ignored)
            new_bets: list[int] = []
            for seat in parsed["bets"]:
                if seat not in locked_seats:
                    locked_seats.add(seat)
                    new_bets.append(seat)
                    all_bets.append({
                        "seat": seat,
                        "phase_index": phase_idx,
                    })

            # h. Store phase assessment
            phase_results.append({
                "phase": segment["phase"],
                "day": segment["day"],
                "analysis": parsed["analysis"],
                "ratings": parsed["ratings"],
                "bets": new_bets,
            })

            logger.info(
                "Monitor %s phase %d/%d (%s day %d): %d ratings, %d new bets",
                self.monitor_id,
                phase_idx + 1,
                len(segments),
                segment["phase"],
                segment["day"],
                len(parsed["ratings"]),
                len(new_bets),
            )

            # Emit phase completion event for live streaming
            self._emit("monitor.phase", {
                "monitor_id": self.monitor_id,
                "phase_index": phase_idx,
                "total_phases": len(segments),
                "phase": segment["phase"],
                "day": segment["day"],
                "analysis": parsed["analysis"],
                "ratings": {str(k): v for k, v in parsed["ratings"].items()},
                "bets": new_bets,
            })

        # 8. Compute scores using final ratings
        final_ratings: dict[int, float] = {}
        if phase_results:
            final_ratings = phase_results[-1]["ratings"]

        # Annotate bets with correctness
        for bet in all_bets:
            bet["correct"] = ground_truth.get(bet["seat"]) == "evil"

        scores = compute_scores(
            final_ratings=final_ratings,
            all_bets=all_bets,
            ground_truth=ground_truth,
            total_phases=len(segments),
        )

        duration = time.time() - start_time

        # 9. Build result
        monitor_result: dict[str, Any] = {
            "monitor_id": self.monitor_id,
            "game_id": self.game_id,
            "config": {
                "provider": self.provider_name,
                "model": self.model,
                "temperature": self.temperature,
                "include_groups": self.include_groups,
            },
            "phases": phase_results,
            "final_ratings": final_ratings,
            "all_bets": all_bets,
            "scores": scores,
            "token_summary": {
                "input_tokens": total_input_tokens,
                "output_tokens": total_output_tokens,
                "total_cost_usd": self._estimate_cost(
                    total_input_tokens, total_output_tokens
                ),
            },
            "duration_seconds": round(duration, 2),
        }

        # 10. Save and return
        save_monitor_result(monitor_result)

        # Emit completion event
        self._emit("monitor.complete", monitor_result)

        return monitor_result

    def _emit(self, event_type: str, data: dict[str, Any]) -> None:
        """Fire an event callback if one was provided."""
        if self._on_event:
            self._on_event(event_type, data)

    def _load_game(self) -> dict[str, Any]:
        """Load the game JSON from disk."""
        path = _GAMES_DIR / f"game_{self.game_id}.json"
        if not path.exists():
            raise FileNotFoundError(f"Game file not found: {path}")
        return json.loads(path.read_text())

    def _should_reveal_models(self, game_data: dict[str, Any]) -> bool:
        """Determine whether model names should be shown to the monitor.

        Checks the game.created event for model fields, or falls back to
        initial_state player model_name fields.
        """
        # Check game.created event for model info
        for event in game_data.get("events", []):
            if event.get("type") == "game.created":
                event_players = event.get("data", {}).get("players", [])
                if event_players and event_players[0].get("model"):
                    return True
                return False

        # Check initial_state
        initial = game_data.get("initial_state", {})
        for p in initial.get("players", []):
            if p.get("model_name"):
                return True

        return False

    def _build_player_info(
        self,
        game_data: dict[str, Any],
        result_players: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Build a unified player info list with character names and optional models.

        Merges data from game.created event (has model names) with the
        result players (has roles/alignment — but we don't pass those to
        the monitor prompt).
        """
        # Start with result players (has seat + character_name)
        info: dict[int, dict[str, Any]] = {}
        for p in result_players:
            seat = p["seat"]
            info[seat] = {
                "seat": seat,
                "character_name": p.get("character_name", f"Seat {seat}"),
            }

        # Enrich with model names from game.created event
        for event in game_data.get("events", []):
            if event.get("type") == "game.created":
                for ep in event.get("data", {}).get("players", []):
                    seat = ep.get("seat")
                    if seat is not None and seat in info:
                        if ep.get("model"):
                            info[seat]["model"] = ep["model"]
                break

        # Fallback: model names from initial_state
        if not any("model" in v for v in info.values()):
            for p in game_data.get("initial_state", {}).get("players", []):
                seat = p.get("seat")
                if seat is not None and seat in info and p.get("model_name"):
                    info[seat]["model_name"] = p["model_name"]

        return [info[s] for s in sorted(info.keys())]

    def _estimate_cost(self, input_tokens: int, output_tokens: int) -> float:
        """Rough cost estimate in USD based on provider and model."""
        model_lower = self.model.lower()

        # Anthropic pricing (per 1M tokens)
        if "opus" in model_lower:
            return (input_tokens * 15.0 + output_tokens * 75.0) / 1_000_000
        if "sonnet" in model_lower:
            return (input_tokens * 3.0 + output_tokens * 15.0) / 1_000_000
        if "haiku" in model_lower:
            return (input_tokens * 0.80 + output_tokens * 4.0) / 1_000_000

        # OpenAI pricing
        if "gpt-4o-mini" in model_lower:
            return (input_tokens * 0.15 + output_tokens * 0.60) / 1_000_000
        if "gpt-4o" in model_lower:
            return (input_tokens * 2.50 + output_tokens * 10.0) / 1_000_000
        if "gpt-5" in model_lower:
            return (input_tokens * 2.50 + output_tokens * 10.0) / 1_000_000
        if "o3" in model_lower or "o4" in model_lower:
            return (input_tokens * 10.0 + output_tokens * 40.0) / 1_000_000

        # Google pricing
        if "gemini" in model_lower:
            return (input_tokens * 0.075 + output_tokens * 0.30) / 1_000_000

        # Default fallback
        return (input_tokens * 3.0 + output_tokens * 15.0) / 1_000_000
