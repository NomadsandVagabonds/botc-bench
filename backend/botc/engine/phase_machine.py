"""Game phase state machine: manages transitions between phases."""

from __future__ import annotations

from .types import GamePhase, GameState


# Valid transitions from each phase
VALID_TRANSITIONS: dict[GamePhase, list[GamePhase]] = {
    GamePhase.SETUP: [GamePhase.FIRST_NIGHT],
    GamePhase.FIRST_NIGHT: [GamePhase.DAY_DISCUSSION],
    GamePhase.DAY_DISCUSSION: [GamePhase.DAY_BREAKOUT, GamePhase.NOMINATIONS, GamePhase.GAME_OVER],
    GamePhase.DAY_BREAKOUT: [GamePhase.DAY_BREAKOUT, GamePhase.NOMINATIONS, GamePhase.GAME_OVER],
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


def should_skip_breakout(state: GameState) -> bool:
    """Check if breakout rounds should be skipped (e.g., too few alive players)."""
    return len(state.alive_players) < state.config.breakout_min_players
