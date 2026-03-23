"""Builds each agent's filtered world-view for LLM prompts.

Each function produces a text block that gets assembled into the full
prompt sent to an agent.  The key invariant: a player never receives
information they wouldn't have in a real game.

RECALL memory system:
  Instead of sending the full conversation history every turn, agents
  receive their own <MEMORY> notes + the last few visible messages.
  They can use {RECALL: query} to search past conversations on demand.
"""

from __future__ import annotations

from botc.engine.types import (
    GamePhase,
    GameState,
    Message,
    MessageType,
    Player,
)

from .visibility import player_visible_messages

# Token budget for recent messages (approximate: 1 token ≈ 4 chars)
_RECENT_TOKEN_BUDGET = 2000
_CHARS_PER_TOKEN = 4  # conservative estimate

# How many recall results to return
_RECALL_MAX_RESULTS = 10


# ---------------------------------------------------------------------------
# Game state summary (public knowledge)
# ---------------------------------------------------------------------------

def build_game_state_summary(state: GameState) -> str:
    """Summarise the public game state (identical for all agents).

    Includes: day/night, phase, player rosters, ghost votes,
    recent executions/deaths.  No per-player content so this block
    is cacheable across all agents in the same phase.
    """
    lines: list[str] = []

    # Phase + day header (prominent)
    if state.phase in (GamePhase.FIRST_NIGHT, GamePhase.NIGHT):
        lines.append(f"NIGHT {state.day_number}")
    elif state.phase == GamePhase.GAME_OVER:
        winner = state.winner.value if state.winner else "unknown"
        lines.append(f"GAME OVER — The {winner} team wins.")
    else:
        lines.append(f"DAY {state.day_number} — {_phase_label(state.phase)}")

    alive = state.alive_players
    dead = state.dead_players
    lines.append(f"{len(alive)} alive, {len(dead)} dead")

    # Player roster (no per-player markers — those go in the per-player section
    # so this block is identical across all agents for better prompt caching)
    lines.append("")
    lines.append("PLAYERS:")
    reveal = state.config.reveal_models
    def _model_tag(p: "Player") -> str:
        if reveal in (True, "true", "scramble"):
            name = p.display_model_name or p.model_name
            return f" [{name}]" if name else ""
        return ""
    for p in alive:
        lines.append(f"  Seat {p.seat}: {p.character_name}{_model_tag(p)} (alive)")
    for p in dead:
        ghost = "ghost vote available" if not p.ghost_vote_used else "ghost vote USED"
        lines.append(f"  Seat {p.seat}: {p.character_name}{_model_tag(p)} (dead, {ghost})")

    # Recent deaths/executions summary
    if state.executed_today is not None:
        executed = state.player_at(state.executed_today)
        lines.append(f"\nToday: {executed.character_name} (Seat {executed.seat}) was EXECUTED.")

    if state.night_kills:
        for seat in state.night_kills:
            killed = state.player_at(seat)
            lines.append(f"Last night: {killed.character_name} (Seat {killed.seat}) died in the night.")

    # Nominations so far
    if state.nominations:
        lines.append("\nNominations today:")
        for nom in state.nominations:
            nominator = state.player_at(nom.nominator_seat)
            nominee = state.player_at(nom.nominee_seat)
            votes = len(nom.votes_for)
            lines.append(
                f"  {nominator.character_name} nominated {nominee.character_name}"
                f" — {votes} vote(s) for, {len(nom.votes_against)} against"
                f"{' [PASSED]' if nom.passed else ''}"
            )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Private knowledge (role + memory)
# ---------------------------------------------------------------------------

def build_private_knowledge(player: Player) -> str:
    """Format this player's private information: role and ability info from the game.

    Only includes game-provided information (ability results, night info).
    Self-notes are rendered separately by :func:`build_self_notes`.
    """
    lines: list[str] = []

    role = player.effective_role
    lines.append(f"Your role: {role.name} ({role.role_type.value})")
    lines.append(f"Alignment: {player.alignment.value}")
    lines.append(f"Ability: {role.ability_text}")

    # Game-provided info (ability results, night info — NOT self-notes)
    ability_entries = [
        e for e in player.private_memory if e.source != "self_note"
    ]
    if ability_entries:
        lines.append("\nYour private information:")
        for entry in ability_entries:
            lines.append(f"  [{entry.phase_id}] ({entry.source}) {entry.content}")

    return "\n".join(lines)


