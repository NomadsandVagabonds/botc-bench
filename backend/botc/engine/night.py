"""Night resolution: processes all night abilities in order.

Night actions are CHOSEN simultaneously (parallel LLM calls) but
RESOLVED sequentially in night order. This module handles resolution.
"""

from __future__ import annotations

import inspect

from .abilities import (
    FIRST_NIGHT_ACTION_ABILITIES,
    FIRST_NIGHT_INFO_ABILITIES,
    OTHER_NIGHT_ACTION_ABILITIES,
    OTHER_NIGHT_INFO_ABILITIES,
    _player_label,
    apply_godfather_bonus_kill,
    refresh_script_poisoning,
    resolve_bmr_demon_kill,
    resolve_butler,
    resolve_fortune_teller,
    resolve_generic_demon_kill,
    resolve_imp_kill,
    resolve_ravenkeeper,
)
from .roles import load_script
from .types import (
    GameState,
    MemoryEntry,
    Message,
    NightAction,
    Player,
    RoleType,
)


_DEMON_KILL_ROLES = {
    "imp",
    "fang_gu",
    "vigormortis",
    "no_dashii",
    "vortox",
    "po",
    "pukka",
    "shabaloth",
    "zombuul",
}


def _can_act_at_night(player) -> bool:
    """Whether this player can be processed in night order this turn."""
    if player.is_alive:
        return True
    return (
        player.role.role_type == RoleType.MINION
        and player.hidden_state.get("vigormortis_keeps_ability", False)
    )


def resolve_first_night(
    state: GameState,
    actions: dict[int, NightAction],
) -> None:
    """Resolve all first night abilities in order.

    Args:
        state: Current game state (will be mutated).
        actions: Map of seat -> NightAction for players who chose a target.
    """
    script = load_script(state.config.script)

    for role_id in script.first_night_order:
        refresh_script_poisoning(state)
        players_with_role = [
            p for p in state.players
            if (p.role.id == role_id or
                (p.perceived_role and p.perceived_role.id == role_id and p.is_drunk))
            and _can_act_at_night(p)
        ]

        for player in players_with_role:
            actual_role_id = player.role.id
            action = actions.get(player.seat)

            # Handle action abilities (Poisoner, Fortune Teller, Butler)
            if actual_role_id in FIRST_NIGHT_ACTION_ABILITIES:
                # Poisoner must always resolve (even with no target) to clear old poison
                if action or actual_role_id == "poisoner":
                    effective_action = action or NightAction(
                        actor_seat=player.seat, role_id=actual_role_id, targets=[]
                    )
                    info = _invoke_action_ability(
                        FIRST_NIGHT_ACTION_ABILITIES[actual_role_id],
                        state,
                        player,
                        effective_action,
                    )
                    if info:
                        _deliver_info(state, player, info)
                continue

            # Handle Drunk: they think they have an ability but get wrong info
            effective_role_id = player.effective_role.id if player.is_drunk else actual_role_id

            # Handle info abilities (Washerwoman, Librarian, etc.)
            if effective_role_id in FIRST_NIGHT_INFO_ABILITIES:
                info = FIRST_NIGHT_INFO_ABILITIES[effective_role_id](state, player)
                if info:
                    _deliver_info(state, player, info)

    _reveal_evil_twin_pair(state)

    # Evil team learns each other's identities
    _reveal_evil_team(state)


def _clear_dead_poisoner_poison(state: GameState) -> None:
    """If the Poisoner is dead, clear any lingering poison they applied.

    In official BotC rules, poison ends when the Poisoner dies.
    """
    poisoners = state.players_with_role("poisoner")
    for poisoner in poisoners:
        if not poisoner.is_alive:
            for p in state.players:
                if p.poisoned_by == poisoner.seat:
                    p.is_poisoned = False
                    p.poisoned_by = None


