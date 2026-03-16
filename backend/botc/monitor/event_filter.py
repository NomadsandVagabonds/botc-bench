"""Filter and format game events for the monitor agent.

Strips private information so the monitor only sees what a human spectator
would see: public speech, nominations, votes, executions, deaths, and
whisper notifications (who whispered to whom, but not content).
"""

from __future__ import annotations

from typing import Any


# Event types the monitor is allowed to see
_KEEP_TYPES = frozenset({
    "phase.change",
    "game.over",
    "nomination.start",
    "vote.cast",
    "nomination.result",
    "execution",
    "death",
    "breakout.formed",
    "breakout.ended",
    "whisper.notification",
})

# message.new sub-types that are always public
_PUBLIC_MESSAGE_TYPES = frozenset({
    "public",
    "system",
    "accusation",
    "defense",
    "narration",
})


def filter_public_events(
    events: list[dict[str, Any]],
    include_groups: bool = False,
) -> list[dict[str, Any]]:
    """Filter a raw event list to only publicly observable information.

    Parameters
    ----------
    events:
        Full event list from a saved game.
    include_groups:
        If True, include breakout group messages (``message.new`` with
        ``data.type == "group"``).  Default is False — group conversations
        are semi-private.

    Returns
    -------
    list[dict]
        Filtered events with sensitive fields stripped.
    """
    filtered: list[dict[str, Any]] = []

    for event in events:
        etype = event.get("type", "")
        data: dict[str, Any] = event.get("data", {})

        # -- message.new requires sub-type filtering --
        if etype == "message.new":
            msg_type = data.get("type", "")
            if msg_type in _PUBLIC_MESSAGE_TYPES:
                filtered.append(_strip_message(event))
            elif msg_type == "group" and include_groups:
                filtered.append(_strip_message(event))
            # private_info and everything else: dropped
            continue

        # -- Simple keep/drop for other event types --
        if etype not in _KEEP_TYPES:
            continue

        if etype == "phase.change":
            filtered.append(_strip_phase_change(event))
        elif etype in ("execution", "death"):
            filtered.append(_strip_role(event))
        elif etype == "whisper.notification":
            filtered.append(_strip_whisper_content(event))
        else:
            # nomination.start, vote.cast, nomination.result, game.over,
            # breakout.formed, breakout.ended — pass through as-is
            filtered.append(event)

    return filtered