def build_self_notes(player: Player) -> str:
    """Format this player's own memory notes (source='self_note').

    These are the agent's running summary — their primary continuity
    mechanism between turns.
    """
    notes = [e for e in player.private_memory if e.source == "self_note"]

    if not notes:
        return "(No notes yet. Use <MEMORY> to keep a running summary.)"

    lines: list[str] = []
    for entry in notes:
        lines.append(f"  [{entry.phase_id}] {entry.content}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Visible conversation log
# ---------------------------------------------------------------------------

def build_visible_conversation(player: Player, state: GameState) -> str:
    """Format ALL messages this player can see, in chronological order.

    Groups messages by phase for readability.
    Used by :func:`build_recall_results` for search, NOT sent to agents directly.
    """
    messages = player_visible_messages(player.seat, state)

    if not messages:
        return "No messages yet."

    lines: list[str] = []
    current_phase_id: str | None = None

    for msg in messages:
        # Phase header when phase changes
        if msg.phase_id != current_phase_id:
            current_phase_id = msg.phase_id
            lines.append(f"\n--- {current_phase_id} ---")

        lines.append(_format_message(msg, state))

    return "\n".join(lines).strip()


def build_recent_messages(
    player: Player,
    state: GameState,
    token_budget: int = _RECENT_TOKEN_BUDGET,
) -> str:
    """Include as many recent visible messages as fit within a token budget.

    Walks backward from the newest message, adding whole messages until
    the budget is exhausted.  This gives natural context — short messages
    mean more history, long speeches mean less.
    """
    messages = player_visible_messages(player.seat, state)

    if not messages:
        return "No messages yet."

    # Walk backward, accumulating messages within budget
    char_budget = token_budget * _CHARS_PER_TOKEN
    included: list[Message] = []
    total_chars = 0

    for msg in reversed(messages):
        formatted = _format_message(msg, state)
        msg_chars = len(formatted) + 30  # phase header overhead
        if total_chars + msg_chars > char_budget and included:
            break  # budget exceeded, but always include at least 1
        included.append(msg)
        total_chars += msg_chars

    included.reverse()

    # Format with phase headers
    lines: list[str] = []
    current_phase_id: str | None = None

    for msg in included:
        if msg.phase_id != current_phase_id:
            current_phase_id = msg.phase_id
            lines.append(f"\n--- {current_phase_id} ---")
        lines.append(_format_message(msg, state))

    omitted = len(messages) - len(included)
    if omitted > 0:
        lines.insert(
            0,
            f"[{omitted} earlier message(s) not shown. "
            "Use {RECALL: query} in your <ACTION> to search them — "
            "e.g. {RECALL: what did Seat 3 claim?}]",
        )

    return "\n".join(lines).strip()


def build_recall_results(player: Player, state: GameState, query: str) -> str:
    """Search past visible messages for relevance to a query.

    Simple keyword matching: find messages containing words from the query.
    Returns the top *_RECALL_MAX_RESULTS* most relevant messages, formatted
    with phase/sender context.
    """
    messages = player_visible_messages(player.seat, state)

    if not messages:
        return "No messages found."

    # Tokenise query into keywords (lowercase, skip short words)
    keywords = [w.lower() for w in query.split() if len(w) >= 2]
    if not keywords:
        return "No valid search terms in query."

    # Score each message by number of keyword hits
    scored: list[tuple[int, Message]] = []
    for msg in messages:
        text = msg.content.lower()
        score = sum(1 for kw in keywords if kw in text)
        if score > 0:
            scored.append((score, msg))

    if not scored:
        return f"No messages matching '{query}'."

    # Sort by score descending, take top N
    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:_RECALL_MAX_RESULTS]

    lines: list[str] = [f"=== RECALL RESULTS for '{query}' ({len(scored)} matches, showing top {len(top)}) ==="]
    for _score, msg in top:
        sender = _sender_label(msg.sender_seat, state)
        lines.append(f"  [{msg.phase_id}] {sender}: {msg.content}")

    return "\n".join(lines)


