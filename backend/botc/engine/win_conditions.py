"""Win condition checks for Blood on the Clocktower."""

from __future__ import annotations

from dataclasses import dataclass

from .types import Alignment, GamePhase, GameState, RoleType


@dataclass
class WinResult:
    alignment: Alignment
    reason: str


def check_win_conditions(state: GameState) -> WinResult | None:
    """Check all win conditions. Returns WinResult if the game is over."""
    # S&V: If Klutz chose an evil player after death, Good loses.
    result = _check_klutz_chose_evil(state)
    if result:
        return result

    # S&V: If the good twin is executed, Evil wins immediately.
    result = _check_good_twin_executed(state)
    if result:
        return result

    # S&V: If Vortox is alive and no execution occurred today, Evil wins.
    result = _check_vortox_no_execution(state)
    if result:
        return result

    # Check for demon death
    result = _check_demon_dead(state)
    if result:
        return result

    # Check for too few alive (2 players left = evil wins)
    result = _check_final_two(state)
    if result:
        return result

    # Check for Saint execution
    result = _check_saint_executed(state)
    if result:
        return result

    # Check for Mayor win (3 alive, no execution)
    result = _check_mayor_win(state)
    if result:
        return result

    # Safety cap — should never happen in normal play.
    # Not a real BotC rule. Scales with player count (2x players).
    safety_cap = max(state.config.max_days, len(state.players) * 2)
    if state.day_number >= safety_cap:
        return WinResult(
            alignment=Alignment.EVIL,
            reason="Safety cap reached (this is not a real BotC rule — game ran too long).",
        )

    return None


def _check_demon_dead(state: GameState) -> WinResult | None:
    """If no living Demon exists, Good wins.

    Exception: Scarlet Woman may have already taken over (handled in abilities).
    """
    demons_alive = [
        p for p in state.alive_players
        if p.role.role_type == RoleType.DEMON
    ]
    if not demons_alive:
        mastermind = next(
            (
                p for p in state.alive_players
                if p.role.id == "mastermind"
                and p.hidden_state.get("mastermind_extra_day") is not None
            ),
            None,
        )
        if mastermind is not None:
            extra_day = int(mastermind.hidden_state["mastermind_extra_day"])
            if state.day_number < extra_day:
                return None
            if state.day_number == extra_day:
                if state.phase not in (GamePhase.NIGHT, GamePhase.GAME_OVER):
                    return None
                if state.executed_today is None:
                    return WinResult(
                        alignment=Alignment.EVIL,
                        reason="No execution occurred on the Mastermind extra day. Evil wins!",
                    )

        # S&V: Good cannot win while both twins are alive.
        if _evil_twin_both_alive(state):
            return None
        return WinResult(
            alignment=Alignment.GOOD,
            reason="The Demon is dead. Good wins!",
        )
    return None


def _check_final_two(state: GameState) -> WinResult | None:
    """If only 2 players remain alive, Evil wins (Demon + 1)."""
    if len(state.alive_players) <= 2:
        # Make sure a demon is still alive
        demons_alive = [
            p for p in state.alive_players
            if p.role.role_type == RoleType.DEMON
        ]
        if demons_alive:
            return WinResult(
                alignment=Alignment.EVIL,
                reason="Only 2 players remain. Evil wins!",
            )
    return None


def _check_saint_executed(state: GameState) -> WinResult | None:
    """If the Saint was executed, Evil wins."""
    if state.executed_today is not None:
        executed = state.player_at(state.executed_today)
        if executed.role.id == "saint":
            return WinResult(
                alignment=Alignment.EVIL,
                reason="The Saint was executed. Evil wins!",
            )
    return None


def _check_mayor_win(state: GameState) -> WinResult | None:
    """If 3 players alive, no execution today, and Mayor is alive, Good wins.

    Per BotC rules, the Mayor win triggers when the day ends with no execution
    and exactly 3 players alive. Night kills should not retroactively satisfy
    this condition — the 3-alive count must be true at end-of-day.
    """
    # Only check during the transition from nominations to night (end-of-day).
    # NIGHT phase is set right after nominations; executed_today reflects this day.
    # Exclude post-night-kill checks by requiring executed_today to have been
    # evaluated this day (not carried over from a previous day after start_new_day reset).
    if state.phase not in (GamePhase.NIGHT, GamePhase.NOMINATIONS, GamePhase.GAME_OVER):
        return None

    # After night kills, start_new_day hasn't run yet so executed_today still
    # reflects the current day. But alive count may have changed due to night
    # kills. We need 3 alive at the END of the day (before night kills).
    # Gate on: we are entering night (not after night resolution).
    # The game runner calls check_win_conditions both at the top of the loop
    # (line 263, before start_new_day) and after night kills (line 309).
    # At line 309, night_kills is populated; at line 263/1115, it is not.
    if state.night_kills:
        return None

    if len(state.alive_players) != 3:
        return None

    if state.executed_today is not None:
        return None

    mayors = [
        p for p in state.alive_players
        if p.role.id == "mayor" and not p.is_poisoned
    ]
    if mayors:
        if _evil_twin_both_alive(state):
            return None
        return WinResult(
            alignment=Alignment.GOOD,
            reason="3 players remain with no execution. The Mayor wins for Good!",
        )
    return None


def _evil_twin_both_alive(state: GameState) -> bool:
    """Whether an Evil Twin and their paired good twin are both alive."""
    for evil_twin in state.players:
        if evil_twin.role.id != "evil_twin" or not evil_twin.is_alive:
            continue
        twin_seat = evil_twin.hidden_state.get("evil_twin_pair_seat")
        if twin_seat is None:
            continue
        if state.player_at(twin_seat).is_alive:
            return True
    return False


def _check_good_twin_executed(state: GameState) -> WinResult | None:
    """If the good twin is executed, Evil wins."""
    if state.executed_today is None:
        return None

    executed = state.player_at(state.executed_today)
    if executed.hidden_state.get("good_twin_pair_seat") is not None:
        return WinResult(
            alignment=Alignment.EVIL,
            reason="The good twin was executed. Evil wins!",
        )
    return None


def _check_vortox_no_execution(state: GameState) -> WinResult | None:
    """Vortox: if no execution occurred today, Evil wins."""
    # Vortox no-execution condition is evaluated after day ends.
    if state.phase not in (GamePhase.NIGHT, GamePhase.GAME_OVER):
        return None
    if state.day_number <= 0:
        return None
    if state.executed_today is not None:
        return None

    vortox_alive = any(
        p.is_alive and p.role.id == "vortox"
        for p in state.players
    )
    if vortox_alive:
        return WinResult(
            alignment=Alignment.EVIL,
            reason="No execution occurred while Vortox lives. Evil wins!",
        )
    return None


def _check_klutz_chose_evil(state: GameState) -> WinResult | None:
    """Klutz: if the chosen alive player is evil, Good loses immediately."""
    for player in state.players:
        if player.role.id != "klutz" or player.is_alive:
            continue
        if player.hidden_state.get("klutz_chose_evil"):
            return WinResult(
                alignment=Alignment.EVIL,
                reason="The Klutz chose an evil player. Evil wins!",
            )
    return None