def resolve_night(
    state: GameState,
    actions: dict[int, NightAction],
) -> list[int]:
    """Resolve subsequent night abilities in order.

    Returns list of seats that died this night.
    """
    # Clear poison from dead Poisoners before resolving abilities
    _clear_dead_poisoner_poison(state)

    script = load_script(state.config.script)
    deaths: list[int] = []

    for role_id in script.other_nights_order:
        refresh_script_poisoning(state)
        players_with_role = [
            p for p in state.players
            if (p.role.id == role_id or
                (p.perceived_role and p.perceived_role.id == role_id and p.is_drunk))
            and _can_act_at_night(p)
        ]

        for player in players_with_role:
            actual_role_id = player.role.id
            action = actions.get(player.seat)

            # Demon kill (Imp + S&V demons)
            if actual_role_id in _DEMON_KILL_ROLES and action:
                if actual_role_id == "imp":
                    killed = resolve_imp_kill(state, action)
                elif actual_role_id in {"po", "pukka", "shabaloth", "zombuul"}:
                    killed = resolve_bmr_demon_kill(state, action)
                else:
                    killed = resolve_generic_demon_kill(state, action)
                deaths.extend(killed)

                # Check for Ravenkeeper
                for seat in killed:
                    dead_player = state.player_at(seat)
                    if dead_player.role.id == "ravenkeeper" and dead_player.role.acts_on_death:
                        rk_action = actions.get(seat)
                        if rk_action:
                            info = resolve_ravenkeeper(state, dead_player, rk_action)
                            if info:
                                _deliver_info(state, dead_player, info)
                continue

            # Other action abilities
            if actual_role_id in OTHER_NIGHT_ACTION_ABILITIES:
                # Poisoner must always resolve (even with no target) to clear old poison
                if action or actual_role_id == "poisoner":
                    effective_action = action or NightAction(
                        actor_seat=player.seat, role_id=actual_role_id, targets=[]
                    )
                    info = _invoke_action_ability(
                        OTHER_NIGHT_ACTION_ABILITIES[actual_role_id],
                        state,
                        player,
                        effective_action,
                    )
                    if info:
                        _deliver_info(state, player, info)
                continue

            # Info abilities
            effective_role_id = player.effective_role.id if player.is_drunk else actual_role_id
            if effective_role_id in OTHER_NIGHT_INFO_ABILITIES:
                info = OTHER_NIGHT_INFO_ABILITIES[effective_role_id](state, player)
                if info:
                    _deliver_info(state, player, info)

    # Butler's master choice is a passive constraint, not a game effect on others.
    # If the Butler died earlier this night (e.g. Imp kill), their pre-collected
    # action was skipped by _can_act_at_night().  Apply it now so butler_master
    # is always up-to-date for ghost-vote enforcement the next day.
    # Calling resolve_butler again for an already-processed Butler is harmless
    # (idempotent — just sets butler_master to the same value).
    for player in state.players:
        if player.role.id == "butler" and player.seat in actions:
            resolve_butler(state, player, actions[player.seat])

    # Godfather bonus kill resolves after normal night order.
    bonus_kills = apply_godfather_bonus_kill(state)
    for seat in bonus_kills:
        if seat not in deaths:
            deaths.append(seat)

    state.night_kills = deaths
    return deaths


def _deliver_info(state: GameState, player: Player, info: str) -> None:
    """Deliver night information to a player via private message and memory."""
    msg = Message.private_info(state.phase_id, player.seat, info)
    state.add_message(msg)
    player.private_memory.append(MemoryEntry(
        phase_id=state.phase_id,
        source="ability",
        content=info,
    ))


def _invoke_action_ability(ability, state: GameState, player: Player, action: NightAction):
    """Call ability function with either (state, action) or (state, player, action)."""
    # Newer abilities use (state, player, action); older ones use (state, action).
    param_count = len(inspect.signature(ability).parameters)
    if param_count >= 3:
        return ability(state, player, action)
    return ability(state, action)


def _reveal_evil_twin_pair(state: GameState) -> None:
    """On first night, Evil Twin and their paired good twin learn each other."""
    for evil_twin in state.players:
        if evil_twin.role.id != "evil_twin":
            continue
        twin_seat = evil_twin.hidden_state.get("evil_twin_pair_seat")
        if twin_seat is None:
            continue
        good_twin = state.player_at(twin_seat)
        _deliver_info(
            state,
            evil_twin,
            f"You are the Evil Twin. Your paired good twin is {_player_label(state, good_twin.seat)}.",
        )
        _deliver_info(
            state,
            good_twin,
            f"You are paired with an Evil Twin: {_player_label(state, evil_twin.seat)}. "
            "If you are executed, Evil wins.",
        )


def _reveal_evil_team(state: GameState) -> None:
    """On first night, evil team members learn each other's identities."""
    demon = state.demon()
    if not demon:
        return

    minions = state.minions()
    evil_players = [demon] + minions

    bluff_names = [r.name for r in state.demon_bluffs] if state.demon_bluffs else []
    bluff_text = f" Your demon bluffs (not-in-play good roles): {', '.join(bluff_names)}." if bluff_names else ""

    for evil_player in evil_players:
        teammates = [p for p in evil_players if p.seat != evil_player.seat]
        teammate_info = ", ".join(
            f"{_player_label(state, p.seat)} ({p.role.name})" for p in teammates
        )

        if evil_player.role.role_type.value == "demon":
            info = f"You are the Demon. Your evil teammates: {teammate_info}.{bluff_text}"
        else:
            # Minions do NOT receive demon bluffs — they must ask the Demon
            info = f"You are a Minion. The Demon is {_player_label(state, demon.seat)}. Evil teammates: {teammate_info}."

        _deliver_info(state, evil_player, info)