def _format_message(msg: Message, state: GameState) -> str:
    """Render a single message as a readable line."""
    sender_label = _sender_label(msg.sender_seat, state)

    if msg.type == MessageType.SYSTEM:
        return f"[SYSTEM] {msg.content}"

    if msg.type == MessageType.NARRATION:
        return f"[NARRATOR] {msg.content}"

    if msg.type == MessageType.PRIVATE_INFO:
        return f"[PRIVATE] {msg.content}"

    if msg.type == MessageType.PUBLIC_SPEECH:
        return f"{sender_label}: {msg.content}"

    if msg.type == MessageType.GROUP_SPEECH:
        return f"{sender_label} (group): {msg.content}"

    if msg.type == MessageType.WHISPER:
        # The player is either sender or receiver if they can see this
        if msg.visible_to:
            other_seats = [s for s in msg.visible_to if s != msg.sender_seat]
            receiver_label = _sender_label(other_seats[0], state) if other_seats else "?"
        else:
            receiver_label = "?"
        return f"[WHISPER {sender_label} → {receiver_label}] {msg.content}"

    if msg.type == MessageType.WHISPER_NOTIFICATION:
        return f"[NOTICE] {msg.content}"

    if msg.type == MessageType.NOMINATION:
        return f"[NOMINATION] {msg.content}"

    if msg.type == MessageType.VOTE:
        return f"[VOTE] {msg.content}"

    if msg.type == MessageType.ACCUSATION:
        return f"[ACCUSATION] {sender_label}: {msg.content}"

    if msg.type == MessageType.DEFENSE:
        return f"[DEFENSE] {sender_label}: {msg.content}"

    return f"[{msg.type.value}] {msg.content}"


def _sender_label(seat: int | None, state: GameState) -> str:
    """Human-readable label for a message sender."""
    if seat is None:
        return "Storyteller"
    player = state.player_at(seat)
    return f"{player.character_name} (Seat {seat})"


# ---------------------------------------------------------------------------
# Phase-specific instructions
# ---------------------------------------------------------------------------

def build_phase_instructions(player: Player, state: GameState) -> str:
    """Tell the player what action they need to take right now."""
    phase = state.phase

    if phase == GamePhase.FIRST_NIGHT:
        return _night_instructions(player, state, first_night=True)

    if phase == GamePhase.NIGHT:
        return _night_instructions(player, state, first_night=False)

    if phase == GamePhase.DAY_DISCUSSION:
        dead_reminder = ""
        if not player.is_alive:
            ghost_status = (
                "You still have your ghost vote — save it for the VOTING phase when prompted."
                if not player.ghost_vote_used
                else "You have already used your ghost vote."
            )
            dead_reminder = (
                f"\n(You are dead but may still speak briefly. {ghost_status} "
                "Declaring 'I use my ghost vote' in discussion has no mechanical effect — "
                "you must wait for the voting prompt.)"
            )
        if state.day_number <= 1:
            return (
                "It is the open discussion phase (Day 1).\n"
                "Day 1 — most characters have very little information. If you have night information "
                "or false information you think it is strategic to share at the beginning, share it "
                "in 2-3 sentences. If you have nothing to share, use {PASS} to stay silent — "
                "padding with 'I'm listening' adds nothing. Save discussion for breakout groups."
                + dead_reminder
            )
        return (
            f"It is the open discussion phase (Day {state.day_number}).\n"
            "Share new information, reveal role claims, or make accusations. "
            "If you have nothing new to add, use {PASS} — silence is strategic."
            + dead_reminder
        )

    if phase == GamePhase.DAY_BREAKOUT:
        # Check if we're in group preference phase (no groups formed yet for this round)
        current_round_groups = [
            g for g in state.breakout_groups if g.round_number == state.breakout_round
        ]
        if not current_round_groups:
            return (
                f"It is breakout round {state.breakout_round}. Time to split into small groups.\n"
                "Choose a group to join or create a new one:\n"
                "  - Use {JOIN: group_a}, {JOIN: group_b}, or {JOIN: group_c} to join a named group\n"
                "  - Use {CREATE_GROUP} to start a new group\n"
                "Think strategically about who you want to talk to privately. "
                "Evil players might want to group with their allies. "
                "Good players might want to split up information roles across groups.\n"
                "You MUST use one of these actions — do not just talk."
            )
        return (
            f"It is breakout round {state.breakout_round}. "
            "You are in a small group. Speak to your group members.\n"
            f"You may send up to {state.config.breakout.whispers_per_round} whisper(s) this round."
        )

    if phase == GamePhase.NOMINATIONS:
        if not player.is_alive:
            return "You are dead and cannot nominate."
        if player.has_nominated_today:
            return "You have already nominated today. Wait for others."
        return _nomination_turn_instructions(player, state)

    if phase == GamePhase.VOTING:
        if not player.is_alive and player.ghost_vote_used:
            return "You are dead and have used your ghost vote. You cannot vote."
        ghost_note = ""
        if not player.is_alive:
            ghost_note = (
                "*** GHOST VOTE DECISION ***\n"
                "You are dead and have exactly ONE ghost vote for the entire game. "
                "Voting YES here will permanently spend it.\n"
                "Strategic considerations:\n"
                "- Ghost votes are most powerful in the late game when margins are tight\n"
                "- A single ghost vote can swing an execution when alive players are split\n"
                "- If this nomination is likely to pass/fail regardless, consider saving your vote\n"
                "- If this is a critical vote that could decide the game, NOW may be the time\n"
                "Think carefully in your <THINK> block about whether to spend your ghost vote now or save it.\n"
            )
        return (
            f"{ghost_note}"
            "A nomination is being voted on. Vote YES or NO.\n"
            "Respond with <THINK> and <ACTION> only — no <SAY> needed for votes.\n"
            "Use <MEMORY> to update your notes."
        )

    if phase == GamePhase.EXECUTION:
        return "An execution is being carried out. Await the result."

    if phase == GamePhase.GAME_OVER:
        winner = state.winner.value if state.winner else "unknown"
        return f"The game is over. The {winner} team wins."

    if phase == GamePhase.DEBRIEF:
        winner = state.winner.value if state.winner else "unknown"
        return f"The game is over. The {winner} team wins. The Grimoire is being revealed."

    return "Awaiting the next phase."


