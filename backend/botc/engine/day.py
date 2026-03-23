"""Day phase logic: nominations, voting, and execution."""

from __future__ import annotations

from .abilities import (
    _player_label,
    check_scarlet_woman,
    on_player_death,
    resolve_virgin_nomination,
    survives_execution,
)
from .types import (
    GameState,
    Message,
    NominationRecord,
    Player,
    RoleType,
)


def process_nomination(
    state: GameState,
    nominator_seat: int,
    nominee_seat: int,
) -> NominationRecord:
    """Record a nomination. Returns the NominationRecord."""
    nominator = state.player_at(nominator_seat)
    nominee = state.player_at(nominee_seat)

    nominator.has_nominated_today = True
    nominee.was_nominated_today = True

    record = NominationRecord(
        nominator_seat=nominator_seat,
        nominee_seat=nominee_seat,
    )
    state.nominations.append(record)

    state.add_message(Message.system(
        state.phase_id,
        f"{_player_label(state, nominator_seat)} nominates {_player_label(state, nominee_seat)}.",
    ))

    # Witch curse: if this player nominates while cursed, they die immediately.
    # The nomination itself still stands.  Per BotC rules, the Witch curse
    # does NOT apply when only 3 players are alive.
    cursed_today = nominator.hidden_state.get("witch_cursed_day") == state.day_number
    if (
        nominator.hidden_state.pop("witch_cursed", False)
        and cursed_today
        and nominator.is_alive
        and len(state.alive_players) > 3
    ):
        nominator.hidden_state.pop("witch_cursed_by", None)
        nominator.hidden_state.pop("witch_cursed_day", None)
        nominator.is_alive = False
        nominator.death_cause = "witch_curse"
        nominator.death_day = state.day_number
        nominator.death_phase = "day"
        on_player_death(state, nominator)
        state.add_message(Message.system(
            state.phase_id,
            f"{_player_label(state, nominator_seat)} was cursed by the Witch and dies for nominating.",
        ))

    # Virgin ability check
    if nominee.role.id == "virgin" and not nominee.hidden_state.get("virgin_used"):
        executed = resolve_virgin_nomination(state, nominee, nominator)
        if executed:
            state.add_message(Message.system(
                state.phase_id,
                f"{_player_label(state, nominator_seat)} nominated the Virgin and is executed!",
            ))
            state.executed_today = nominator_seat
            check_scarlet_woman(state)

    return record


def process_vote(
    state: GameState,
    nomination: NominationRecord,
    voter_seat: int,
    vote_yes: bool,
) -> None:
    """Record a vote on a nomination."""
    # Already voted on this nomination — prevent duplicates
    if voter_seat in nomination.votes_for or voter_seat in nomination.votes_against:
        return

    voter = state.player_at(voter_seat)

    # Dead players can use their ghost vote once
    if not voter.is_alive:
        if voter.ghost_vote_used:
            return  # Can't vote again
        if not vote_yes:
            return  # Dead players abstain rather than voting NO

    # Butler restriction: can only vote if master has voted YES
    # (checked before consuming ghost vote so a blocked vote doesn't waste it)
    if voter.butler_master is not None and vote_yes:
        if voter.butler_master not in nomination.votes_for:
            return

    # Consume ghost vote after all restriction checks pass
    if not voter.is_alive and vote_yes:
        voter.ghost_vote_used = True

    if vote_yes:
        nomination.votes_for.append(voter_seat)
    else:
        nomination.votes_against.append(voter_seat)


