"""Top-level async game loop that drives a full BotC game.

Orchestrates phase handlers, LLM calls, and event broadcasting.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from botc.comms.context_manager import build_recall_results
from botc.comms.group_manager import add_group_message, create_groups
from botc.comms.whisper_manager import send_whisper
from botc.engine.abilities import (
    FIRST_NIGHT_ACTION_ABILITIES,
    OTHER_NIGHT_ACTION_ABILITIES,
    answer_artist_question,
    check_scarlet_woman,
    deliver_juggler_info,
    deliver_savant_info,
    on_player_death,
    resolve_slayer_shot,
)
from botc.engine.day import (
    can_be_nominated,
    can_nominate,
    can_vote,
    process_nomination,
    process_vote,
    resolve_execution,
)
from botc.engine.night import resolve_first_night, resolve_night
from botc.engine.roles import load_script
from botc.engine.phase_machine import (
    should_skip_breakout,
    transition,
)
from botc.engine.setup import create_game
from botc.engine.types import (
    Alignment,
    GameConfig,
    GamePhase,
    GameState,
    Message,
    MessageType,
    NightAction,
    RoleType,
)
from botc.engine.win_conditions import check_win_conditions
from botc.llm.prompt_builder import (
    build_accusation_prompt,
    build_debrief_prompt,
    build_defense_prompt,
    build_inter_nomination_prompt,
    build_pre_nomination_prompt,
)
from botc.llm.provider import AgentConfig
from botc.llm.response_parser import ParsedResponse, parse_response
from botc.llm.token_tracker import TokenTracker
from botc.orchestrator.agent import Agent

logger = logging.getLogger(__name__)


def _sanitize_speech(raw_text: str) -> tuple[str, str]:
    """Separate public speech from internal/command content.

    Returns (clean_speech, internal_content) where:
    - clean_speech: what other agents see in their context
    - internal_content: stripped material (observer-only, may be empty)
    """
    internal_parts: list[str] = []
    text = raw_text

    # Strip <THINK>...</THINK> blocks (case-insensitive, handle unclosed)
    def _collect_think(m: re.Match) -> str:
        internal_parts.append(m.group(0))
        return ""
    text = re.sub(r"<THINK>.*?</THINK>", _collect_think, text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<THINK>.*", _collect_think, text, flags=re.DOTALL | re.IGNORECASE)

    # Strip <MEMORY>...</MEMORY> blocks
    def _collect_memory(m: re.Match) -> str:
        internal_parts.append(m.group(0))
        return ""
    text = re.sub(r"<MEMORY>.*?</MEMORY>", _collect_memory, text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"<MEMORY>.*", _collect_memory, text, flags=re.DOTALL | re.IGNORECASE)

    # Strip remaining XML tags (SAY, ACTION, MEMORY, THINK wrappers)
    text = re.sub(r"</?(?:SAY|ACTION|MEMORY|THINK)[^>]*>", "", text, flags=re.IGNORECASE)
    # Strip truncated XML tags at end of response (e.g. "<S", "<SAY" without closing ">")
    text = re.sub(r"</?(?:SAY|ACTION|MEMORY|THINK)\s*$", "", text, flags=re.IGNORECASE)
    # Strip truncated partial tag starts (e.g. "<S" at end of text)
    text = re.sub(r"<[A-Z]{1,6}\s*$", "", text.rstrip())

    # Strip command patterns from the text, collecting them as internal
    # (patterns handle both closed {TYPE: ...} and truncated {TYPE: ... without closing brace)
    command_patterns = [
        r"\{PASS\}",
        r"\{NOMINATE:\s*[^}]*\}?",
        r"\{RECALL:\s*[^}]*\}?",
        r"\(RECALL:\s*[^)]*\)?",
        r"\{VOTE:\s*[^}]*\}?",
        r"\{SLAYER_SHOT:\s*[^}]*\}?",
        r"\{WHISPER:\s*[^}]*\}?",
        r"\{JOIN:\s*[^}]*\}?",
        r"\{NIGHT_TARGET[^}]*\}?",
        r"\{CREATE_GROUP\}?",
    ]
    for pat in command_patterns:
        def _collect_cmd(m: re.Match, _pat=pat) -> str:
            internal_parts.append(m.group(0))
            return ""
        text = re.sub(pat, _collect_cmd, text, flags=re.IGNORECASE)

    # Strip lines that look like internal notes (evil team info, analysis)
    filtered_lines: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("**EVIL TEAM"):
            internal_parts.append(stripped)
        elif stripped.startswith("- Bluffs available"):
            internal_parts.append(stripped)
        elif stripped.startswith("- **CRITICAL"):
            internal_parts.append(stripped)
        elif stripped.startswith("- Prime Suspects:"):
            internal_parts.append(stripped)
        elif stripped.startswith("- Secondary Suspects:"):
            internal_parts.append(stripped)
        else:
            filtered_lines.append(line)

    clean = "\n".join(filtered_lines).strip()

    # Bare "PASS" (without braces) as entire message → treat as pass action
    if clean.upper() == "PASS":
        internal_parts.append("PASS")
        clean = ""

    internal = "\n".join(internal_parts).strip()
    return clean, internal

_DEMON_NIGHT_ACTION_ROLES = {
    "imp",
    "fang_gu",
    "vigormortis",
    "no_dashii",
    "vortox",
    "po",
    "pukka",
    "shabaloth",
    "zombuul",
}


# ---------------------------------------------------------------------------
# Game result
# ---------------------------------------------------------------------------

@dataclass
class GameResult:
    game_id: str
    winner: str  # "good" or "evil"
    win_condition: str
    total_days: int
    players: list[dict]  # seat, agent_id, role, alignment, survived
    token_summary: dict
    duration_seconds: float


# ---------------------------------------------------------------------------
# Event callback
# ---------------------------------------------------------------------------

EventCallback = Callable[[str, dict[str, Any]], Any]  # (event_type, data)


# ---------------------------------------------------------------------------
# Game runner
# ---------------------------------------------------------------------------

class GameRunner:
    """Drives a complete BotC game from setup to game over."""

    def __init__(
        self,
        game_config: GameConfig,
        agent_configs: list[AgentConfig],
        on_event: EventCallback | None = None,
    ):
        self.game_config = game_config
        self.agent_configs = agent_configs
        self.on_event = on_event or (lambda *_: None)
        self.token_tracker = TokenTracker()
        self.state: GameState | None = None
        self.agents: dict[int, Agent] = {}
        self._paused = False
        self._start_time: float = 0

        # Chronological log of all broadcast events for late-joining clients
        self.event_history: list[dict[str, Any]] = []

        # Captured at game start for accurate replay and result enrichment
        self._initial_snapshot: dict[str, Any] | None = None
        self._initial_roles: dict[int, str] = {}

        # Per-provider semaphores: allow N concurrent calls per provider,
        # but different providers fire in parallel (independent rate limits)
        self._provider_semaphores: dict[str, asyncio.Semaphore] = {}
        for config in agent_configs:
            if config.provider not in self._provider_semaphores:
                self._provider_semaphores[config.provider] = asyncio.Semaphore(
                    game_config.max_concurrent_llm_calls
                )

    async def run(self) -> GameResult:
        """Run a complete game. Returns when a winner is determined."""
        self._start_time = time.time()

        # Setup
        agent_ids = [c.agent_id for c in self.agent_configs]
        self.state = create_game(self.game_config, agent_ids)
        state = self.state
        self._validate_roles_match_script(state)

        # Capture initial state before any mutations (for replay and result enrichment)
        from botc.engine.state import snapshot_observer
        self._initial_snapshot = snapshot_observer(state)
        self._initial_roles = {p.seat: p.role.name for p in state.players}

        # Create agents and store model info on players
        all_model_ids = [c.model for c in self.agent_configs]
        for i, config in enumerate(self.agent_configs):
            player = state.players[i]
            player.model_name = config.model
            # Set display name based on reveal_models mode
            reveal = state.config.reveal_models
            if reveal in (True, "true"):
                player.display_model_name = config.model
            elif reveal == "scramble":
                # Assign a random (mostly incorrect) model name from the pool
                import random as _rng
                other_models = [m for m in all_model_ids if m != config.model]
                if other_models:
                    player.display_model_name = _rng.choice(other_models)
                else:
                    player.display_model_name = config.model  # fallback if all same model
            else:
                player.display_model_name = ""
            agent = Agent(player, config, self.token_tracker)
            agent.initialize(state)
            self.agents[i] = agent

        self._emit("game.created", {
            "game_id": state.game_id,
            "players": [
                {"seat": p.seat, "agent_id": p.agent_id, "character_name": p.character_name, "model": self.agent_configs[p.seat].model}
                for p in state.players
            ],
        })

        # Emit initial observer snapshot so event_history is self-contained for replay
        from botc.engine.state import snapshot_observer
        self._emit("game.state", snapshot_observer(state))

        # First night
        await self._run_first_night(state)
        self._validate_roles_match_script(state)

        # Main game loop
        while state.phase != GamePhase.GAME_OVER:
            # Check for win
            result = check_win_conditions(state)
            if result:
                state.winner = result.alignment
                state.win_condition = result.reason
                transition(state, GamePhase.GAME_OVER)
                break

            # Start new day
            transition(state, GamePhase.DAY_DISCUSSION)
            self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})

            # Day-start private information (e.g. Savant).
            msg_count_before = len(state.all_messages)
            deliver_savant_info(state)
            self._broadcast_new_messages(state, msg_count_before)

            # Day discussion (opening statements)
            if state.config.opening_statements:
                await self._run_discussion(state)

            # Breakout rounds (no regroup — agents retain context via RECALL/self-notes)
            if not should_skip_breakout(state):
                for round_num in range(state.config.breakout.num_rounds):
                    transition(state, GamePhase.DAY_BREAKOUT)
                    self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number, "round": state.breakout_round})
                    await self._run_breakout_round(state)

            # Nominations + voting (sequential, one at a time)
            transition(state, GamePhase.NOMINATIONS)
            self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})
            game_over = await self._run_nomination_phase(state)
            if game_over:
                break

            # Night
            transition(state, GamePhase.NIGHT)
            self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})
            await self._run_night(state)
            self._validate_roles_match_script(state)

            # Check win after night kills
            result = check_win_conditions(state)
            if result:
                state.winner = result.alignment
                state.win_condition = result.reason
                transition(state, GamePhase.GAME_OVER)
                break

            # Safety cap
            if state.day_number >= state.config.max_days:
                result = check_win_conditions(state)
                if result:
                    state.winner = result.alignment
                    state.win_condition = result.reason
                else:
                    from botc.engine.types import Alignment
                    state.winner = Alignment.EVIL
                    state.win_condition = "Maximum days reached."
                transition(state, GamePhase.GAME_OVER)
                break

        self._emit("game.over", {
            "winner": state.winner.value if state.winner else "unknown",
            "reason": state.win_condition or "",
        })

        # --- Debrief phase: all agents react to the reveal ---
        await self._run_debrief(state)

        return self._compile_result(state)

    def _validate_roles_match_script(self, state: GameState) -> None:
        """Assert that every in-play role belongs to the current script."""
        script = load_script(state.config.script)
        valid_role_ids = set(script.roles.keys())
        mismatches = [
            (player.seat, player.role.id)
            for player in state.players
            if player.role.id not in valid_role_ids
        ]
        if not mismatches:
            return
        mismatch_text = ", ".join(
            f"Seat {seat}: {role_id}" for seat, role_id in mismatches
        )
        raise RuntimeError(
            f"Script-role mismatch in '{state.config.script}'. Invalid roles in play: {mismatch_text}"
        )

    # -------------------------------------------------------------------
    # Phase handlers
    # -------------------------------------------------------------------

    async def _run_first_night(self, state: GameState) -> None:
        transition(state, GamePhase.FIRST_NIGHT)
        self._emit("phase.change", {"phase": state.phase.value, "day": 0})

        # Collect night actions from roles that act
        actions = await self._collect_night_actions(state, first_night=True)

        # Emit night.action events for observer mode (before resolution)
        self._emit_night_actions(state, actions, first_night=True)

        msg_count_before = len(state.all_messages)
        resolve_first_night(state, actions)
        self._broadcast_new_messages(state, msg_count_before)

        # Announce deaths (none on first night normally, but just in case)
        if state.night_kills:
            for seat in state.night_kills:
                player = state.player_at(seat)
                self._emit("death", {
                    "seat": seat,
                    "cause": "night_kill",
                    "death_cause": player.death_cause,
                    "death_day": player.death_day,
                    "death_phase": player.death_phase,
                })

    async def _run_debrief(self, state: GameState) -> None:
        """Run the post-game debrief: reveal the Grimoire and let all agents react.

        ALL agents (alive + dead) are prompted in parallel with the full
        game reveal. Their responses are broadcast as debrief.message events.
        """
        transition(state, GamePhase.DEBRIEF)
        self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})

        # Prompt all agents in parallel
        debrief_tasks: dict[int, asyncio.Task] = {}

        for seat, agent in self.agents.items():
            debrief_tasks[seat] = asyncio.create_task(
                self._debrief_agent(agent, state),
                name=f"debrief_{seat}",
            )

        results = await asyncio.gather(
            *debrief_tasks.values(), return_exceptions=True
        )

        for seat, result in zip(debrief_tasks.keys(), results):
            if isinstance(result, Exception):
                logger.error("Debrief failed for seat %d: %s", seat, result)
                continue

            response_text: str = result
            player = state.player_at(seat)
            self._emit("debrief.message", {
                "seat": seat,
                "agent_id": player.agent_id,
                "character_name": player.character_name,
                "role": player.role.name,
                "alignment": player.alignment.value,
                "content": response_text,
                "survived": player.is_alive,
            })

    async def _debrief_agent(self, agent: Agent, state: GameState) -> str:
        """Prompt a single agent for their debrief reaction."""
        player = agent.player
        debrief_prompt = build_debrief_prompt(player, state)

        provider = self.agent_configs[agent.seat].provider
        sem = self._provider_semaphores.get(provider)

        async def call():
            response = await agent.provider.complete_with_retry(
                system_prompt=(
                    "You just finished a game of Blood on the Clocktower. "
                    "The Grimoire (all hidden information) is being revealed. "
                    "React naturally and briefly — no XML tags needed."
                ),
                messages=[{"role": "user", "content": debrief_prompt}],
                temperature=0.9,
                max_tokens=150,
            )
            self._record_tokens(
                agent_id=agent.agent_id,
                model=response.model,
                phase_id=state.phase_id,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
                latency_ms=response.latency_ms,
                seat=agent.seat,
            )
            return response.content.strip()

        if sem:
            async with sem:
                return await call()
        return await call()

    async def _run_night(self, state: GameState) -> None:
        actions = await self._collect_night_actions(state, first_night=False)

        # Emit night.action events for observer mode (before resolution)
        self._emit_night_actions(state, actions, first_night=False)

        dead_before = {p.seat for p in state.players if not p.is_alive}

        msg_count_before = len(state.all_messages)
        deaths = resolve_night(state, actions)
        self._broadcast_new_messages(state, msg_count_before)
        revived_seats = sorted(
            seat for seat in dead_before if state.player_at(seat).is_alive
        )

        # Juggler learns number of correct day-1 guesses on the first eligible night.
        msg_count_before = len(state.all_messages)
        deliver_juggler_info(state)
        self._broadcast_new_messages(state, msg_count_before)

        # Announce deaths with storyteller narration
        for seat in deaths:
            player = state.player_at(seat)
            narration = await self._narrate_death(player, state)
            state.add_message(Message.system(
                state.phase_id,
                narration,
            ))
            self._emit("death", {
                "seat": seat,
                "role": player.role.name,
                "cause": "night_kill",
                "death_cause": player.death_cause,
                "death_day": player.death_day,
                "death_phase": player.death_phase,
            })
            self._emit("message.new", {
                "seat": None,
                "content": narration,
                "type": "narration",
                "phase": state.phase.value,
                "day": state.day_number,
            })
            # Notify the dead player of their new status
            self._send_death_notification(player, state)

        # Dawn announcements for players who became alive again overnight.
        for seat in revived_seats:
            player = state.player_at(seat)
            announcement = f"At dawn, {player.character_name} is alive again."
            state.add_message(Message.system(
                state.phase_id,
                announcement,
            ))
            self._emit("resurrection", {
                "seat": seat,
                "cause": "night_resurrection",
            })
            self._emit("message.new", {
                "seat": None,
                "content": announcement,
                "type": "system",
                "phase": state.phase.value,
                "day": state.day_number,
            })

    async def _collect_night_actions(
        self, state: GameState, *, first_night: bool
    ) -> dict[int, NightAction]:
        """Prompt all night-active roles in parallel, collect their targets."""
        tasks: dict[int, asyncio.Task] = {}

        for agent in self.agents.values():
            player = agent.player
            if not player.is_alive and not (
                player.role.role_type == RoleType.MINION
                and player.hidden_state.get("vigormortis_keeps_ability", False)
            ):
                continue

            role_id = player.effective_role.id
            if first_night:
                has_action = role_id in FIRST_NIGHT_ACTION_ABILITIES
            else:
                has_action = (
                    role_id in OTHER_NIGHT_ACTION_ABILITIES
                    or role_id in _DEMON_NIGHT_ACTION_ROLES
                    or role_id == "ravenkeeper"
                )
            if not has_action:
                continue

            tasks[player.seat] = asyncio.create_task(
                self._agent_act(agent, state, max_tokens=self._phase_tokens("night"), phase_key="night"),
                name=f"night_{player.seat}",
            )

        # Gather results
        results = await asyncio.gather(
            *tasks.values(), return_exceptions=True
        )

        actions: dict[int, NightAction] = {}
        for seat, result in zip(tasks.keys(), results):
            if isinstance(result, Exception):
                logger.error("Night action failed for seat %d: %s", seat, result)
                # Even on LLM failure, generate a fallback for critical roles
                role_id = state.player_at(seat).role.id
                fallback = self._fallback_night_action(state, seat, role_id)
                if fallback is not None:
                    logger.info("Fallback night action for seat %d (%s)", seat, role_id)
                    actions[seat] = fallback
                continue

            parsed: ParsedResponse = result
            parsed = await self._handle_recall_if_needed(
                self.agents[seat], state, parsed
            )
            role_id = state.player_at(seat).role.id
            action = self._extract_night_action(parsed, seat=seat, role_id=role_id)
            if action is not None:
                actions[seat] = action
            else:
                # LLM didn't provide a valid target — use smart fallback
                fallback = self._fallback_night_action(state, seat, role_id)
                if fallback is not None:
                    logger.info("Fallback night action for seat %d (%s): targets=%s", seat, role_id, fallback.targets)
                    actions[seat] = fallback

        return actions

    async def _run_discussion(self, state: GameState) -> None:
        """Parallel opening statements — agents reveal info or pass."""
        discussion_tasks: dict[int, asyncio.Task] = {}
        for player in state.players:
            discussion_tasks[player.seat] = asyncio.create_task(
                self._agent_act(self.agents[player.seat], state,
                                max_tokens=self._phase_tokens("discussion"),
                                phase_key="discussion")
            )

        results = await asyncio.gather(*discussion_tasks.values(), return_exceptions=True)

        for seat, result in zip(discussion_tasks.keys(), results):
            if isinstance(result, Exception):
                logger.error("Discussion failed for seat %d: %s", seat, result)
                continue

            parsed: ParsedResponse = result
            parsed = await self._handle_recall_if_needed(self.agents[seat], state, parsed)

            self._handle_day_special_actions(self.agents[seat], state, parsed)
            self._check_slayer_shot(self.agents[seat], state, parsed)

            if parsed.say:
                clean_say, internal_say = _sanitize_speech(parsed.say)
                if clean_say:
                    msg = Message(
                        id=uuid.uuid4().hex,
                        type=MessageType.PUBLIC_SPEECH,
                        phase_id=state.phase_id,
                        sender_seat=seat,
                        content=clean_say,
                    )
                    state.add_message(msg)
                    emit_data: dict[str, Any] = {
                        "seat": seat,
                        "content": clean_say,
                        "type": "public",
                        "phase": state.phase.value,
                        "day": state.day_number,
                    }
                    if internal_say:
                        emit_data["internal"] = internal_say
                    self._emit("message.new", emit_data)

            if parsed.think:
                self._emit("player.reasoning", {
                    "seat": seat,
                    "reasoning": parsed.think,
                })

    async def _run_breakout_round(self, state: GameState) -> None:
        """Run a single breakout round: group formation + conversations + whispers."""
        # Step 1: Collect group preferences (parallel) — all players participate
        preferences: dict[int, str] = {}
        preference_tasks = {}

        for player in state.players:
            preference_tasks[player.seat] = asyncio.create_task(
                self._agent_act(self.agents[player.seat], state, max_tokens=self._phase_tokens("group_preference"), phase_key="group_preference")
            )

        results = await asyncio.gather(
            *preference_tasks.values(), return_exceptions=True
        )

        for seat, result in zip(preference_tasks.keys(), results):
            if isinstance(result, Exception):
                logger.error("Group preference failed for seat %d: %s", seat, result)
                preferences[seat] = "any"
                continue
            parsed: ParsedResponse = result
            pref = self._extract_group_preference(parsed)
            preferences[seat] = pref

        # Step 2: Form groups
        groups = create_groups(preferences, state)
        self._emit("breakout.formed", {
            "groups": [{"id": g.id, "round_number": g.round_number, "members": g.members} for g in groups],
        })

        # Step 3: Run conversations in parallel across groups
        conversation_tasks = []
        for group in groups:
            conversation_tasks.append(
                self._run_group_conversation(group, state)
            )
        await asyncio.gather(*conversation_tasks)

        # Step 4: Whisper window
        self._emit("whisper.started", {"day": state.day_number})
        await self._run_whisper_round(state)
        self._emit("whisper.ended", {"day": state.day_number})

        self._emit("breakout.ended", {})

    async def _run_group_conversation(self, group, state: GameState) -> None:
        """Round-robin conversation within a breakout group (alive + dead)."""
        for turn in range(state.config.breakout.messages_per_agent):
            for seat in sorted(group.members):
                agent = self.agents[seat]
                parsed = await self._agent_act(agent, state, max_tokens=self._phase_tokens("breakout"), phase_key="breakout")
                parsed = await self._handle_recall_if_needed(agent, state, parsed)

                self._handle_day_special_actions(agent, state, parsed)
                self._check_slayer_shot(agent, state, parsed)

                if parsed.say:
                    add_group_message(group, seat, parsed.say, state)
                    self._emit("message.new", {
                        "seat": seat,
                        "content": parsed.say,
                        "type": "group",
                        "group_id": group.id,
                        "phase": state.phase.value,
                        "day": state.day_number,
                    })

                if parsed.think:
                    self._emit("player.reasoning", {
                        "seat": seat,
                        "reasoning": parsed.think,
                    })

    async def _run_whisper_round(self, state: GameState) -> None:
        """Let each agent send whispers if they want to (alive + dead).

        All agents are prompted in parallel (gated by per-provider semaphores).
        Whisper decisions are independent — no agent sees another's whisper
        before deciding their own.
        """
        whisper_tasks: dict[int, asyncio.Task] = {}
        for player in state.players:
            whisper_tasks[player.seat] = asyncio.create_task(
                self._agent_act(self.agents[player.seat], state, max_tokens=self._phase_tokens("whisper"), phase_key="whisper")
            )

        results = await asyncio.gather(*whisper_tasks.values(), return_exceptions=True)

        for seat, result in zip(whisper_tasks.keys(), results):
            if isinstance(result, Exception):
                logger.error("Whisper prompt failed for seat %d: %s", seat, result)
                continue

            parsed: ParsedResponse = result
            parsed = await self._handle_recall_if_needed(self.agents[seat], state, parsed)

            self._handle_day_special_actions(self.agents[seat], state, parsed)
            for action in parsed.actions:
                if action.action_type == "WHISPER" and action.target is not None:
                    try:
                        send_whisper(
                            seat,
                            action.target,
                            action.value or "",
                            state,
                        )
                        self._emit("whisper.notification", {
                            "from": seat,
                            "to": action.target,
                            "content": action.value or "",
                        })
                    except ValueError as e:
                        logger.warning("Whisper failed: %s", e)

    async def _run_nomination_phase(self, state: GameState) -> bool:
        """Full BotC nomination flow with pre-nomination discussion,
        accusation/defense speeches, voting, and inter-nomination reactions.

        Phase 1: Broadcast rules briefing.
        Phase 2: Pre-nomination discussion (all players, one round).
        Phase 3: Nomination loop — for each alive player in seat order:
            - Prompt to nominate or pass
            - If nomination: accusation -> defense -> vote -> result
            - Inter-nomination discussion (all players react, one round)
        Phase 4: Execute whoever is on the block.

        Returns True if the game ended during this phase.
        """
        # on_the_block: (seat, vote_count) or None
        on_the_block: tuple[int, int] | None = None
        state.on_the_block = None

        # Track nomination history for context in prompts
        nomination_summaries: list[dict] = []

        # --- Phase 1: Rules briefing ---
        briefing = (
            "Nominations are now open. Each living player may nominate one "
            "other player for execution. Each player can only be nominated "
            "once today. After a nomination, the accuser speaks, then the "
            "accused defends, then everyone votes. The player with the most "
            "votes (minimum 50% of living players) will be executed at day\'s "
            "end. Ties result in no execution."
        )
        briefing_msg = Message.system(state.phase_id, briefing)
        state.add_message(briefing_msg)
        self._emit("message.new", {
            "seat": None,
            "content": briefing,
            "type": "system",
            "phase": state.phase.value,
            "day": state.day_number,
        })

        # --- Phase 2: Pre-nomination discussion (all players, one round) ---
        await self._run_nomination_discussion(
            state,
            prompt_builder=lambda player: build_pre_nomination_prompt(player, state),
        )

        # Storyteller-driven executions (e.g., madness) can end nominations early.
        if state.executed_today is not None:
            result = check_win_conditions(state)
            if result:
                state.winner = result.alignment
                state.win_condition = result.reason
                transition(state, GamePhase.GAME_OVER)
                return True
            return False

        # --- Phase 3: Nomination loop ---
        # Snapshot alive players at phase start (iterate by seat order)
        alive_seats = [p.seat for p in state.alive_players]

        for seat in alive_seats:
            player = state.player_at(seat)
            if not player.is_alive:
                continue  # May have died mid-phase (e.g. Slayer, Virgin)
            if not can_nominate(state, seat):
                continue

            agent = self.agents[seat]
            parsed = await self._agent_act(agent, state, max_tokens=self._phase_tokens("nomination"), phase_key="nomination")
            parsed = await self._handle_recall_if_needed(agent, state, parsed)

            self._handle_day_special_actions(agent, state, parsed)
            self._check_slayer_shot(agent, state, parsed)

            # Check if Slayer shot ended the game
            result = check_win_conditions(state)
            if result:
                state.winner = result.alignment
                state.win_condition = result.reason
                transition(state, GamePhase.GAME_OVER)
                return True

            # Storyteller-driven execution during this nomination turn ends the day.
            if state.executed_today is not None:
                return False

            # Broadcast any speech
            if parsed.say:
                msg = Message(
                    id=uuid.uuid4().hex,
                    type=MessageType.PUBLIC_SPEECH,
                    phase_id=state.phase_id,
                    sender_seat=player.seat,
                    content=parsed.say,
                )
                state.add_message(msg)

            # Check for a nomination action
            nomination = None
            for action in parsed.actions:
                if action.action_type == "NOMINATE" and action.target is not None:
                    if can_be_nominated(state, action.target):
                        nomination = process_nomination(state, seat, action.target)
                        self._emit("nomination.start", {
                            "nominator": seat,
                            "nominee": action.target,
                        })
                        # Witch may kill the nominator immediately on nomination.
                        nominator = state.player_at(seat)
                        if not nominator.is_alive and nominator.death_cause == "witch_curse":
                            self._emit("death", {
                                "seat": seat,
                                "cause": "witch_curse",
                                "death_cause": nominator.death_cause,
                                "death_day": nominator.death_day,
                                "death_phase": nominator.death_phase,
                            })
                            self._send_death_notification(nominator, state)
                        break  # Only one nomination per player

            if nomination is None:
                continue  # Player passed

            # --- Virgin ability may have caused an execution ---
            if state.executed_today is not None:
                result = check_win_conditions(state)
                if result:
                    state.winner = result.alignment
                    state.win_condition = result.reason
                    transition(state, GamePhase.GAME_OVER)
                    return True
                # Virgin execution ends nominations for the day
                break

            # --- Accusation & defense speeches ---
            nominator_player = state.player_at(nomination.nominator_seat)
            nominee_player = state.player_at(nomination.nominee_seat)

            # Broadcast nomination announcement
            nom_announce = (
                f"{nominator_player.character_name} (Seat {nominator_player.seat}) "
                f"nominates {nominee_player.character_name} (Seat {nominee_player.seat}) "
                f"for execution."
            )
            state.add_message(Message.system(state.phase_id, nom_announce))
            self._emit("message.new", {
                "seat": None,
                "content": nom_announce,
                "type": "system",
                "phase": state.phase.value,
                "day": state.day_number,
            })

            # 1. Nominator gives accusation speech
            accusation_text = await self._get_speech(
                nominator_player, nominee_player, state, speech_type="accusation"
            )

            # 2. Nominee gives defense speech (receives accusation as context)
            defense_text = await self._get_speech(
                nominee_player, nominator_player, state,
                speech_type="defense",
                accusation_text=accusation_text,
            )

            # --- Voting on this nomination ---
            transition(state, GamePhase.VOTING)
            self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})

            vote_tasks = {}
            for voter in state.players:
                if not can_vote(state, voter.seat):
                    continue
                # Don't re-prompt voters who already voted on THIS nomination
                if voter.seat in nomination.votes_for or voter.seat in nomination.votes_against:
                    continue
                vote_tasks[voter.seat] = asyncio.create_task(
                    self._agent_act(self.agents[voter.seat], state, max_tokens=self._phase_tokens("vote"), phase_key="vote")
                )

            results = await asyncio.gather(
                *vote_tasks.values(), return_exceptions=True
            )

            for voter_seat, vote_result in zip(vote_tasks.keys(), results):
                if isinstance(vote_result, Exception):
                    logger.error("Vote failed for seat %d: %s — defaulting to NO", voter_seat, vote_result)
                    process_vote(state, nomination, voter_seat, False)
                    self._emit("vote.cast", {"seat": voter_seat, "nominee": nomination.nominee_seat, "vote": False})
                    continue

                vote_parsed: ParsedResponse = vote_result
                vote_parsed = await self._handle_recall_if_needed(
                    self.agents[voter_seat], state, vote_parsed
                )
                vote_yes = self._extract_vote(vote_parsed)
                process_vote(state, nomination, voter_seat, vote_yes)

                # Emit the actual outcome (vote may have been blocked by Butler
                # restriction, ghost vote rules, or dedup)
                actually_voted_yes = voter_seat in nomination.votes_for
                actually_voted_no = voter_seat in nomination.votes_against
                if actually_voted_yes or actually_voted_no:
                    voter = state.player_at(voter_seat)
                    self._emit("vote.cast", {
                        "seat": voter_seat,
                        "nominee": nomination.nominee_seat,
                        "vote": actually_voted_yes,
                        "ghost_vote_used": voter.ghost_vote_used if not voter.is_alive else None,
                    })

            # --- Evaluate vote result against threshold and current block ---
            vote_count = len(nomination.votes_for)
            threshold = state.vote_threshold()
            vote_result_text = ""

            if vote_count >= threshold:
                if on_the_block is None or vote_count > on_the_block[1]:
                    # New highest — goes on the block (or replaces)
                    old_block = on_the_block
                    on_the_block = (nomination.nominee_seat, vote_count)
                    state.on_the_block = on_the_block
                    nomination.outcome = "on_the_block" if old_block is None else "replaced"

                    # Mark the old block holder's nomination as superseded
                    if old_block is not None:
                        for prev_nom in state.nominations:
                            if prev_nom.nominee_seat == old_block[0] and prev_nom.outcome in ("on_the_block", "replaced"):
                                prev_nom.outcome = "failed"

                    vote_result_text = (
                        f"{nominee_player.character_name} (Seat {nomination.nominee_seat}) "
                        f"is put ON THE BLOCK ({vote_count} votes, {threshold} needed)."
                    )
                    if old_block:
                        old_name = state.player_at(old_block[0]).character_name
                        vote_result_text += (
                            f" {old_name} (Seat {old_block[0]}) is no longer on the block."
                        )

                    state.add_message(Message.system(state.phase_id, vote_result_text))

                elif vote_count == on_the_block[1]:
                    # Tie — both freed, nobody on the block
                    nomination.outcome = "tied"
                    # Mark old block holder as tied too
                    for prev_nom in state.nominations:
                        if prev_nom.nominee_seat == on_the_block[0] and prev_nom.outcome in ("on_the_block", "replaced"):
                            prev_nom.outcome = "tied"

                    old_name = state.player_at(on_the_block[0]).character_name
                    vote_result_text = (
                        f"Vote tied at {vote_count}! Both {old_name} (Seat {on_the_block[0]}) "
                        f"and {nominee_player.character_name} (Seat {nomination.nominee_seat}) "
                        f"are freed from the block."
                    )
                    state.add_message(Message.system(state.phase_id, vote_result_text))
                    on_the_block = None
                    state.on_the_block = None

                else:
                    # Met threshold but lower than current block holder — fails
                    nomination.outcome = "failed"
                    block_name = state.player_at(on_the_block[0]).character_name
                    vote_result_text = (
                        f"{nominee_player.character_name} received {vote_count} votes "
                        f"but {block_name} (Seat {on_the_block[0]}) remains on the block "
                        f"with {on_the_block[1]} votes."
                    )
                    state.add_message(Message.system(state.phase_id, vote_result_text))
            else:
                # Below threshold — nomination fails outright
                nomination.outcome = "failed"
                vote_result_text = (
                    f"{nominee_player.character_name} received only {vote_count} votes "
                    f"({threshold} needed). Nomination fails."
                )
                state.add_message(Message.system(state.phase_id, vote_result_text))

            self._emit("nomination.result", {
                "nominator": nomination.nominator_seat,
                "nominee": nomination.nominee_seat,
                "votes_for": list(nomination.votes_for),
                "votes_against": list(nomination.votes_against),
                "outcome": nomination.outcome,
                "on_the_block": on_the_block[0] if on_the_block else None,
                "on_the_block_votes": on_the_block[1] if on_the_block else None,
            })

            # Build nomination summary for inter-nomination discussion
            nom_summary = {
                "nominator": nominator_player.character_name,
                "nominator_seat": nominator_player.seat,
                "nominee": nominee_player.character_name,
                "nominee_seat": nominee_player.seat,
                "accusation": accusation_text[:200],
                "defense": defense_text[:200],
                "votes_for": vote_count,
                "votes_against": len(nomination.votes_against),
                "outcome": nomination.outcome or "failed",
                "on_the_block_name": (
                    state.player_at(on_the_block[0]).character_name
                    if on_the_block else None
                ),
                "on_the_block_seat": on_the_block[0] if on_the_block else None,
                "on_the_block_votes": on_the_block[1] if on_the_block else None,
            }
            nomination_summaries.append(nom_summary)

            # Post-vote discussion — skip if no more nominators remain
            if state.config.post_vote_discussion:
                remaining = [
                    s for s in alive_seats[alive_seats.index(seat) + 1:]
                    if state.player_at(s).is_alive and can_nominate(state, s)
                ]
                if remaining:
                    await self._run_nomination_discussion(
                        state,
                        prompt_builder=lambda p, ns=nom_summary: build_inter_nomination_prompt(
                            p, state, ns
                        ),
                        max_tokens=150,
                    )

            # Return to NOMINATIONS phase for next player
            transition(state, GamePhase.NOMINATIONS)
            self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})

        # --- Phase 4: Execute whoever is on the block. ---
        if on_the_block is not None:
            block_seat = on_the_block[0]
            transition(state, GamePhase.EXECUTION)
            self._emit("phase.change", {"phase": state.phase.value, "day": state.day_number})

            executed = resolve_execution(state, on_the_block=block_seat)
            if executed is not None:
                exec_player = state.player_at(executed)
                self._emit("execution", {
                    "seat": executed,
                    "role": exec_player.role.name,
                    "death_cause": exec_player.death_cause,
                    "death_day": exec_player.death_day,
                    "death_phase": exec_player.death_phase,
                })
                self._send_death_notification(exec_player, state)
        else:
            state.add_message(Message.system(
                state.phase_id,
                "No player was put on the block today. No execution.",
            ))

        # --- Win condition check after execution (or lack thereof) ---
        result = check_win_conditions(state)
        if result:
            state.winner = result.alignment
            state.win_condition = result.reason
            transition(state, GamePhase.GAME_OVER)
            return True

        return False

    async def _run_nomination_discussion(
        self,
        state: GameState,
        *,
        prompt_builder: Callable,
        max_tokens: int = 200,
    ) -> None:
        """Run a single round-robin discussion during the nomination phase.

        All players (alive + dead) speak once. Used for both the
        pre-nomination discussion and inter-nomination reactions.
        """
        for player in state.players:
            agent = self.agents[player.seat]

            # Build a focused prompt for this discussion round
            discussion_prompt = prompt_builder(player)

            try:
                provider = self.agent_configs[agent.seat].provider
                sem = self._provider_semaphores.get(provider)

                async def _call(a=agent, dp=discussion_prompt, mt=max_tokens):
                    response = await a.provider.complete_with_retry(
                        system_prompt=a._system_prompt or "",
                        messages=[{"role": "user", "content": dp}],
                        temperature=a.llm_config.temperature,
                        max_tokens=mt,
                    )
                    self._record_tokens(
                        agent_id=a.agent_id,
                        model=response.model,
                        phase_id=state.phase_id,
                        input_tokens=response.input_tokens,
                        output_tokens=response.output_tokens,
                        latency_ms=response.latency_ms,
                        seat=a.seat,
                    )
                    return response.content.strip()

                if sem:
                    async with sem:
                        raw_text = await _call()
                else:
                    raw_text = await _call()

                parsed_discussion = parse_response(raw_text)

                speech_text, internal_content = _sanitize_speech(raw_text)

            except Exception as e:
                logger.warning(
                    "Nomination discussion failed for seat %d: %s",
                    player.seat, e,
                )
                speech_text = ""
                internal_content = ""
                parsed_discussion = ParsedResponse()

            if speech_text:
                msg = Message(
                    id=uuid.uuid4().hex,
                    type=MessageType.PUBLIC_SPEECH,
                    phase_id=state.phase_id,
                    sender_seat=player.seat,
                    content=speech_text,
                )
                state.add_message(msg)
                emit_data: dict[str, Any] = {
                    "seat": player.seat,
                    "content": speech_text,
                    "type": "public",
                    "phase": state.phase.value,
                    "day": state.day_number,
                }
                if internal_content:
                    emit_data["internal"] = internal_content
                self._emit("message.new", emit_data)

            self._handle_day_special_actions(agent, state, parsed_discussion)

    # -------------------------------------------------------------------
    # Death notification
    # -------------------------------------------------------------------

    def _send_death_notification(self, player: Player, state: GameState) -> None:
        """Send a private message to a newly dead player explaining their status."""
        death_msg = Message.private_info(
            state.phase_id,
            player.seat,
            "You have died. Your role remains hidden from other players. "
            "You continue to participate fully in discussions and breakout groups. "
            "You cannot nominate. You have exactly 1 ghost vote remaining for the "
            "rest of the game — once you use it, you cannot vote again. "
            "You no longer receive night ability information.",
        )
        state.add_message(death_msg)
        self._emit("message.new", {
            "seat": player.seat,
            "content": death_msg.content,
            "type": "private_info",
            "phase": state.phase.value,
            "day": state.day_number,
        })

    # -------------------------------------------------------------------
    # Death narration
    # -------------------------------------------------------------------

    async def _narrate_death(self, player: Player, state: GameState) -> str:
        """Generate a dramatic/funny death narration from the Storyteller.

        Uses whichever LLM provider is available, falling back to templates.
        """
        # Try to use the first available agent's provider for narration
        narrator_agent = next(iter(self.agents.values()), None)
        if narrator_agent is None:
            return f"{player.character_name} was found dead in the village square."

        try:
            response = await narrator_agent.provider.complete_with_retry(
                system_prompt=(
                    "You are a darkly comedic medieval Storyteller. Narrate a villager's death "
                    "in exactly ONE short sentence (under 20 words). Be absurd and unexpected. "
                    "Each death must be COMPLETELY DIFFERENT from any other. "
                    "BANNED TOPICS (never use these): turnips, choking on food, tripping. "
                    "Instead pick from wildly different categories each time: "
                    "haunted furniture, rogue livestock, catastrophic baking, sentient weather, "
                    "accidental alchemy, overly aggressive geese, spontaneous combustion, "
                    "being carried off by a suspiciously organized flock of crows, "
                    "fatal disagreements with architecture, or cursed footwear. "
                    "Never mention their game role. Never be serious."
                ),
                messages=[{
                    "role": "user",
                    "content": f"Narrate the death of {player.character_name} (Seat {player.seat}). "
                               f"It is Night {state.day_number}. "
                               f"There are {len(state.alive_players)} villagers remaining.",
                }],
                temperature=0.95,
                max_tokens=512,
            )
            narration = response.content.strip().strip('"')
            self._record_tokens(
                agent_id="storyteller",
                model=response.model,
                phase_id=state.phase_id,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
                latency_ms=response.latency_ms,
            )
            return narration
        except Exception as e:
            logger.warning("Death narration failed: %s", e)
            return f"{player.character_name} was found dead at dawn, slumped against the clocktower wall."

    # -------------------------------------------------------------------
    # Accusation & defense speeches
    # -------------------------------------------------------------------

    async def _get_speech(
        self,
        speaker: "Player",
        other: "Player",
        state: GameState,
        *,
        speech_type: str,
        accusation_text: str = "",
    ) -> str:
        """Prompt an agent for an accusation or defense speech.

        Makes a separate LLM call with a focused prompt (not the full
        game-action loop). The speech is broadcast as a public message
        with a dedicated message type.

        Returns the speech text.
        """
        agent = self.agents[speaker.seat]

        if speech_type == "accusation":
            prompt_text = build_accusation_prompt(speaker, other, state)
            msg_type = MessageType.ACCUSATION
        else:
            prompt_text = build_defense_prompt(speaker, other, accusation_text, state)
            msg_type = MessageType.DEFENSE

        internal_content = ""
        effort_key = "accusation" if speech_type == "accusation" else "defense"
        try:
            response = await agent.provider.complete_with_retry(
                system_prompt=agent._system_prompt or "",
                messages=[{"role": "user", "content": prompt_text}],
                temperature=agent.llm_config.temperature,
                max_tokens=300,
                reasoning_effort=self._phase_effort(effort_key),
            )
            self._record_tokens(
                agent_id=agent.agent_id,
                model=response.model,
                phase_id=state.phase_id,
                input_tokens=response.input_tokens,
                output_tokens=response.output_tokens,
                latency_ms=response.latency_ms,
                seat=agent.seat,
            )

            # Check for RECALL — if the agent wants to look up past conversations,
            # fetch results and re-prompt so they can give an informed speech.
            raw = response.content.strip()
            recall_match = re.search(r"\{RECALL:\s*([^}]*)\}", raw, re.IGNORECASE)
            if recall_match:
                query = recall_match.group(1).strip()
                logger.info(
                    "%s RECALL for seat %d: %s", speech_type, speaker.seat, query
                )
                from botc.comms.context_manager import build_recall_results
                recall_results = build_recall_results(speaker, state, query)

                re_prompt = (
                    f"{recall_results}\n\n"
                    f"Now give your {speech_type} speech based on the information above. "
                    f"Speak in character. Keep it concise (2-4 sentences). "
                    f"Do NOT use XML tags or {{RECALL}}. Just speak aloud."
                )
                re_response = await agent.provider.complete_with_retry(
                    system_prompt=agent._system_prompt or "",
                    messages=[
                        {"role": "user", "content": prompt_text},
                        {"role": "assistant", "content": raw},
                        {"role": "user", "content": re_prompt},
                    ],
                    temperature=agent.llm_config.temperature,
                    max_tokens=300,
                )
                self._record_tokens(
                    agent_id=agent.agent_id,
                    model=re_response.model,
                    phase_id=state.phase_id,
                    input_tokens=re_response.input_tokens,
                    output_tokens=re_response.output_tokens,
                    latency_ms=re_response.latency_ms,
                    seat=agent.seat,
                )
                raw = re_response.content.strip()

            speech_text, internal_content = _sanitize_speech(raw)

        except Exception as e:
            logger.warning(
                "%s speech failed for seat %d: %s", speech_type, speaker.seat, e
            )
            if speech_type == "accusation":
                speech_text = f"I believe {other.character_name} should be executed."
            else:
                speech_text = "I am innocent and should not be executed."

        # Create and broadcast the speech message
        msg = Message(
            id=uuid.uuid4().hex,
            type=msg_type,
            phase_id=state.phase_id,
            sender_seat=speaker.seat,
            content=speech_text,
        )
        state.add_message(msg)

        emit_data: dict[str, Any] = {
            "seat": speaker.seat,
            "content": speech_text,
            "type": speech_type,
            "phase": state.phase.value,
            "day": state.day_number,
        }
        if internal_content:
            emit_data["internal"] = internal_content
        self._emit("message.new", emit_data)

        return speech_text

    def _broadcast_new_messages(self, state: GameState, from_index: int) -> None:
        """Broadcast all messages added since from_index as WebSocket events."""
        for msg in state.all_messages[from_index:]:
            # For private_info, use the recipient seat as sender so frontend
            # can display "Aldric learns: ..." instead of anonymous system text
            seat = msg.sender_seat
            if msg.type == MessageType.PRIVATE_INFO and msg.visible_to:
                seat = next(iter(msg.visible_to))
            self._emit("message.new", {
                "seat": seat,
                "content": msg.content,
                "type": msg.type.value if hasattr(msg.type, 'value') else str(msg.type),
                "group_id": getattr(msg, 'group_id', None),
                "phase": state.phase.value,
                "day": state.day_number,
            })

    # -------------------------------------------------------------------
    # Night action log (observer mode)
    # -------------------------------------------------------------------

    def _emit_night_actions(
        self, state: GameState, actions: dict[int, NightAction], *, first_night: bool
    ) -> None:
        """Emit night.action events in night order for observer mode."""
        script = load_script(state.config.script)
        night_order = script.first_night_order if first_night else script.other_nights_order

        action_labels = {
            "poisoner": "poison",
            "monk": "protect",
            "imp": "kill",
            "fang_gu": "kill",
            "vigormortis": "kill",
            "no_dashii": "kill",
            "vortox": "kill",
            "po": "kill",
            "pukka": "kill",
            "shabaloth": "kill",
            "zombuul": "kill",
            "fortune_teller": "divine",
            "butler": "choose_master",
            "dreamer": "dream",
            "snake_charmer": "charm",
            "seamstress": "stitch",
            "philosopher": "philosophize",
            "sailor": "drink_with",
            "chambermaid": "check_woke",
            "exorcist": "exorcise",
            "innkeeper": "protect_two",
            "gambler": "gamble",
            "courtier": "drunken_character",
            "professor": "resurrect",
            "godfather": "bonus_kill_target",
            "devils_advocate": "protect_execution",
            "assassin": "assassinate",
            "witch": "curse",
            "cerenovus": "induce_madness",
            "pit_hag": "transform",
            "washerwoman": "learn_townsfolk",
            "librarian": "learn_outsider",
            "investigator": "learn_minion",
            "chef": "count_evil_pairs",
            "empath": "count_evil_neighbours",
            "grandmother": "learn_grandchild",
            "ravenkeeper": "learn_role",
            "undertaker": "learn_executed_role",
            "spy": "see_grimoire",
            "clockmaker": "learn_distance",
            "mathematician": "count_abnormal",
            "flowergirl": "check_demon_vote",
            "town_crier": "check_minion_nomination",
            "oracle": "count_dead_evil",
        }

        for role_id in night_order:
            players_with_role = [
                p for p in state.players
                if (p.role.id == role_id or
                    (p.perceived_role and p.perceived_role.id == role_id and p.is_drunk))
                and (
                    p.is_alive
                    or (
                        p.role.role_type == RoleType.MINION
                        and p.hidden_state.get("vigormortis_keeps_ability", False)
                    )
                )
            ]

            for player in players_with_role:
                action = actions.get(player.seat)
                action_name = action_labels.get(player.role.id, player.role.id)

                target_seat = None
                target_name = None
                effect = "no_target"

                if action and action.targets:
                    target_seat = action.targets[0]
                    target_player = state.player_at(target_seat)
                    target_name = target_player.character_name or target_player.agent_id

                    if player.role.id == "poisoner":
                        effect = f"poisons {target_name}"
                    elif player.role.id == "monk":
                        effect = f"protects {target_name}"
                    elif player.role.id in {
                        "imp", "fang_gu", "vigormortis", "no_dashii", "vortox",
                        "po", "pukka", "shabaloth", "zombuul",
                    }:
                        effect = f"targets {target_name} for kill"
                    elif player.role.id == "fortune_teller" and len(action.targets) >= 2:
                        target2 = state.player_at(action.targets[1])
                        target2_name = target2.character_name or target2.agent_id
                        effect = f"divines {target_name} and {target2_name}"
                        target_name = f"{target_name}, {target2_name}"
                    elif player.role.id == "butler":
                        effect = f"chooses {target_name} as master"
                    elif player.role.id == "ravenkeeper":
                        effect = f"learns role of {target_name}"
                    elif player.role.id in {"cerenovus", "pit_hag"} and action.role_choice:
                        effect = f"targets {target_name} as {action.role_choice}"
                    else:
                        effect = f"targets {target_name}"
                elif action and action.role_choice:
                    if player.role.id == "philosopher":
                        effect = f"chooses role {action.role_choice}"
                    else:
                        effect = f"chooses role {action.role_choice}"
                elif not action:
                    if player.role.id in ("washerwoman", "librarian", "investigator",
                                          "chef", "empath", "undertaker", "spy",
                                          "grandmother", "godfather"):
                        effect = "receives information"
                    else:
                        effect = "no action"

                self._emit("night.action", {
                    "seat": player.seat,
                    "name": player.character_name or player.agent_id,
                    "role": player.role.name,
                    "role_id": player.role.id,
                    "action": action_name,
                    "target_seat": target_seat,
                    "target_name": target_name,
                    "role_choice": action.role_choice if action else None,
                    "effect": effect,
                    "day": state.day_number,
                })

    # -------------------------------------------------------------------
    # RECALL handling
    # -------------------------------------------------------------------

    async def _handle_recall_if_needed(
        self, agent: Agent, state: GameState, parsed: ParsedResponse
    ) -> ParsedResponse:
        """If the agent used RECALL, fetch results and re-prompt.

        Returns the original *parsed* response if no RECALL was used,
        or a new :class:`ParsedResponse` from the re-prompted agent.
        """
        recall_action = next(
            (a for a in parsed.actions if a.action_type == "RECALL"),
            None,
        )
        if recall_action is None:
            return parsed

        query = recall_action.value or ""
        logger.info(
            "Agent %s (seat %d) used RECALL: %s",
            agent.agent_id, agent.seat, query,
        )

        results = build_recall_results(agent.player, state, query)
        new_parsed = await agent.act_with_recall_context(state, results)

        self._emit("player.recall", {
            "seat": agent.seat,
            "query": query,
            "results_count": results.count("\n"),
        })

        return new_parsed

    # -------------------------------------------------------------------
    # Rate-limited agent call
    # -------------------------------------------------------------------

    def _phase_tokens(self, phase_key: str) -> int:
        """Look up the max_tokens budget for a given phase key."""
        m = self.state.config.phase_max_tokens
        return m.get(phase_key, m.get("default", 4096))

    def _phase_effort(self, phase_key: str) -> str | None:
        """Look up the reasoning effort for a given phase key."""
        m = self.state.config.phase_reasoning_effort
        return m.get(phase_key, m.get("default"))

    async def _agent_act(
        self, agent: Agent, state: GameState,
        max_tokens: int = 4096,
        phase_key: str | None = None,
    ) -> ParsedResponse:
        """Call agent.act() with per-provider rate limiting.

        Different providers fire in parallel (independent rate limits),
        but calls to the same provider are gated by a semaphore.
        """
        effort = self._phase_effort(phase_key) if phase_key else None
        provider = self.agent_configs[agent.seat].provider
        sem = self._provider_semaphores.get(provider)
        if sem:
            async with sem:
                return await agent.act(state, max_tokens=max_tokens, reasoning_effort=effort)
        return await agent.act(state, max_tokens=max_tokens, reasoning_effort=effort)

    # -------------------------------------------------------------------
    # Slayer ability helper
    # -------------------------------------------------------------------

    def _check_slayer_shot(
        self, agent: Agent, state: GameState, parsed: ParsedResponse
    ) -> None:
        """If the agent used SLAYER_SHOT, resolve it immediately."""
        if not agent.player.is_alive:
            return  # Dead players cannot use Slayer
        for action in parsed.actions:
            if action.action_type == "SLAYER_SHOT" and action.target is not None:
                slayer = agent.player
                target = state.player_at(action.target)
                killed = resolve_slayer_shot(state, slayer, target)
                if killed:
                    self._emit("death", {
                        "seat": action.target,
                        "role": target.role.name,
                        "cause": "slayer",
                        "death_cause": target.death_cause,
                        "death_day": target.death_day,
                        "death_phase": target.death_phase,
                    })
                    state.add_message(Message.system(
                        state.phase_id,
                        f"{slayer.character_name} uses the Slayer ability on "
                        f"{target.character_name}... and they die!",
                    ))
                    # Scarlet Woman may take over as Demon
                    check_scarlet_woman(state)
                else:
                    state.add_message(Message.system(
                        state.phase_id,
                        f"{slayer.character_name} uses the Slayer ability on "
                        f"{target.character_name}... but the shot misses.",
                    ))
                self._emit("message.new", {
                    "seat": None,
                    "content": state.all_messages[-1].content,
                    "type": "system",
                    "phase": state.phase.value,
                    "day": state.day_number,
                })

    def _handle_day_special_actions(
        self, agent: Agent, state: GameState, parsed: ParsedResponse
    ) -> None:
        """Resolve day-only special actions currently not part of core night/day engine."""
        player = agent.player

        for action in parsed.actions:
            if action.action_type == "ASK":
                if player.role.id != "artist" or not player.is_alive:
                    continue
                if player.hidden_state.get("artist_used"):
                    continue
                question = (action.value or "").strip()
                if not question:
                    continue

                answer = answer_artist_question(state, question)
                player.hidden_state["artist_used"] = True
                info = f"Artist answer to '{question}': {'Yes' if answer else 'No'}."
                msg = Message.private_info(state.phase_id, player.seat, info)
                state.add_message(msg)
                self._emit("message.new", {
                    "seat": player.seat,
                    "content": info,
                    "type": "private_info",
                    "phase": state.phase.value,
                    "day": state.day_number,
                })
                continue

            if action.action_type == "JUGGLE":
                if player.role.id != "juggler" or not player.is_alive:
                    continue
                if state.day_number != 1 or player.hidden_state.get("juggler_used"):
                    continue

                guesses = self._parse_juggler_guesses(action.value or "", state)
                if not guesses:
                    continue

                player.hidden_state["juggler_used"] = True
                player.hidden_state["juggler_guesses"] = guesses
                state.add_message(Message.system(
                    state.phase_id,
                    f"{player.character_name} makes a set of Juggler guesses.",
                ))
                self._emit("message.new", {
                    "seat": None,
                    "content": f"{player.character_name} makes a set of Juggler guesses.",
                    "type": "system",
                    "phase": state.phase.value,
                    "day": state.day_number,
                })

        # Madness checks (Mutant, Cerenovus) are evaluated from public speech.
        if parsed.say:
            self._maybe_execute_for_madness(player, state, parsed.say)

    def _parse_juggler_guesses(self, raw: str, state: GameState) -> list[dict[str, int | str]]:
        """Parse Juggler guesses from ACTION value, e.g. '1=vortox, 2=witch'."""
        if not raw:
            return []

        script = load_script(state.config.script)
        role_lookup: dict[str, str] = {}
        for role in script.all_roles:
            role_lookup[role.id.lower()] = role.id
            role_lookup[role.name.lower()] = role.id

        guesses: list[dict[str, int | str]] = []
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        for part in parts[:5]:
            match = re.match(r"(?:player\s+)?(\d+)\s*[:=]\s*([a-zA-Z_\\-\\s]+)", part, re.IGNORECASE)
            if not match:
                continue
            seat = int(match.group(1))
            role_key = match.group(2).strip().lower().replace(" ", "_")
            role_id = role_lookup.get(role_key) or role_lookup.get(role_key.replace("_", " "))
            if role_id is None:
                continue
            if not (0 <= seat < len(state.players)):
                continue
            guesses.append({"seat": seat, "role_id": role_id})

        return guesses

    def _maybe_execute_for_madness(
        self, player: "Player", state: GameState, speech: str
    ) -> None:
        """Apply storyteller madness executions for Mutant/Cerenovus in a lightweight way."""
        if not player.is_alive:
            return

        claimed_roles = self._extract_self_claimed_roles(speech, state)
        if not claimed_roles:
            return

        script = load_script(state.config.script)
        outsider_ids = {r.id for r in script.outsiders}

        # Mutant: claiming Outsider may trigger execution.
        if player.role.id == "mutant" and claimed_roles.intersection(outsider_ids):
            self._storyteller_execute(
                player,
                state,
                "The Mutant broke madness and is executed by the Storyteller.",
            )
            return

        # Cerenovus: target must stay mad as the chosen role that day.
        mad_day = player.hidden_state.get("cerenovus_day")
        mad_role_name = player.hidden_state.get("cerenovus_mad_role")
        mad_role_id = player.hidden_state.get("cerenovus_mad_role_id")
        if mad_day != state.day_number or not mad_role_name:
            return

        role_name_lookup = {r.name.lower(): r.id for r in script.all_roles}
        expected_role_id = (
            str(mad_role_id)
            if mad_role_id
            else role_name_lookup.get(str(mad_role_name).lower())
        )
        if expected_role_id is None:
            return

        if expected_role_id not in claimed_roles:
            self._storyteller_execute(
                player,
                state,
                (
                    "Cerenovus madness breaks and the Storyteller executes "
                    f"{player.character_name}."
                ),
            )

    def _extract_self_claimed_roles(self, speech: str, state: GameState) -> set[str]:
        """Extract explicit self role claims from speech, returning role ids."""
        text = (speech or "").strip().lower()
        if not text:
            return set()

        script = load_script(state.config.script)
        snippets: list[str] = []
        patterns = [
            r"\bi am (?:the |a |an )?([a-z_\- ]+)",
            r"\bi'?m (?:the |a |an )?([a-z_\- ]+)",
            r"\bmy role is (?:the |a |an )?([a-z_\- ]+)",
            r"\bi am one of ([a-z0-9_, \-]+)",
        ]
        for pattern in patterns:
            for match in re.finditer(pattern, text):
                snippets.append(match.group(1))

        if not snippets:
            return set()

        claimed: set[str] = set()
        for snippet in snippets:
            chunk = snippet.replace("/", ",").replace(" or ", ",")
            parts = [p.strip() for p in chunk.split(",") if p.strip()]
            for part in parts:
                for role in script.all_roles:
                    role_name = role.name.lower()
                    role_id_text = role.id.replace("_", " ").lower()
                    if role_name in part or role_id_text in part or role.id.lower() == part:
                        claimed.add(role.id)
        return claimed

    def _storyteller_execute(self, player: "Player", state: GameState, reason: str) -> None:
        """Execute a player due to storyteller adjudication."""
        if not player.is_alive:
            return

        player.is_alive = False
        player.death_cause = "executed"
        player.death_day = state.day_number
        player.death_phase = "day"
        if state.executed_today is None:
            state.executed_today = player.seat
        on_player_death(state, player)
        check_scarlet_woman(state)

        state.add_message(Message.system(state.phase_id, reason))
        self._emit("execution", {
            "seat": player.seat,
            "role": player.role.name,
            "death_cause": player.death_cause,
            "death_day": player.death_day,
            "death_phase": player.death_phase,
        })
        self._emit("message.new", {
            "seat": None,
            "content": reason,
            "type": "system",
            "phase": state.phase.value,
            "day": state.day_number,
        })
        self._send_death_notification(player, state)

    # -------------------------------------------------------------------
    # Response extraction helpers
    # -------------------------------------------------------------------

    def _validate_night_target(self, target_seat: int, actor_seat: int) -> bool:
        """Check that a night action target is a valid, alive player (not self)."""
        if not self.state:
            return True
        try:
            target = self.state.player_at(target_seat)
        except (IndexError, ValueError):
            logger.warning("Night target seat %d is invalid", target_seat)
            return False
        if not target.is_alive:
            logger.warning(
                "Seat %d targeted dead player %s (seat %d) — ignoring",
                actor_seat, target.character_name, target_seat,
            )
            return False
        if target_seat == actor_seat:
            logger.warning("Seat %d targeted self — ignoring", actor_seat)
            return False
        return True

    def _extract_night_action(
        self, parsed: ParsedResponse, *, seat: int, role_id: str
    ) -> NightAction | None:
        for action in parsed.actions:
            if action.action_type == "NIGHT_TARGET" and action.target is not None:
                if not self._validate_night_target(action.target, seat):
                    continue
                return NightAction(
                    actor_seat=seat,
                    role_id=role_id,
                    targets=[action.target],
                )
            if action.action_type == "NIGHT_TARGET_TWO" and action.value:
                try:
                    parts = action.value.split(",")
                    targets = [int(p.strip()) for p in parts[:2]]
                    if all(self._validate_night_target(t, seat) for t in targets):
                        return NightAction(
                            actor_seat=seat,
                            role_id=role_id,
                            targets=targets,
                        )
                except ValueError:
                    continue
            if action.action_type == "NIGHT_TARGET_THREE" and action.value:
                try:
                    parts = action.value.split(",")
                    targets = [int(p.strip()) for p in parts[:3]]
                    if all(self._validate_night_target(t, seat) for t in targets):
                        return NightAction(
                            actor_seat=seat,
                            role_id=role_id,
                            targets=targets,
                        )
                except ValueError:
                    continue
            if action.action_type == "NIGHT_TARGET_ROLE":
                if action.target is None:
                    continue
                if not self._validate_night_target(action.target, seat):
                    continue
                role_choice = (action.value or "").strip()
                return NightAction(
                    actor_seat=seat,
                    role_id=role_id,
                    targets=[action.target],
                    role_choice=role_choice or None,
                )
            if action.action_type == "NIGHT_CHARACTER" and action.value:
                return NightAction(
                    actor_seat=seat,
                    role_id=role_id,
                    targets=[],
                    role_choice=action.value.strip(),
                )
        return None

    # ── Roles that should NEVER skip their night action ──────────────
    # 1-target, avoid own team (evil won't target evil, good won't target good)
    _FALLBACK_1_AVOID_TEAM: set[str] = {
        "imp", "fang_gu", "vigormortis", "no_dashii", "vortox",
        "po", "pukka", "shabaloth", "zombuul",  # demons
        "poisoner", "witch", "cerenovus",         # minions that target
        "assassin", "godfather", "devils_advocate",
    }
    # 1-target, target anyone except self
    _FALLBACK_1_ANY: set[str] = {
        "monk", "butler", "exorcist", "dreamer", "sailor",
        "snake_charmer", "pit_hag",
    }
    # 2-target roles
    _FALLBACK_2: set[str] = {
        "fortune_teller", "chambermaid", "seamstress", "innkeeper",
    }

    def _fallback_night_action(
        self, state: GameState, seat: int, role_id: str,
    ) -> NightAction | None:
        """Generate a smart random fallback when the LLM fails to provide a target.

        Strategic rules:
        - Evil roles don't target their own evil teammates
        - Good roles don't target their own good teammates (for Monk protection, etc. — actually Monk should protect anyone, so target anyone)
        - Demons never self-target (no accidental starpass)
        """
        rng = state.rng
        actor = state.player_at(seat)
        alive_others = [p for p in state.alive_players if p.seat != seat]

        if not alive_others:
            return None

        if role_id in self._FALLBACK_1_AVOID_TEAM:
            # Evil roles: target alive non-evil players
            # Good roles (rare but possible): target alive non-good
            if actor.alignment == Alignment.EVIL:
                candidates = [p for p in alive_others if p.alignment != Alignment.EVIL]
            else:
                candidates = [p for p in alive_others if p.alignment != Alignment.GOOD]
            if not candidates:
                candidates = alive_others  # fallback to anyone if all same team
            target = rng.choice(candidates)
            return NightAction(actor_seat=seat, role_id=role_id, targets=[target.seat])

        if role_id in self._FALLBACK_1_ANY:
            target = rng.choice(alive_others)
            return NightAction(actor_seat=seat, role_id=role_id, targets=[target.seat])

        if role_id in self._FALLBACK_2:
            if len(alive_others) < 2:
                # Can't pick 2 distinct targets
                return None
            targets = rng.sample(alive_others, 2)
            return NightAction(
                actor_seat=seat, role_id=role_id,
                targets=[t.seat for t in targets],
            )

        # Roles not in any fallback set (philosopher, gambler, courtier, etc.)
        # — these need role_choice which we can't generate sensibly, so skip.
        return None

    def _extract_group_preference(self, parsed: ParsedResponse) -> str:
        for action in parsed.actions:
            if action.action_type == "JOIN" and action.value:
                return action.value
            if action.action_type == "CREATE_GROUP":
                return f"new_{uuid.uuid4().hex[:6]}"
        return "any"

    def _extract_vote(self, parsed: ParsedResponse) -> bool:
        for action in parsed.actions:
            if action.action_type == "VOTE":
                return (action.value or "").upper() in ("YES", "Y", "TRUE", "1")
        return False

    # -------------------------------------------------------------------
    # Event emission
    # -------------------------------------------------------------------

    def _emit(self, event_type: str, data: dict) -> None:
        # For phase.change events, include current player status flags
        # so the frontend can update poison/drunk/protected indicators
        if event_type == "phase.change" and self.state:
            data["player_statuses"] = [
                {
                    "seat": p.seat,
                    "is_alive": p.is_alive,
                    "is_poisoned": p.is_poisoned,
                    "is_drunk": p.is_drunk,
                    "is_protected": p.is_protected,
                }
                for p in self.state.players
            ]

        # Record every broadcast event for late-joining WebSocket clients
        self.event_history.append({"type": event_type, "data": data, "ts": time.time()})
        try:
            self.on_event(event_type, data)
        except Exception:
            logger.exception("Event callback error for %s", event_type)

        # Checkpoint save after every phase change so games survive crashes
        if event_type == "phase.change":
            self._checkpoint_save()

    def _checkpoint_save(self) -> None:
        """Save current game state to disk so it survives crashes/restarts."""
        if not self.state:
            return
        try:
            from botc.api.persistence import save_game
            from botc.engine.state import snapshot_observer
            save_game(
                self.state.game_id,
                "running",
                events=self.event_history,
                initial_state=self._initial_snapshot or snapshot_observer(self.state),
            )
        except Exception:
            logger.exception("Checkpoint save failed for %s", self.state.game_id)

    def _record_tokens(
        self,
        agent_id: str,
        model: str,
        phase_id: str,
        input_tokens: int,
        output_tokens: int,
        latency_ms: float,
        seat: int | None = None,
    ) -> None:
        """Record token usage and emit an agent.tokens event."""
        rec = self.token_tracker.record(
            agent_id=agent_id,
            model=model,
            phase_id=phase_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=latency_ms,
        )
        self._emit("agent.tokens", {
            "seat": seat,
            "agent_id": agent_id,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": rec.cost_usd,
            "total_cost_usd": self.token_tracker.total_cost_usd,
        })

    # -------------------------------------------------------------------
    # Result compilation
    # -------------------------------------------------------------------

    def _compile_result(self, state: GameState) -> GameResult:
        return GameResult(
            game_id=state.game_id,
            winner=state.winner.value if state.winner else "unknown",
            win_condition=state.win_condition or "",
            total_days=state.day_number,
            players=[
                {
                    "seat": p.seat,
                    "agent_id": p.agent_id,
                    "character_name": p.character_name,
                    "role": p.role.name,
                    "initial_role": self._initial_roles.get(p.seat, p.role.name),
                    "alignment": p.alignment.value,
                    "survived": p.is_alive,
                    "model": self.agent_configs[p.seat].model,
                }
                for p in state.players
            ],
            token_summary=self.token_tracker.summary(),
            duration_seconds=time.time() - self._start_time,
        )
