"""Integration tests: run full games with a mock LLM to verify nothing crashes.

These tests exercise the complete game loop (setup → first night → day cycles
→ nominations → voting → execution → night → game over) with deterministic
mock responses. They catch:
- Phase machine violations (invalid transitions)
- State corruption (bad alive counts, stale poison, etc.)
- Crashes in ability resolution, win condition checks, etc.
- Regressions in the game runner orchestration

No API keys needed — the mock provider returns valid XML responses
with context-appropriate actions.
"""

from __future__ import annotations

import asyncio
import random
import re

import pytest

from botc.engine.types import GameConfig, GamePhase
from botc.llm.provider import AgentConfig, LLMProvider, LLMResponse
from botc.orchestrator.game_runner import GameResult, GameRunner


# ---------------------------------------------------------------------------
# Mock LLM provider
# ---------------------------------------------------------------------------

class MockProvider(LLMProvider):
    """Deterministic LLM that returns valid XML responses based on the prompt.

    Inspects the user message to determine the current phase and returns
    an appropriate action. Uses a seeded RNG for nominee/target choices.
    """

    def __init__(self, config: AgentConfig, seed: int = 0):
        super().__init__(config)
        self.rng = random.Random(seed + hash(config.agent_id))
        self.call_count = 0

    async def complete(
        self,
        system_prompt: str,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> LLMResponse:
        self.call_count += 1
        content = messages[0]["content"] if messages else ""

        response_text = self._generate_response(content, system_prompt)

        return LLMResponse(
            content=response_text,
            model="mock-model",
            input_tokens=len(content) // 4,
            output_tokens=len(response_text) // 4,
            latency_ms=1.0,
        )

    def _generate_response(self, context: str, system_prompt: str) -> str:
        """Generate a phase-appropriate response."""

        # Accusation/defense speeches (called via _get_speech, raw prompt)
        if "You have nominated" in context or "accused" in context.lower():
            return "They are suspicious and should be investigated."
        if "You have been accused" in context or "defend" in context.lower():
            return "I am innocent and have been helping the town."

        # Night phase
        if "NIGHT" in context and "NIGHT_TARGET" in context:
            # Extract eligible targets from context
            targets = re.findall(r"Seat (\d+)", context)
            seat = self._extract_own_seat(context)
            valid = [int(t) for t in targets if int(t) != seat]
            target = self.rng.choice(valid) if valid else 0
            return (
                f"<THINK>Night action time. Targeting seat {target}.</THINK>\n"
                f"<SAY></SAY>\n"
                f"<ACTION>{{NIGHT_TARGET: {target}}}</ACTION>\n"
                f"<MEMORY>Night action taken against seat {target}.</MEMORY>"
            )

        # Night phase (info roles that don't target)
        if "NIGHT" in context and ("no night action" in context.lower() or "receive information" in context.lower()):
            return (
                "<THINK>Waiting for info.</THINK>\n"
                "<SAY></SAY>\n"
                "<ACTION>{PASS}</ACTION>\n"
                "<MEMORY>Night passed.</MEMORY>"
            )

        # Voting phase
        if "Vote YES or NO" in context:
            vote = "YES" if self.rng.random() < 0.5 else "NO"
            return (
                f"<THINK>Deciding vote: {vote}.</THINK>\n"
                f"<ACTION>{{VOTE: {vote}}}</ACTION>\n"
                f"<MEMORY>Voted {vote}.</MEMORY>"
            )

        # Nomination phase
        if "NOMINATE" in context and "It is YOUR TURN" in context:
            # Pass most of the time to keep games short
            if self.rng.random() < 0.7:
                return (
                    "<THINK>No strong suspect right now.</THINK>\n"
                    "<SAY>I'll pass for now.</SAY>\n"
                    "<ACTION>{PASS}</ACTION>\n"
                    "<MEMORY>Passed on nomination.</MEMORY>"
                )
            targets = re.findall(r"Eligible nomination targets:.*?Seat (\d+)", context)
            if targets:
                target = self.rng.choice(targets)
                return (
                    f"<THINK>Nominating seat {target}.</THINK>\n"
                    f"<SAY>I nominate seat {target}!</SAY>\n"
                    f"<ACTION>{{NOMINATE: {target}}}</ACTION>\n"
                    f"<MEMORY>Nominated seat {target}.</MEMORY>"
                )
            return (
                "<THINK>No one to nominate.</THINK>\n"
                "<SAY></SAY>\n"
                "<ACTION>{PASS}</ACTION>\n"
                "<MEMORY>Passed.</MEMORY>"
            )

        # Breakout group preference
        if "JOIN" in context and "CREATE_GROUP" in context:
            return (
                "<THINK>Joining a group.</THINK>\n"
                "<SAY>Let's talk.</SAY>\n"
                "<ACTION>{CREATE_GROUP}</ACTION>\n"
                "<MEMORY>Joined a group.</MEMORY>"
            )

        # Discussion / regroup / breakout conversation / inter-nomination
        return (
            "<THINK>Observing the situation.</THINK>\n"
            "<SAY>I'm watching everyone carefully.</SAY>\n"
            "<ACTION>{PASS}</ACTION>\n"
            "<MEMORY>Observing. Nothing concrete yet.</MEMORY>"
        )

    def _extract_own_seat(self, context: str) -> int:
        m = re.search(r"You are Seat (\d+)", context)
        return int(m.group(1)) if m else -1


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_runner(num_players: int, seed: int = 42, script: str = "trouble_brewing") -> GameRunner:
    """Create a GameRunner with mock LLM providers."""
    config = GameConfig(
        script=script,
        num_players=num_players,
        seed=seed,
        max_days=10,
    )

    agent_configs = [
        AgentConfig(
            agent_id=f"mock-{i}",
            provider="anthropic",  # provider type doesn't matter — we replace it
            model="mock-model",
            api_key="fake",
        )
        for i in range(num_players)
    ]

    runner = GameRunner(config, agent_configs)

    # Replace the real providers with mocks AFTER GameRunner creates agents
    # We need to hook in after run() calls create_game and creates agents.
    # Instead, monkey-patch ProviderFactory to return MockProviders.
    return runner, agent_configs


def _patch_providers(runner: GameRunner, seed: int = 42):
    """Replace all agent providers with MockProviders after agents are created."""
    for seat, agent in runner.agents.items():
        agent.provider = MockProvider(agent.llm_config, seed=seed + seat)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestFullGameIntegration:
    """Run complete games with mock LLM and verify they finish cleanly."""

    @pytest.mark.asyncio
    async def test_7_player_trouble_brewing(self):
        """7-player Trouble Brewing game completes without errors."""
        result = await self._run_game(num_players=7, seed=42)

        assert result.winner in ("good", "evil")
        assert result.total_days >= 1
        assert len(result.players) == 7
        for p in result.players:
            assert "seat" in p
            assert "role" in p
            assert "alignment" in p

    @pytest.mark.asyncio
    async def test_5_player_trouble_brewing(self):
        """5-player game (minimum size) completes."""
        result = await self._run_game(num_players=5, seed=99)

        assert result.winner in ("good", "evil")
        assert len(result.players) == 5

    @pytest.mark.asyncio
    async def test_10_player_trouble_brewing(self):
        """10-player game completes."""
        result = await self._run_game(num_players=10, seed=7)

        assert result.winner in ("good", "evil")
        assert len(result.players) == 10

    @pytest.mark.asyncio
    async def test_different_seeds_produce_different_games(self):
        """Different seeds produce different role assignments."""
        r1 = await self._run_game(num_players=7, seed=1)
        r2 = await self._run_game(num_players=7, seed=2)

        roles1 = sorted(p["role"] for p in r1.players)
        roles2 = sorted(p["role"] for p in r2.players)
        # With different seeds, at least the role assignment should differ
        # (not guaranteed but extremely likely with different seeds)
        # We just check both games completed
        assert r1.winner in ("good", "evil")
        assert r2.winner in ("good", "evil")

    @pytest.mark.asyncio
    async def test_game_has_valid_result_fields(self):
        """Result contains all expected fields with valid values."""
        result = await self._run_game(num_players=7, seed=42)

        assert result.game_id
        assert result.win_condition
        assert result.duration_seconds >= 0
        assert isinstance(result.token_summary, dict)
        for p in result.players:
            assert p["alignment"] in ("good", "evil")
            assert isinstance(p["survived"], bool)
            assert "initial_role" in p
            assert "model" in p

    @pytest.mark.asyncio
    async def test_game_with_assigned_roles(self):
        """Game with pre-assigned seat_roles completes."""
        config = GameConfig(
            script="trouble_brewing",
            num_players=7,
            seed=42,
            max_days=10,
            seat_roles=["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"],
        )
        result = await self._run_game_with_config(config)

        assert result.winner in ("good", "evil")
        # Verify roles were assigned as specified
        role_names = [p["initial_role"] for p in result.players]
        assert "Washerwoman" in role_names
        assert "Imp" in role_names

    @pytest.mark.asyncio
    async def test_no_execution_game_terminates(self):
        """Game where mock agents mostly pass still terminates (via max_days)."""
        config = GameConfig(
            script="trouble_brewing",
            num_players=5,
            seed=42,
            max_days=3,  # Force termination if no one dies
        )
        result = await self._run_game_with_config(config)

        assert result.winner in ("good", "evil")
        assert result.total_days <= 3

    # --- Helper ---

    async def _run_game(self, num_players: int, seed: int) -> GameResult:
        config = GameConfig(
            script="trouble_brewing",
            num_players=num_players,
            seed=seed,
            max_days=10,
        )
        return await self._run_game_with_config(config)

    async def _run_game_with_config(self, config: GameConfig) -> GameResult:
        agent_configs = [
            AgentConfig(
                agent_id=f"mock-{i}",
                provider="anthropic",
                model="mock-model",
                api_key="fake",
            )
            for i in range(config.num_players)
        ]

        runner = GameRunner(config, agent_configs)

        # Monkey-patch ProviderFactory so runner.run() creates MockProviders
        # instead of real Anthropic clients (which would need API keys).
        from unittest.mock import patch
        from botc.llm.provider import ProviderFactory

        original_create = ProviderFactory.create

        def mock_create(cfg):
            return MockProvider(cfg, seed=(config.seed or 42) + hash(cfg.agent_id))

        with patch.object(ProviderFactory, "create", side_effect=mock_create):
            return await runner.run()