def _night_instructions(player: Player, state: GameState, *, first_night: bool) -> str:
    """Build night-phase instructions based on the player's role."""
    role = player.effective_role

    # Check if this role acts at night
    if first_night:
        acts = role.first_night_order is not None
    else:
        acts = role.other_nights_order is not None

    if not acts:
        return (
            "It is night. Your role does not act tonight.\n"
            "You will receive any relevant information when the night ends."
        )

    # Build explicit action instruction based on role type
    if role.id == "poisoner":
        action_hint = "Use {NIGHT_TARGET: <seat_number>} to choose who to poison tonight."
    elif role.id in ("imp", "fang_gu", "no_dashii", "vortox", "po", "pukka", "shabaloth", "zombuul", "vigormortis"):
        action_hint = "Use {NIGHT_TARGET: <seat_number>} to choose who to kill tonight."
    elif role.id == "monk":
        action_hint = "Use {NIGHT_TARGET: <seat_number>} to choose who to protect tonight."
    elif role.id == "fortune_teller":
        action_hint = "Use {NIGHT_TARGET_TWO: <seat1>, <seat2>} to choose two players to divine."
    elif role.id == "butler":
        action_hint = "Use {NIGHT_TARGET: <seat_number>} to choose your master."
    elif role.id == "ravenkeeper":
        action_hint = "Use {NIGHT_TARGET: <seat_number>} to choose a player to learn the role of."
    else:
        action_hint = "Use {NIGHT_TARGET: <seat_number>} in your ACTION to select your target."

    # List eligible targets — name with seat number for the action command
    eligible = [p for p in state.players if p.seat != player.seat and p.is_alive]
    target_list = ", ".join(f"{p.character_name} ({p.seat})" for p in eligible)

    return (
        f"It is night. As the {role.name}, you MUST use your ability now.\n"
        f"Ability: {role.ability_text}\n\n"
        f"{action_hint}\n"
        f"Eligible targets: {target_list}\n\n"
        "You MUST include the action in your <ACTION> block or your ability will not activate."
    )


