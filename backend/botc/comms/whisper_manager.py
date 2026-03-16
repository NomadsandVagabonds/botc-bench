"""Whisper mechanics for private player-to-player communication.

In Blood on the Clocktower, whispers are semi-private: the content is
known only to the sender and receiver, but ALL players are publicly
notified that a whisper occurred (and between whom).  This creates
interesting social dynamics — whispering draws attention.

Whisper limits are configured via BreakoutConfig.whispers_per_round and
max_whisper_chars.
"""

from __future__ import annotations

import uuid

from botc.engine.types import (
    GameState,
    Message,
    MessageType,
    WhisperRecord,
)


def send_whisper(
    sender_seat: int,
    receiver_seat: int,
    content: str,
    state: GameState,
) -> WhisperRecord:
    """Send a whisper from one player to another.

    Creates:
      1. A WhisperRecord stored in state.whispers
      2. A WHISPER message (visible only to sender + receiver)
      3. A WHISPER_NOTIFICATION message (visible to all players)

    Raises ValueError if the whisper is invalid (limits exceeded, etc.).
    """
    _validate_whisper(sender_seat, receiver_seat, content, state)

    # Truncate content to max length
    max_chars = state.config.breakout.max_whisper_chars
    truncated = content[:max_chars]

    sender = state.player_at(sender_seat)
    receiver = state.player_at(receiver_seat)

    # Record
    record = WhisperRecord(
        sender_seat=sender_seat,
        receiver_seat=receiver_seat,
        content=truncated,
        phase_id=state.phase_id,
    )
    state.whispers.append(record)

    # Private whisper message (only sender + receiver see content)
    whisper_msg = Message(
        id=uuid.uuid4().hex,
        type=MessageType.WHISPER,
        phase_id=state.phase_id,
        sender_seat=sender_seat,
        content=truncated,
        visible_to={sender_seat, receiver_seat},
    )
    state.add_message(whisper_msg)

    # Public notification (everyone sees that a whisper happened)
    notification_msg = Message(
        id=uuid.uuid4().hex,
        type=MessageType.WHISPER_NOTIFICATION,
        phase_id=state.phase_id,
        sender_seat=None,
        content=(
            f"{sender.agent_id} (Seat {sender_seat}) whispered to "
            f"{receiver.agent_id} (Seat {receiver_seat})."
        ),
        visible_to=None,  # public
    )
    state.add_message(notification_msg)

    return record


def can_whisper(sender_seat: int, state: GameState) -> bool:
    """Check whether the sender has remaining whisper quota this round.

    Returns False if:
      - The sender is dead
      - The sender has exhausted their whispers for this breakout round
    """
    sender = state.player_at(sender_seat)
    if not sender.is_alive:
        return False

    limit = state.config.breakout.whispers_per_round
    used = _whispers_used_this_round(sender_seat, state)
    return used < limit


def get_whispers_for_player(seat: int, state: GameState) -> list[WhisperRecord]:
    """Return all whispers where this player is sender or receiver."""
    return [
        w for w in state.whispers
        if w.sender_seat == seat or w.receiver_seat == seat
    ]


def get_whispers_this_phase(state: GameState) -> list[WhisperRecord]:
    """Return all whispers that occurred in the current phase."""
    phase_id = state.phase_id
    return [w for w in state.whispers if w.phase_id == phase_id]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _whispers_used_this_round(sender_seat: int, state: GameState) -> int:
    """Count whispers the sender has sent in the current breakout round."""
    # Current round's phase_id prefix: e.g. "day_2_breakout_1"
    current_phase = state.phase_id
    return sum(
        1 for w in state.whispers
        if w.sender_seat == sender_seat and w.phase_id == current_phase
    )


def _validate_whisper(
    sender_seat: int,
    receiver_seat: int,
    content: str,
    state: GameState,
) -> None:
    """Validate a whisper attempt, raising ValueError on failure."""
    sender = state.player_at(sender_seat)
    receiver = state.player_at(receiver_seat)

    if not sender.is_alive:
        raise ValueError(f"Dead player (Seat {sender_seat}) cannot whisper.")

    if not receiver.is_alive:
        raise ValueError(f"Cannot whisper to dead player (Seat {receiver_seat}).")

    if sender_seat == receiver_seat:
        raise ValueError("Cannot whisper to yourself.")

    if not content or not content.strip():
        raise ValueError("Whisper content cannot be empty.")

    limit = state.config.breakout.whispers_per_round
    used = _whispers_used_this_round(sender_seat, state)
    if used >= limit:
        raise ValueError(
            f"Seat {sender_seat} has used all {limit} whisper(s) this round."
        )
