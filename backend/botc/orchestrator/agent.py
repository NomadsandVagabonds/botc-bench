"""Agent wrapper: connects a Player to an LLM provider.

Uses the RECALL memory system: each turn the agent receives a single
context message (game state + self-notes + last few messages).  Continuity
comes from <MEMORY> notes, not from accumulated conversation history.
"""

from __future__ import annotations

import logging

from botc.comms.context_manager import build_agent_context
from botc.engine.types import GameState, Player
from botc.llm.prompt_builder import build_system_prompt
from botc.llm.provider import AgentConfig, LLMProvider, LLMResponse, ProviderFactory
from botc.llm.response_parser import ParsedResponse, parse_response
from botc.llm.token_tracker import TokenTracker

logger = logging.getLogger(__name__)


class Agent:
    """Wraps a Player + LLMProvider to handle all communication with the LLM.

    Each turn the agent receives a single user message containing the
    current context.  There is no accumulated conversation list — the
    agent's continuity comes from its own <MEMORY> notes stored on the
    Player object.
    """

    def __init__(
        self,
        player: Player,
        llm_config: AgentConfig,
        token_tracker: TokenTracker,
    ):
        self.player = player
        self.llm_config = llm_config
        self.provider: LLMProvider = ProviderFactory.create(llm_config)
        self.token_tracker = token_tracker

        self._system_prompt: str | None = None
        self._prompt_alive_state: bool | None = None  # Track alive state for prompt refresh

    @property
    def seat(self) -> int:
        return self.player.seat

    @property
    def agent_id(self) -> str:
        return self.llm_config.agent_id

    def initialize(self, state: GameState) -> None:
        """Build the system prompt (call once at game start, refreshed on death)."""
        self._system_prompt = build_system_prompt(self.player, state)
        self._prompt_alive_state = self.player.is_alive

    async def act(self, state: GameState) -> ParsedResponse:
        """Prompt the agent and parse their response.

        Builds the context from the current game state and sends it as
        a single user message.  No conversation history is accumulated —
        the agent's <MEMORY> notes provide continuity between turns.
        """
        if self._system_prompt is None or self._prompt_alive_state != self.player.is_alive:
            self.initialize(state)

        context = build_agent_context(self.player, state)

        # Single-message conversation: just the current context
        messages = [{"role": "user", "content": context}]

        # Call LLM
        response: LLMResponse = await self.provider.complete_with_retry(
            system_prompt=self._system_prompt,
            messages=messages,
            temperature=self.llm_config.temperature,
            max_tokens=2048,
        )

        # Track tokens
        self.token_tracker.record(
            agent_id=self.agent_id,
            model=response.model,
            phase_id=state.phase_id,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            latency_ms=response.latency_ms,
        )

        # Parse the response
        parsed = parse_response(response.content)

        # Store memory if provided
        if parsed.memory:
            from botc.engine.types import MemoryEntry
            self.player.private_memory.append(MemoryEntry(
                phase_id=state.phase_id,
                source="self_note",
                content=parsed.memory,
            ))

        logger.debug(
            "Agent %s (seat %d) responded: SAY=%s, ACTIONS=%s",
            self.agent_id, self.seat,
            parsed.say[:80] if parsed.say else "(none)",
            [a.action_type for a in parsed.actions],
        )

        return parsed

    async def act_with_recall_context(
        self, state: GameState, recall_results: str
    ) -> ParsedResponse:
        """Re-prompt the agent with RECALL search results appended.

        Called by the game runner when the agent's first response
        contained a {RECALL: query} action.  The recall results are
        appended to the normal context so the agent can use the
        information to produce their real action.
        """
        if self._system_prompt is None or self._prompt_alive_state != self.player.is_alive:
            self.initialize(state)

        context = build_agent_context(self.player, state)
        context_with_recall = (
            context
            + "\n\n"
            + recall_results
            + "\n\nYou used RECALL and the results are above. "
            "Now provide your actual response with <THINK>, <SAY>, <ACTION>, and <MEMORY>."
        )

        messages = [{"role": "user", "content": context_with_recall}]

        response: LLMResponse = await self.provider.complete_with_retry(
            system_prompt=self._system_prompt,
            messages=messages,
            temperature=self.llm_config.temperature,
            max_tokens=2048,
        )

        self.token_tracker.record(
            agent_id=self.agent_id,
            model=response.model,
            phase_id=state.phase_id,
            input_tokens=response.input_tokens,
            output_tokens=response.output_tokens,
            latency_ms=response.latency_ms,
        )

        parsed = parse_response(response.content)

        if parsed.memory:
            from botc.engine.types import MemoryEntry
            self.player.private_memory.append(MemoryEntry(
                phase_id=state.phase_id,
                source="self_note",
                content=parsed.memory,
            ))

        logger.debug(
            "Agent %s (seat %d) RECALL re-prompt: SAY=%s, ACTIONS=%s",
            self.agent_id, self.seat,
            parsed.say[:80] if parsed.say else "(none)",
            [a.action_type for a in parsed.actions],
        )

        return parsed