def _nomination_turn_instructions(player: Player, state: GameState) -> str:
    """Build detailed nomination-turn instructions with on-the-block context."""
    lines: list[str] = []
    lines.append("=== YOUR NOMINATION TURN ===")
    lines.append("It is YOUR TURN to nominate. You must decide NOW.")
    lines.append("")

    # On-the-block status
    on_the_block = state.on_the_block
    if on_the_block is not None:
        block_seat, block_votes = on_the_block
        block_player = state.player_at(block_seat)
        lines.append(
            f"ON THE BLOCK: {block_player.character_name} (Seat {block_seat}) "
            f"with {block_votes} votes — WILL BE EXECUTED at day's end "
            f"if no one else is nominated with more votes."
        )
        lines.append(
            f"To SAVE {block_player.character_name}, you must nominate someone else "
            f"and get more than {block_votes} votes."
        )
    else:
        lines.append("No one is on the block yet. If no one is nominated and put on the block, no execution happens today.")

    lines.append("")

    # Already nominated (can't be nominated again)
    already_nominated = [
        state.player_at(nom.nominee_seat)
        for nom in state.nominations
    ]
    if already_nominated:
        names = ", ".join(
            f"{p.character_name} (Seat {p.seat})" for p in already_nominated
        )
        lines.append(f"Already nominated today (cannot be nominated again): {names}")

    # Already used their nomination (can't nominate again)
    already_nominators = [
        state.player_at(nom.nominator_seat)
        for nom in state.nominations
    ]
    if already_nominators:
        names = ", ".join(
            f"{p.character_name} (Seat {p.seat})" for p in already_nominators
        )
        lines.append(f"Already nominated someone today (cannot nominate again): {names}")

    # Eligible targets
    eligible_targets = [
        p for p in state.alive_players
        if not p.was_nominated_today and p.seat != player.seat
    ]
    if eligible_targets:
        names = ", ".join(
            f"{p.character_name} (Seat {p.seat})" for p in eligible_targets
        )
        lines.append(f"Eligible nomination targets: {names}")

    lines.append("")
    lines.append(
        "Use {NOMINATE: <seat_number>} to nominate someone, or {PASS} if you choose not to."
    )
    lines.append(
        "Talking about suspicions is NOT enough — if you want someone executed, "
        "you MUST nominate them now."
    )
    lines.append(
        "Consider whether your nomination has a realistic chance of getting enough votes "
        "to execute. If not, PASS — nominations that go nowhere waste everyone's time."
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Full prompt assembly
# ---------------------------------------------------------------------------

def build_agent_context_parts(player: Player, state: GameState) -> tuple[str, str]:
    """Split context into shared prefix (cacheable) and per-player suffix.

    The shared prefix is identical across all agents in the same phase
    (modulo visibility differences in recent messages).  Putting it first
    enables prefix-based prompt caching on Anthropic and automatic prefix
    caching on OpenAI/OpenRouter.
    """
    shared = "\n".join([
        "=== GAME STATE ===",
        build_game_state_summary(state),
        "",
        "=== RECENT MESSAGES ===",
        build_recent_messages(player, state),
        "",
        "=== CURRENT PHASE INSTRUCTIONS ===",
        build_phase_instructions(player, state),
    ])

    personal = "\n".join([
        "=== YOUR PRIVATE INFORMATION ===",
        build_private_knowledge(player),
        "",
        "=== YOUR NOTES ===",
        build_self_notes(player),
        "",
        "---",
        f"You are Seat {player.seat} ({player.character_name}).",
        "Your notes above are your running summary. Update them each turn via <MEMORY>.",
        "Use {RECALL: query} in your ACTION to search past conversations you witnessed.",
    ])

    return shared, personal


def build_agent_context(player: Player, state: GameState) -> str:
    """Assemble the complete context block sent to an agent's LLM call.

    Structured for optimal prompt caching: shared context first (identical
    across all agents in the same phase), then per-player content last.
    """
    shared, personal = build_agent_context_parts(player, state)
    return shared + "\n\n" + personal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PHASE_LABELS: dict[GamePhase, str] = {
    GamePhase.DAY_DISCUSSION: "Open Discussion",
    GamePhase.DAY_BREAKOUT: "Breakout Groups",
    GamePhase.NOMINATIONS: "Nominations",
    GamePhase.VOTING: "Voting",
    GamePhase.EXECUTION: "Execution",
    GamePhase.DEBRIEF: "Post-Game Debrief",
}


def _phase_label(phase: GamePhase) -> str:
    return _PHASE_LABELS.get(phase, phase.value)