def _strip_message(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a message event with the ``internal`` field removed."""
    data = {k: v for k, v in event.get("data", {}).items() if k != "internal"}
    return {"type": event["type"], "data": data}


def _strip_phase_change(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a phase.change event without ``player_statuses``."""
    data = {k: v for k, v in event.get("data", {}).items() if k != "player_statuses"}
    return {"type": event["type"], "data": data}


def _strip_role(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of an execution/death event without the ``role`` field.

    BotC never reveals dead player roles.
    """
    data = {k: v for k, v in event.get("data", {}).items() if k != "role"}
    return {"type": event["type"], "data": data}


def _strip_whisper_content(event: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of a whisper.notification without ``content``."""
    data = {k: v for k, v in event.get("data", {}).items() if k != "content"}
    return {"type": event["type"], "data": data}


# ---------------------------------------------------------------------------
# Phase segmentation
# ---------------------------------------------------------------------------

def segment_by_phase(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group events into phase segments.

    Each segment is::

        {"phase": str, "day": int, "events": list[dict]}

    Events before the first ``phase.change`` go into a ``"setup"`` segment
    with ``day=0``.  The phase name comes from the phase.change event's
    ``data.phase``.
    """
    segments: list[dict[str, Any]] = []
    current_phase = "setup"
    current_day = 0
    current_events: list[dict[str, Any]] = []

    for event in events:
        if event.get("type") == "phase.change":
            # Flush the current segment (if it has events)
            if current_events:
                segments.append({
                    "phase": current_phase,
                    "day": current_day,
                    "events": current_events,
                })
            # Start a new segment
            data = event.get("data", {})
            current_phase = data.get("phase", "unknown")
            current_day = data.get("day", current_day)
            current_events = []
        else:
            current_events.append(event)

    # Flush final segment
    if current_events:
        segments.append({
            "phase": current_phase,
            "day": current_day,
            "events": current_events,
        })

    return segments


# ---------------------------------------------------------------------------
# Human-readable formatting
# ---------------------------------------------------------------------------

def _player_name(seat: int | None, players: list[dict[str, Any]]) -> str:
    """Look up a character name from a seat number."""
    if seat is None:
        return "Unknown"
    for p in players:
        if p.get("seat") == seat:
            return p.get("character_name", f"Seat {seat}")
    return f"Seat {seat}"


def _player_label(seat: int | None, players: list[dict[str, Any]]) -> str:
    """Format as ``CharName (Seat N)``."""
    name = _player_name(seat, players)
    if seat is not None:
        return f"{name} (Seat {seat})"
    return name


def _format_phase_header(phase: str, day: int) -> str:
    """Create a header line like ``=== NIGHT 0 - First Night ===``."""
    phase_lower = phase.lower()
    if phase_lower == "first_night":
        return f"=== NIGHT 0 — First Night ==="
    if phase_lower == "night":
        return f"=== NIGHT {day} ==="
    if phase_lower == "day_discussion":
        return f"=== DAY {day} — Discussion ==="
    if phase_lower == "day_breakout":
        return f"=== DAY {day} — Breakout Groups ==="
    if phase_lower == "day_regroup":
        return f"=== DAY {day} — Regroup ==="
    if phase_lower == "nominations":
        return f"=== DAY {day} — Nominations ==="
    if phase_lower == "voting":
        return f"=== DAY {day} — Voting ==="
    if phase_lower == "execution":
        return f"=== DAY {day} — Execution ==="
    if phase_lower == "game_over":
        return f"=== GAME OVER ==="
    if phase_lower == "setup":
        return f"=== SETUP ==="
    return f"=== {phase.upper()} (Day {day}) ==="


def format_events_for_monitor(
    segment: dict[str, Any],
    players: list[dict[str, Any]],
) -> str:
    """Format a phase segment into human-readable text for the LLM prompt.

    Parameters
    ----------
    segment:
        A segment dict from :func:`segment_by_phase`.
    players:
        Player list from the game result (each has ``seat`` and ``character_name``).

    Returns
    -------
    str
        Formatted text block ready to include in a prompt.
    """
    lines: list[str] = []
    lines.append(_format_phase_header(segment["phase"], segment["day"]))
    lines.append("")

    for event in segment["events"]:
        line = _format_single_event(event, players)
        if line:
            lines.append(line)

    return "\n".join(lines)


def _format_single_event(
    event: dict[str, Any],
    players: list[dict[str, Any]],
) -> str | None:
    """Format a single event into a readable line. Returns None to skip."""
    etype = event.get("type", "")
    data = event.get("data", {})

    if etype == "message.new":
        return _format_message(data, players)
    if etype == "nomination.start":
        nominator = _player_label(data.get("nominator"), players)
        nominee = _player_label(data.get("nominee"), players)
        return f"NOMINATION: {nominator} nominates {nominee}"
    if etype == "vote.cast":
        voter = _player_label(data.get("seat"), players)
        nominee = _player_label(data.get("nominee"), players)
        vote = "YES" if data.get("vote") else "NO"
        return f"VOTE: {voter} votes {vote} on {nominee}"
    if etype == "nomination.result":
        nominee = _player_label(data.get("nominee"), players)
        votes_for = data.get("votes_for", [])
        votes_against = data.get("votes_against", [])
        outcome = data.get("outcome", "unknown")
        passed = outcome in ("on_the_block", "replaced")
        status = "PASSED" if passed else "FAILED"
        return (
            f"RESULT: {nominee} — {status} "
            f"({len(votes_for)} for, {len(votes_against)} against, "
            f"outcome: {outcome})"
        )
    if etype == "execution":
        executed = _player_label(data.get("seat"), players)
        return f"EXECUTION: {executed} was executed"
    if etype == "death":
        dead = _player_label(data.get("seat"), players)
        cause = data.get("cause", data.get("death_cause", "unknown"))
        if "night" in cause or "demon" in cause:
            return f"DEATH: {dead} died during the night"
        return f"DEATH: {dead} died ({cause})"
    if etype == "whisper.notification":
        sender = _player_label(data.get("from"), players)
        receiver = _player_label(data.get("to"), players)
        return f"WHISPER: {sender} whispered to {receiver}"
    if etype == "breakout.formed":
        groups = data.get("groups", [])
        parts: list[str] = []
        for i, g in enumerate(groups, 1):
            members = [_player_name(s, players) for s in g.get("members", [])]
            parts.append(f"Group {i}: [{', '.join(members)}]")
        return f"GROUPS FORMED: {', '.join(parts)}"
    if etype == "breakout.ended":
        return "BREAKOUT ENDED"
    if etype == "game.over":
        winner = data.get("winner", "unknown")
        reason = data.get("reason", "")
        return f"GAME OVER: {winner} wins! {reason}"

    return None


def _format_message(
    data: dict[str, Any],
    players: list[dict[str, Any]],
) -> str | None:
    """Format a message.new event's data."""
    msg_type = data.get("type", "")
    content = data.get("content", "")
    seat = data.get("seat")

    if msg_type == "system":
        return f"[System]: {content}"
    if msg_type == "narration":
        return f"[Narrator]: {content}"
    if msg_type in ("public", "accusation", "defense"):
        label = _player_label(seat, players)
        prefix = ""
        if msg_type == "accusation":
            prefix = "[ACCUSATION] "
        elif msg_type == "defense":
            prefix = "[DEFENSE] "
        return f'{prefix}[{label}]: "{content}"'
    if msg_type == "group":
        label = _player_label(seat, players)
        group_id = data.get("group_id", "?")
        return f'[{label}] (group): "{content}"'

    return None
