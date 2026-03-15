"""Game phase state machine: manages transitions between phases."""

from __future__ import annotations

from .types import GamePhase, GameState


# Valid transitions from each phase
VALID_TRANSITIONS: dict[GamePhase, list[GamePhase]] = {
    GamePhase.SETUP: [GamePhase.FIRST_NIGHT],
    GamePhase.FIRST_NIGHT: [GamePhase.DAY_DISCUSSION],
    GamePhase.DAY_DISCUSSION: [GamePhase.DAY_BREAKOUT, GamePhase.NOMINATIONS, GamePhase.GAME_OVER],
    GamePhase.DAY_BREAKOUT: [GamePhase.DAY_REGROUP, GamePhase.DAY_BREAKOUT, GamePhase.GAME_OVER],
    GamePhase.DAY_REGROUP: [GamePhase.DAY_BREAKOUT, GamePhase.NOMINATIONS, GamePhase.GAME_OVER],
    GamePhase.NOMINATIONS: [GamePhase.VOTING, GamePhase.EXECUTION, GamePhase.NIGHT, GamePhase.GAME_OVER],
    GamePhase.VOTING: [GamePhase.EXECUTION, GamePhase.NOMINATIONS, GamePhase.NIGHT, GamePhase.GAME_OVER],
    GamePhase.EXECUTION: [GamePhase.NIGHT, GamePhase.GAME_OVER],
    GamePhase.NIGHT: [GamePhase.DAY_DISCUSSION, GamePhase.GAME_OVER],
    GamePhase.GAME_OVER: [GamePhase.DEBRIEF],
    GamePhase.DEBRIEF: [],
}


def validate_transition(from_phase: GamePhase, to_phase: GamePhase) -> bool:
    """Check if a phase transition is valid."""
    return to_phase in VALID_TRANSITIONS.get(from_phase, [])


def transition(state: GameState, to_phase: GamePhase) -> None:
    """Perform a phase transition with validation.

    Raises ValueError if the transition is not valid.
    """
    if not validate_transition(state.phase, to_phase):
        raise ValueError(
            f"Invalid transition: {state.phase.value} -> {to_phase.value}. "
            f"Valid targets: {[p.value for p in VALID_TRANSITIONS.get(state.phase, [])]}"
        )

    state.transition_to(to_phase)

    # Phase entry logic
    if to_phase == GamePhase.DAY_DISCUSSION:
        state.start_new_day()
    elif to_phase == GamePhase.DAY_BREAKOUT:
        state.breakout_round += 1
    elif to_phase == GamePhase.GAME_OVER:
        pass  # Winner should already be set


def next_phase_after_breakout(state: GameState) -> GamePhase:
    """Determine next phase after a breakout round.

    Goes to REGROUP if more rounds remain, otherwise NOMINATIONS.
    """
    if state.breakout_round < state.config.breakout.num_rounds:
        return GamePhase.DAY_REGROUP
    return GamePhase.NOMINATIONS


def next_phase_after_regroup(state: GameState) -> GamePhase:
    """Determine next phase after regrouping.

    Goes to another BREAKOUT if rounds remain, otherwise NOMINATIONS.
    """
    if state.breakout_round < state.config.breakout.num_rounds:
        return GamePhase.DAY_BREAKOUT
    return GamePhase.NOMINATIONS


def next_phase_after_voting(state: GameState) -> GamePhase:
    """Determine next phase after voting on a nomination."""
    # Check if there are more nominations to vote on
    unresolved = [
        n for n in state.nominations
        if not n.votes_for and not n.votes_against and not n.passed
    ]
    if unresolved:
        return GamePhase.VOTING

    # Check if execution happened
    from .day import resolve_execution
    executed_seat = resolve_execution(state)

    if executed_seat is not None:
        return GamePhase.EXECUTION

    # No execution -> night
    return GamePhase.NIGHT


def should_skip_breakout(state: GameState) -> bool:
    """Check if breakout rounds should be skipped (e.g., too few alive players)."""
    return len(state.alive_players) <= 3
