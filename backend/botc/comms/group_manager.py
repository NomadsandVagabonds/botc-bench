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

_MIN_GROUP_OPTIONS = 4  # Always present at least this many groups as choices


def create_groups(
    preferences: dict[int, str],
    state: GameState,
) -> list[BreakoutGroup]:
    """Resolve agent group preferences into breakout groups.

    At least ``_MIN_GROUP_OPTIONS`` groups are seeded so agents always have
    choices.  No single group may exceed 1/3 of total players — overflow
    is redistributed to smaller groups.  Agents may also ``{CREATE_GROUP}``
    to add groups beyond the defaults (up to ``max_groups``).

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
    max_per_group = max(config.min_group_size, len(all_seats) // 3)

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

    # Seed at least _MIN_GROUP_OPTIONS named buckets so agents always have
    # options.  Default labels are "a", "b", "c", "d", ...
    n_seed = max(_MIN_GROUP_OPTIONS, len(buckets))
    for i in range(n_seed):
        label = chr(ord("a") + i)
        buckets.setdefault(label, [])

    # Enforce per-group cap (1/3 of players) — overflow becomes floaters
    for label, members in list(buckets.items()):
        if len(members) > max_per_group:
            floaters.extend(members[max_per_group:])
            buckets[label] = members[:max_per_group]

    # Cap total number of groups at max_groups — overflow groups become floaters
    labels_by_size = sorted(buckets.keys(), key=lambda k: -len(buckets[k]))
    if len(labels_by_size) > config.max_groups:
        for label in labels_by_size[config.max_groups:]:
            floaters.extend(buckets.pop(label))

    # Distribute floaters across groups, respecting the per-group cap
    _distribute_floaters(floaters, buckets, max_per_group)

    # Remove empty groups — they were offered as options but nobody joined
    final_buckets = [members for members in buckets.values() if members]

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
    buckets: dict[str, list[int]],
    max_per_group: int,
) -> None:
    """Assign floaters to groups, respecting the per-group cap.

    Distributes into the smallest group that still has room, round-robin.
    Mutates ``buckets`` and drains ``floaters`` in-place.
    """
    if not floaters:
        return

    while floaters:
        # Find the smallest group that isn't full
        eligible = [
            (label, members)
            for label, members in buckets.items()
            if len(members) < max_per_group
        ]
        if not eligible:
            # All groups are full — shouldn't happen if max_groups * max_per_group >= num_players
            # but as a safety valve, put remaining into the smallest group anyway
            smallest_label = min(buckets, key=lambda k: len(buckets[k]))
            buckets[smallest_label].append(floaters.pop(0))
            continue

        # Pick the smallest eligible group
        smallest_label = min(eligible, key=lambda x: len(x[1]))[0]
        buckets[smallest_label].append(floaters.pop(0))


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
