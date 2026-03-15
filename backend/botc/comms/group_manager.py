"""Breakout group formation and conversation routing.

During DAY_BREAKOUT, alive players split into small groups for private
discussion.  Agents submit a preference (a group ID or "any"), and this
module resolves those preferences into concrete BreakoutGroup objects,
respecting size constraints from BreakoutConfig.
"""

from __future__ import annotations

import uuid

from botc.engine.types import (
    BreakoutGroup,
    GameState,
    Message,
    MessageType,
)


# ---------------------------------------------------------------------------
# Group creation from agent preferences
# ---------------------------------------------------------------------------

def create_groups(
    preferences: dict[int, str],
    state: GameState,
) -> list[BreakoutGroup]:
    """Resolve agent group preferences into breakout groups.

    Args:
        preferences: mapping of seat -> preferred group label.
            Agents who share the same label are placed together.
            The label "any" means the agent has no preference.
        state: current game state (used for config constraints).

    Returns:
        The list of newly created BreakoutGroup objects.  These are also
        appended to ``state.breakout_groups``.
    """
    config = state.config.breakout
    all_seats = {p.seat for p in state.players}

    # Bucket seats by requested label
    buckets: dict[str, list[int]] = {}
    floaters: list[int] = []  # "any" preference

    for seat, pref in preferences.items():
        if seat not in all_seats:
            continue
        label = pref.strip().lower()
        if label in ("any", ""):
            floaters.append(seat)
        else:
            buckets.setdefault(label, []).append(seat)

    # Include players who didn't submit a preference at all
    submitted = set(preferences.keys())
    for seat in all_seats:
        if seat not in submitted:
            floaters.append(seat)

    # Merge undersized buckets into the floater pool
    final_buckets: list[list[int]] = []
    for members in buckets.values():
        if len(members) < config.min_group_size:
            floaters.extend(members)
        else:
            final_buckets.append(members)

    # Cap number of groups
    if len(final_buckets) > config.max_groups:
        # Overflow groups become floaters
        overflow = final_buckets[config.max_groups:]
        final_buckets = final_buckets[:config.max_groups]
        for members in overflow:
            floaters.extend(members)

    # Distribute floaters across existing groups, or create new ones
    _distribute_floaters(floaters, final_buckets, config.min_group_size, config.max_groups)

    # Build BreakoutGroup objects
    round_number = state.breakout_round
    groups: list[BreakoutGroup] = []
    for members in final_buckets:
        group = BreakoutGroup(
            id=uuid.uuid4().hex,
            round_number=round_number,
        )
        for seat in members:
            group.add_member(seat)
        groups.append(group)

    state.breakout_groups.extend(groups)

    # Announce groups
    for group in groups:
        member_labels = ", ".join(
            f"{state.player_at(s).agent_id} (Seat {s})" for s in group.members
        )
        state.add_message(Message.system(
            state.phase_id,
            f"Breakout group formed: {member_labels}",
        ))

    return groups


def _distribute_floaters(
    floaters: list[int],
    buckets: list[list[int]],
    min_size: int,
    max_groups: int,
) -> None:
    """Assign floaters to existing groups or create new groups from them.

    Mutates ``buckets`` and drains ``floaters`` in-place.
    """
    if not floaters:
        return

    # If no buckets yet, seed new ones from the floater pool
    if not buckets:
        while floaters and len(buckets) < max_groups:
            new_group = floaters[:min_size]
            floaters[:min_size] = []
            if len(new_group) >= min_size:
                buckets.append(new_group)
            else:
                # Not enough to form a group; put them back
                floaters.extend(new_group)
                break

    # Remaining floaters go into the smallest group, round-robin style
    while floaters:
        if not buckets:
            # Edge case: nobody formed a group (fewer players than min_size)
            buckets.append(floaters[:])
            floaters.clear()
            break
        smallest = min(buckets, key=len)
        smallest.append(floaters.pop(0))


# ---------------------------------------------------------------------------
# Message routing
# ---------------------------------------------------------------------------

def add_group_message(
    group: BreakoutGroup,
    seat: int,
    content: str,
    state: GameState,
) -> Message:
    """Add a message scoped to a breakout group.

    The message is visible only to group members who joined before it.

    Returns the created Message.
    """
    if seat not in group.members:
        raise ValueError(f"Seat {seat} is not a member of group {group.id}")

    msg = Message(
        id=uuid.uuid4().hex,
        type=MessageType.GROUP_SPEECH,
        phase_id=state.phase_id,
        sender_seat=seat,
        content=content,
        visible_to=set(group.members),
        group_id=group.id,
    )
    group.messages.append(msg)
    state.add_message(msg)
    return msg


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------

def get_group_for_player(seat: int, state: GameState) -> BreakoutGroup | None:
    """Return the current-round breakout group for a player, if any."""
    current_round = state.breakout_round
    for group in state.breakout_groups:
        if group.round_number == current_round and seat in group.members:
            return group
    return None


def get_groups_for_round(round_number: int, state: GameState) -> list[BreakoutGroup]:
    """Return all breakout groups for a given round number."""
    return [g for g in state.breakout_groups if g.round_number == round_number]