def resolve_execution(state: GameState, on_the_block: int | None = None) -> int | None:
    """Execute the player who is "on the block" after all nominations.

    If *on_the_block* is provided (new flow), that seat is executed directly.
    Otherwise falls back to legacy behaviour: scan all nominations for the
    highest vote-getter above threshold (ties mean no execution).

    Returns the seat of the executed player, or None.
    """
    if on_the_block is not None:
        # New flow: the game runner already determined who is on the block.
        executed = state.player_at(on_the_block)
        state.executed_today = on_the_block

        for nom in state.nominations:
            if nom.nominee_seat == on_the_block and nom.outcome in ("on_the_block", "replaced"):
                nom.passed = True
                break

        if survives_execution(state, executed):
            state.add_message(Message.system(
                state.phase_id,
                f"{_player_label(state, on_the_block)} was executed, but did not die.",
            ))
            return on_the_block

        executed.is_alive = False
        executed.death_cause = "executed"
        executed.death_day = state.day_number
        executed.death_phase = "day"
        on_player_death(state, executed)
        _apply_minstrel_effect(state, executed)
        _arm_mastermind_if_needed(state, executed)

        threshold = state.vote_threshold()
        block_nom = next(
            (n for n in state.nominations if n.nominee_seat == on_the_block and n.passed),
            None,
        )
        vote_count = len(block_nom.votes_for) if block_nom else "?"

        state.add_message(Message.system(
            state.phase_id,
            f"{_player_label(state, on_the_block)} has been executed. "
            f"({vote_count} votes, {threshold} needed)",
        ))

        check_scarlet_woman(state)
        return on_the_block

    # --- Legacy fallback (no on_the_block provided) ---
    if not state.nominations:
        return None

    threshold = state.vote_threshold()
    best: NominationRecord | None = None
    tied = False

    for nom in state.nominations:
        vote_count = len(nom.votes_for)
        if vote_count < threshold:
            continue

        if best is None or vote_count > len(best.votes_for):
            best = nom
            tied = False
        elif vote_count == len(best.votes_for):
            tied = True

    if best is None or tied:
        state.add_message(Message.system(
            state.phase_id,
            "No player received enough votes for execution." if best is None
            else "The vote was tied. No execution today.",
        ))
        return None

    # Execute the player
    executed_seat = best.nominee_seat
    executed = state.player_at(executed_seat)
    state.executed_today = executed_seat
    best.passed = True
    if survives_execution(state, executed):
        state.add_message(Message.system(
            state.phase_id,
            f"{_player_label(state, executed_seat)} was executed, but did not die.",
        ))
        return executed_seat

    executed.is_alive = False
    executed.death_cause = "executed"
    executed.death_day = state.day_number
    executed.death_phase = "day"
    on_player_death(state, executed)
    _apply_minstrel_effect(state, executed)
    _arm_mastermind_if_needed(state, executed)

    state.add_message(Message.system(
        state.phase_id,
        f"{_player_label(state, executed_seat)} has been executed. "
        f"({len(best.votes_for)} votes, {threshold} needed)",
    ))

    # Scarlet Woman check
    check_scarlet_woman(state)

    return executed_seat


def can_nominate(state: GameState, nominator_seat: int) -> bool:
    """Check if a player can make a nomination."""
    player = state.player_at(nominator_seat)
    if not player.is_alive:
        return False
    if player.has_nominated_today:
        return False
    return True


def can_be_nominated(state: GameState, nominee_seat: int) -> bool:
    """Check if a player can be nominated."""
    player = state.player_at(nominee_seat)
    if player.was_nominated_today:
        return False
    # Dead players can be nominated (it's allowed in BotC)
    return True


def can_vote(state: GameState, voter_seat: int) -> bool:
    """Check if a player can vote."""
    player = state.player_at(voter_seat)
    if not player.is_alive and player.ghost_vote_used:
        return False
    return True


def _apply_minstrel_effect(state: GameState, executed: Player) -> None:
    """If a Minion dies by execution and a Minstrel is alive, others are drunk until next dusk."""
    if executed.role.role_type != RoleType.MINION:
        return
    # Only applies if an alive, non-poisoned Minstrel is in the game
    minstrel = next(
        (p for p in state.alive_players if p.role.id == "minstrel" and not p.is_poisoned),
        None,
    )
    if minstrel is None:
        return
    for player in state.players:
        if player.seat == executed.seat or player.role.id == "minstrel":
            continue
        player.hidden_state["minstrel_drunk_until_day"] = state.day_number + 1


def _arm_mastermind_if_needed(state: GameState, executed: Player) -> None:
    """If Demon is executed while Mastermind lives, grant one extra day."""
    if executed.role.role_type != RoleType.DEMON:
        return
    for player in state.alive_players:
        if player.role.id == "mastermind" and not player.is_poisoned:
            player.hidden_state["mastermind_extra_day"] = state.day_number + 1
