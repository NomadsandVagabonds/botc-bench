"""Information visibility rules engine.

Determines which messages each player can see, enforcing the
information-asymmetry that makes BotC interesting:

- Public messages (visible_to=None) are visible to everyone.
- Group messages are visible only to members who joined BEFORE the message.
- Whisper content is visible only to sender + receiver; all players see
  a notification that the whisper occurred.
- Night info (PRIVATE_INFO) is visible only to the target player.
- THINK messages are never visible to any player (observer/log only).
"""

from __future__ import annotations

from botc.engine.types import (
    BreakoutGroup,
    GameState,
    Message,
    MessageType,
)


def _is_visible_to_player(msg: Message, seat: int, state: GameState) -> bool:
    """Check whether a single message is visible to the given player seat."""

    # THINK messages are never visible to any player
    if msg.type == MessageType.THINK:
        return False

    # Public messages: visible_to=None means everyone can see
    if msg.visible_to is None:
        return True

    # Group-scoped messages: check membership AND join timing
    if msg.type == MessageType.GROUP_SPEECH and msg.group_id is not None:
        group = _find_group(msg.group_id, state)
        if group is None:
            return False
        if seat not in group.members:
            return False
        # Player must have joined before the message was sent
        join_time = group.join_timestamps.get(seat)
        if join_time is None:
            return False
        return join_time <= msg.timestamp

    # Whisper content: only sender + receiver
    if msg.type == MessageType.WHISPER:
        return seat in msg.visible_to

    # Whisper notification: visible to everyone (visible_to=None handled above,
    # but if someone constructed it with a set, still broadcast)
    if msg.type == MessageType.WHISPER_NOTIFICATION:
        return True

    # Explicit visibility set (PRIVATE_INFO, etc.)
    if msg.visible_to is not None:
        return seat in msg.visible_to

    return True


def _find_group(group_id: str, state: GameState) -> BreakoutGroup | None:
    """Look up a breakout group by ID."""
    for group in state.breakout_groups:
        if group.id == group_id:
            return group
    return None


def player_visible_messages(seat: int, state: GameState) -> list[Message]:
    """Return all messages from the game log that are visible to this player.

    Messages are returned in their original chronological order.
    """
    return [
        msg for msg in state.all_messages
        if _is_visible_to_player(msg, seat, state)
    ]


def message_visible_to_seats(msg: Message, state: GameState) -> set[int]:
    """Return the set of player seats that can see the given message.

    Useful for logging/debugging which players can see what.
    """
    if msg.type == MessageType.THINK:
        return set()

    all_seats = {p.seat for p in state.players}

    if msg.visible_to is None and msg.type != MessageType.GROUP_SPEECH:
        return all_seats

    if msg.type == MessageType.WHISPER_NOTIFICATION:
        return all_seats

    if msg.type == MessageType.GROUP_SPEECH and msg.group_id is not None:
        group = _find_group(msg.group_id, state)
        if group is None:
            return set()
        return {
            seat for seat in group.members
            if group.join_timestamps.get(seat, float("inf")) <= msg.timestamp
        }

    if msg.visible_to is not None:
        return msg.visible_to & all_seats

    return all_seats
