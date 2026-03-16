"""Ability implementations for all Trouble Brewing roles.

Each ability function:
- Takes the game state and the acting player
- For night abilities, also takes NightAction with chosen targets
- Returns information to give to the player (as a string) or None
- Mutates state for abilities with side effects (Poisoner, Monk, Imp kill)

Information modification for drunk/poisoned players is handled here
by calling into drunk_poison.py when the player is malfunctioning.

Registration modification for Recluse and Spy is handled by the
registers_as() helper, which info abilities use instead of reading
player.alignment / player.role.role_type directly.
"""

from __future__ import annotations

import random
import re

from .drunk_poison import (
    should_malfunction,
    wrong_fortune_teller,
    wrong_number,
    wrong_player_pair,
    wrong_role,
)
from .types import (
    Alignment,
    GameState,
    MemoryEntry,
    Message,
    NightAction,
    Player,
    RoleType,
)


# ---------------------------------------------------------------------------
# Registration helpers (Recluse / Spy)
# ---------------------------------------------------------------------------

# Probability that the Recluse registers as evil or the Spy registers as good.
_MISREGISTER_CHANCE = 0.40


def _player_label(state: GameState, seat: int) -> str:
    """Return a human-readable player label like 'Katrina [Seat 5]'."""
    p = state.player_at(seat)
    return f"{p.character_name} [Seat {seat}]" if p.character_name else f"Player {seat}"


def registers_as(player: Player, rng: random.Random) -> tuple[Alignment, RoleType]:
    """Return what *alignment* and *role_type* a player registers as.

    Accounts for:
    - **Recluse** (good Outsider) — may register as evil & as a Minion or Demon.
      Only triggers when the Recluse is not drunk/poisoned.
    - **Spy** (evil Minion) — may register as good & as a Townsfolk or Outsider.
      Only triggers when the Spy is not drunk/poisoned.

    Uses the game's seeded RNG so results are reproducible.
    """
    true_alignment = player.alignment
    true_type = player.role.role_type

    # Recluse: might register as evil + Minion/Demon
    if player.role.id == "recluse" and not should_malfunction(player):
        if rng.random() < _MISREGISTER_CHANCE:
            return (
                Alignment.EVIL,
                rng.choice([RoleType.MINION, RoleType.DEMON]),
            )

    # Spy: might register as good + Townsfolk/Outsider
    if player.role.id == "spy" and not should_malfunction(player):
        if rng.random() < _MISREGISTER_CHANCE:
            return (
                Alignment.GOOD,
                rng.choice([RoleType.TOWNSFOLK, RoleType.OUTSIDER]),
            )

    return (true_alignment, true_type)


def _vortox_alive(state: GameState) -> bool:
    """Whether a living, functioning Vortox is currently in play."""
    for p in state.alive_players:
        if p.role.id == "vortox" and not p.is_poisoned:
            return True
    return False


def _info_malfunctions(state: GameState, player: Player) -> bool:
    """Whether an information ability should return false information.

    Includes normal drunk/poison effects plus Vortox's global Townsfolk
    misinformation rule.
    """
    return should_malfunction(player) or (
        _vortox_alive(state) and player.role.role_type == RoleType.TOWNSFOLK
    )


def refresh_script_poisoning(state: GameState) -> None:
    """Recompute script-level poisoning (No Dashii + persistent drunk effects)."""
    for p in state.players:
        # Remove previous dynamic No Dashii marker each recompute.
        p.hidden_state.pop("no_dashii_poisoned", None)

        # Baseline poison/drunk effects from other mechanics.
        base_poisoned = (
            p.poisoned_by is not None
            or p.hidden_state.get("sweetheart_drunk", False)
            or p.hidden_state.get("philosopher_drunk", False)
            or p.hidden_state.get("pukka_poisoned", False)
            or p.hidden_state.get("sailor_drunk_until_day", -1) >= state.day_number
            or p.hidden_state.get("innkeeper_drunk_until_day", -1) >= state.day_number
            or p.hidden_state.get("goon_drunk_until_day", -1) >= state.day_number
            or p.hidden_state.get("courtier_drunk_until_day", -1) >= state.day_number
            or p.hidden_state.get("minstrel_drunk_until_day", -1) >= state.day_number
        )
        p.is_poisoned = bool(base_poisoned)

    # No Dashii: immediate seated neighbors that are Townsfolk are poisoned.
    n = len(state.players)
    if n == 0:
        return

    for demon in state.alive_players:
        if demon.role.id != "no_dashii" or demon.is_poisoned:
            continue

        for offset in (-1, 1):
            neighbour = state.player_at((demon.seat + offset) % n)
            if neighbour.role.role_type == RoleType.TOWNSFOLK:
                neighbour.is_poisoned = True
                neighbour.hidden_state["no_dashii_poisoned"] = True


def on_player_death(state: GameState, player: Player) -> None:
    """Apply role death triggers (Sweetheart, Barber, Klutz)."""
    # Sage: if killed by Demon, learn 1 of 2 players, one of whom is the Demon.
    if (
        player.role.id == "sage"
        and player.death_cause == "demon_kill"
        and not player.hidden_state.get("sage_triggered")
    ):
        player.hidden_state["sage_triggered"] = True
        info = resolve_sage(state, player)
        msg = Message.private_info(state.phase_id, player.seat, info)
        state.add_message(msg)
        player.private_memory.append(MemoryEntry(
            phase_id=state.phase_id,
            source="ability",
            content=info,
        ))

    if player.role.id == "sweetheart" and not player.hidden_state.get("sweetheart_triggered"):
        player.hidden_state["sweetheart_triggered"] = True
        candidates = [p for p in state.alive_players if p.seat != player.seat]
        if candidates:
            target = state.rng.choice(candidates)
            target.hidden_state["sweetheart_drunk"] = True
            target.is_poisoned = True
            state.add_message(Message.system(
                state.phase_id,
                f"The Sweetheart's grief unsettles {_player_label(state, target.seat)}. They become drunk.",
            ))

    if player.role.id == "barber" and not player.hidden_state.get("barber_triggered"):
        player.hidden_state["barber_triggered"] = True
        candidates = [p for p in state.alive_players if p.role.role_type != RoleType.DEMON]
        if len(candidates) >= 2:
            a, b = state.rng.sample(candidates, 2)
            a.role, b.role = b.role, a.role
            a.alignment = a.role.alignment
            b.alignment = b.role.alignment
            state.add_message(Message.system(
                state.phase_id,
                f"The Barber's death causes a sudden swap: {_player_label(state, a.seat)} and {_player_label(state, b.seat)} exchange characters.",
            ))

    if player.role.id == "klutz" and not player.hidden_state.get("klutz_triggered"):
        player.hidden_state["klutz_triggered"] = True
        candidates = [p for p in state.alive_players if p.seat != player.seat]
        if candidates:
            choice = state.rng.choice(candidates)
            player.hidden_state["klutz_choice_seat"] = choice.seat
            player.hidden_state["klutz_chose_evil"] = choice.alignment == Alignment.EVIL
            state.add_message(Message.system(
                state.phase_id,
                f"The Klutz, in final confusion, points at {_player_label(state, choice.seat)}.",
            ))

    if player.role.id == "moonchild" and not player.hidden_state.get("moonchild_triggered"):
        player.hidden_state["moonchild_triggered"] = True
        candidates = [p for p in state.alive_players if p.seat != player.seat]
        if candidates:
            choice = state.rng.choice(candidates)
            player.hidden_state["moonchild_choice_seat"] = choice.seat
            if choice.alignment == Alignment.GOOD:
                choice.is_alive = False
                choice.death_cause = "moonchild_curse"
                choice.death_day = state.day_number
                choice.death_phase = "night"
                on_player_death(state, choice)

    # Grandmother: if Demon kills the grandchild, Grandmother also dies.
    if player.death_cause == "demon_kill":
        for grandma in list(state.alive_players):
            if grandma.role.id != "grandmother":
                continue
            if grandma.hidden_state.get("grandmother_triggered"):
                continue
            if grandma.hidden_state.get("grandmother_target_seat") != player.seat:
                continue

            grandma.hidden_state["grandmother_triggered"] = True
            grandma.is_alive = False
            grandma.death_cause = "grandmother_shock"
            grandma.death_day = state.day_number
            grandma.death_phase = player.death_phase or "night"
            on_player_death(state, grandma)


def _is_tea_lady_protected(state: GameState, target: Player) -> bool:
    """Whether Tea Lady currently protects this player from death."""
    for tea_lady in state.alive_players:
        if tea_lady.role.id != "tea_lady" or tea_lady.is_poisoned:
            continue

        alive_seats = [p.seat for p in state.alive_players]
        if tea_lady.seat not in alive_seats or len(alive_seats) < 3:
            continue

        idx = alive_seats.index(tea_lady.seat)
        left_seat = alive_seats[(idx - 1) % len(alive_seats)]
        right_seat = alive_seats[(idx + 1) % len(alive_seats)]
        left = state.player_at(left_seat)
        right = state.player_at(right_seat)

        if target.seat not in (left_seat, right_seat):
            continue
        if left.alignment == Alignment.GOOD and right.alignment == Alignment.GOOD:
            return True

    return False


def survives_execution(state: GameState, target: Player) -> bool:
    """Whether an executed player survives due to BMR protection effects."""
    # Zombuul survives the first execution.
    if target.role.id == "zombuul" and not target.hidden_state.get("zombuul_first_death_used"):
        target.hidden_state["zombuul_first_death_used"] = True
        return True

    # Devil's Advocate can save a player from execution.
    if (
        target.hidden_state.get("devils_advocate_day") == state.day_number
        and not target.is_poisoned
    ):
        return True

    # Pacifist might save an executed good player.
    if target.alignment == Alignment.GOOD:
        pacifists = [
            p for p in state.alive_players
            if p.role.id == "pacifist" and not p.is_poisoned
        ]
        if pacifists and state.rng.random() < 0.40:
            return True

    # Tea Lady neighbors can't die while protected.
    if _is_tea_lady_protected(state, target):
        return True

    # Sailor can't die while sober.
    if target.role.id == "sailor" and not target.is_poisoned:
        return True

    # Fool survives first death.
    if target.role.id == "fool" and not target.hidden_state.get("fool_survived_once"):
        target.hidden_state["fool_survived_once"] = True
        return True

    return False


# ---------------------------------------------------------------------------
# Night abilities (first night)
# ---------------------------------------------------------------------------

def resolve_poisoner(state: GameState, action: NightAction) -> str | None:
    """Poisoner chooses a player to poison tonight and tomorrow."""
    # Clear previous poison
    for p in state.players:
        if p.poisoned_by == action.actor_seat:
            p.is_poisoned = False
            p.poisoned_by = None

    if action.targets:
        target = state.player_at(action.targets[0])
        target.is_poisoned = True
        target.poisoned_by = action.actor_seat

    return None  # Poisoner gets no info


def _resolve_standard_demon_kill(state: GameState, target_seat: int) -> list[int]:
    """Resolve a standard single-target Demon kill.

    Shared by Imp and S&V demons. Handles Soldier, Monk, and Mayor bounce.
    """
    target = state.player_at(target_seat)

    # Soldier is safe from Demon
    if target.role.id == "soldier" and not target.is_poisoned:
        return []

    # Sailor is safe while sober.
    if target.role.id == "sailor" and not target.is_poisoned:
        return []

    # Tea Lady neighbors may be protected.
    if _is_tea_lady_protected(state, target):
        return []

    # Monk protection
    if target.is_protected:
        return []

    # Mayor: death might bounce
    if target.role.id == "mayor" and not target.is_poisoned:
        # For benchmark consistency, bounce to a random non-Demon alive player
        bounceable = [
            p for p in state.alive_players
            if p.seat != target_seat and p.role.role_type != RoleType.DEMON
        ]
        if bounceable:
            bounce_target = state.rng.choice(bounceable)
            bounce_target.is_alive = False
            bounce_target.death_cause = "demon_kill"
            bounce_target.death_day = state.day_number
            bounce_target.death_phase = "night"
            on_player_death(state, bounce_target)
            return [bounce_target.seat]

    # Fool survives the first death.
    if target.role.id == "fool" and not target.hidden_state.get("fool_survived_once"):
        target.hidden_state["fool_survived_once"] = True
        return []

    # Normal kill
    target.is_alive = False
    target.death_cause = "demon_kill"
    target.death_day = state.day_number
    target.death_phase = "night"
    on_player_death(state, target)
    return [target_seat]


def resolve_washerwoman(state: GameState, player: Player) -> str:
    """Washerwoman learns: 1 of 2 players is a particular Townsfolk."""
    # Use registration to find players who *register* as Townsfolk
    townsfolk_players = [
        p for p in state.players
        if registers_as(p, state.rng)[1] == RoleType.TOWNSFOLK and p.seat != player.seat
    ]

    if not townsfolk_players:
        return "You learn that no Townsfolk are in play."

    target = state.rng.choice(townsfolk_players)
    # Pick a second player who is NOT that Townsfolk
    others = [p for p in state.players if p.seat != target.seat and p.seat != player.seat]
    other = state.rng.choice(others)

    pair_list = [target.seat, other.seat]
    state.rng.shuffle(pair_list)
    pair = (pair_list[0], pair_list[1])
    role_name = target.role.name

    if _info_malfunctions(state, player):
        all_seats = [p.seat for p in state.players if p.seat != player.seat]
        pair = wrong_player_pair(target.seat, other.seat, all_seats, state.rng)
        # Always change the role name so the combo is never accidentally correct
        all_townsfolk_names = [p.role.name for p in state.players if p.role.role_type == RoleType.TOWNSFOLK]
        role_name = wrong_role(role_name, all_townsfolk_names, state.rng)

    return (
        f"You learn that either {_player_label(state, pair[0])} or {_player_label(state, pair[1])} "
        f"is the {role_name}."
    )


def resolve_librarian(state: GameState, player: Player) -> str:
    """Librarian learns: 1 of 2 players is a particular Outsider (or zero)."""
    # Use registration to find players who *register* as Outsider
    outsider_players = [
        p for p in state.players
        if registers_as(p, state.rng)[1] == RoleType.OUTSIDER and p.seat != player.seat
    ]

    if not outsider_players:
        if _info_malfunctions(state, player):
            # Drunk/poisoned might get wrong "there is one" info
            others = [p for p in state.players if p.seat != player.seat]
            fake1, fake2 = state.rng.sample(others, 2)
            from .roles import load_script
            script = load_script(state.config.script)
            fake_outsider = state.rng.choice(script.outsiders)
            return (
                f"You learn that either {_player_label(state, fake1.seat)} or {_player_label(state, fake2.seat)} "
                f"is the {fake_outsider.name}."
            )
        return "You learn that zero Outsiders are in play."

    target = state.rng.choice(outsider_players)
    others = [p for p in state.players if p.seat != target.seat and p.seat != player.seat]
    other = state.rng.choice(others)

    pair_list = [target.seat, other.seat]
    state.rng.shuffle(pair_list)
    pair = (pair_list[0], pair_list[1])
    role_name = target.role.name

    if _info_malfunctions(state, player):
        all_seats = [p.seat for p in state.players if p.seat != player.seat]
        pair = wrong_player_pair(target.seat, other.seat, all_seats, state.rng)

    return (
        f"You learn that either {_player_label(state, pair[0])} or {_player_label(state, pair[1])} "
        f"is the {role_name}."
    )


def resolve_investigator(state: GameState, player: Player) -> str:
    """Investigator learns: 1 of 2 players is a particular Minion."""
    # Use registration to find players who *register* as Minion
    minion_players = [
        p for p in state.players
        if registers_as(p, state.rng)[1] == RoleType.MINION and p.seat != player.seat
    ]

    if not minion_players:
        return "You learn that no Minions are in play."

    target = state.rng.choice(minion_players)
    others = [p for p in state.players if p.seat != target.seat and p.seat != player.seat]
    other = state.rng.choice(others)

    pair_list = [target.seat, other.seat]
    state.rng.shuffle(pair_list)
    pair = (pair_list[0], pair_list[1])
    role_name = target.role.name

    if _info_malfunctions(state, player):
        all_seats = [p.seat for p in state.players if p.seat != player.seat]
        pair = wrong_player_pair(target.seat, other.seat, all_seats, state.rng)

    return (
        f"You learn that either {_player_label(state, pair[0])} or {_player_label(state, pair[1])} "
        f"is the {role_name}."
    )


def resolve_chef(state: GameState, player: Player) -> str:
    """Chef learns how many pairs of evil players sit adjacent."""
    # Use registration to determine who *registers* as evil
    evil_seats = {
        p.seat for p in state.players
        if registers_as(p, state.rng)[0] == Alignment.EVIL
    }
    n = len(state.players)
    pairs = 0
    for seat in evil_seats:
        next_seat = (seat + 1) % n
        if next_seat in evil_seats:
            pairs += 1

    if _info_malfunctions(state, player):
        pairs = wrong_number(pairs, len(evil_seats), state.rng)

    return f"You learn that there {'is' if pairs == 1 else 'are'} {pairs} pair{'s' if pairs != 1 else ''} of evil players sitting adjacent."


def resolve_empath(state: GameState, player: Player) -> str:
    """Empath learns how many of their alive neighbours are evil."""
    alive_seats = [p.seat for p in state.alive_players]
    if player.seat not in alive_seats:
        return "You are dead and receive no information."

    # Find alive neighbours (circular seating)
    idx = alive_seats.index(player.seat)
    n = len(alive_seats)
    left_seat = alive_seats[(idx - 1) % n]
    right_seat = alive_seats[(idx + 1) % n]

    evil_count = 0
    for seat in [left_seat, right_seat]:
        if seat == player.seat:
            continue
        neighbour = state.player_at(seat)
        # Use registration to account for Recluse/Spy
        reg_alignment, _ = registers_as(neighbour, state.rng)
        if reg_alignment == Alignment.EVIL:
            evil_count += 1

    if _info_malfunctions(state, player):
        evil_count = wrong_number(evil_count, 2, state.rng)

    return f"You learn that {evil_count} of your alive neighbours {'is' if evil_count == 1 else 'are'} evil."


def resolve_fortune_teller(
    state: GameState, player: Player, action: NightAction
) -> str:
    """Fortune Teller chooses 2 players: learns if either is the Demon."""
    if len(action.targets) < 2:
        return "You did not choose 2 players."

    seat_a, seat_b = action.targets[0], action.targets[1]
    player_a = state.player_at(seat_a)
    player_b = state.player_at(seat_b)

    red_herring = player.hidden_state.get("red_herring")

    # Use registration to account for Recluse (might register as Demon)
    # and Spy (might register as non-Demon)
    _, type_a = registers_as(player_a, state.rng)
    _, type_b = registers_as(player_b, state.rng)

    is_demon = (
        type_a == RoleType.DEMON
        or type_b == RoleType.DEMON
        or seat_a == red_herring
        or seat_b == red_herring
    )

    if _info_malfunctions(state, player):
        is_demon = wrong_fortune_teller(is_demon, state.rng)

    answer = "Yes" if is_demon else "No"
    return f"You chose {_player_label(state, seat_a)} and {_player_label(state, seat_b)}. {answer}, {'one of them is' if is_demon else 'neither is'} the Demon."


def resolve_butler(state: GameState, player: Player, action: NightAction) -> str:
    """Butler chooses a master: they may only vote when their master votes."""
    if action.targets:
        master_seat = action.targets[0]
        player.butler_master = master_seat
        return f"You chose {_player_label(state, master_seat)} as your master. Tomorrow, you may only vote if they are voting too."
    return "You did not choose a master."


def resolve_spy(state: GameState, player: Player) -> str:
    """Spy sees the Grimoire (all roles and states)."""
    lines = ["You see the Grimoire:"]
    for p in state.players:
        status_parts = []
        if not p.is_alive:
            status_parts.append("DEAD")
        if p.is_poisoned:
            status_parts.append("POISONED")
        status = f" ({', '.join(status_parts)})" if status_parts else ""
        lines.append(f"  Seat {p.seat}: {p.role.name} [{p.alignment.value}]{status}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Night abilities (subsequent nights)
# ---------------------------------------------------------------------------

def resolve_monk(state: GameState, action: NightAction) -> str | None:
    """Monk protects a player from the Demon tonight."""
    actor = state.player_at(action.actor_seat)
    if should_malfunction(actor):
        return None  # Drunk/poisoned Monk's protection doesn't work

    if action.targets:
        target = state.player_at(action.targets[0])
        target.is_protected = True
    return None


def resolve_imp_kill(state: GameState, action: NightAction) -> list[int]:
    """Imp kills a player. Returns list of seats that died.

    Special cases:
    - Self-kill: Imp dies, a Minion becomes the new Imp (starpass)
    - Soldier: immune to Demon kill
    - Monk-protected: immune tonight
    - Mayor: death might bounce to another player
    """
    if not action.targets:
        return []

    target_seat = action.targets[0]
    imp_seat = action.actor_seat
    imp = state.player_at(imp_seat)
    # Self-kill: Imp starpass
    if target_seat == imp_seat:
        return _imp_starpass(state, imp)

    return _resolve_standard_demon_kill(state, target_seat)


def resolve_generic_demon_kill(state: GameState, action: NightAction) -> list[int]:
    """Resolve a non-Imp Demon kill (No Dashii, Vortox, Fang Gu, Vigormortis)."""
    if not action.targets:
        return []
    actor = state.player_at(action.actor_seat)
    if actor.hidden_state.get("exorcised_night") == state.day_number:
        return []
    target = state.player_at(action.targets[0])

    # Fang Gu jump: first Outsider targeted becomes the new evil Fang Gu
    # and the current Fang Gu dies instead.
    if (
        actor.role.id == "fang_gu"
        and target.role.role_type == RoleType.OUTSIDER
        and not actor.hidden_state.get("fang_gu_jumped")
    ):
        # Protection still prevents the jump.
        if target.is_protected:
            return []

        from .roles import load_script
        script = load_script(state.config.script)

        actor.hidden_state["fang_gu_jumped"] = True
        actor.is_alive = False
        actor.death_cause = "demon_kill"
        actor.death_day = state.day_number
        actor.death_phase = "night"
        on_player_death(state, actor)

        target.role = script.roles["fang_gu"]
        target.alignment = Alignment.EVIL
        return [actor.seat]

    killed = _resolve_standard_demon_kill(state, action.targets[0])

    # Vigormortis: a killed Minion keeps their ability while dead.
    if (
        actor.role.id == "vigormortis"
        and action.targets[0] in killed
        and target.role.role_type == RoleType.MINION
    ):
        target.hidden_state["vigormortis_keeps_ability"] = True

    return killed


def _imp_starpass(state: GameState, imp: Player) -> list[int]:
    """Handle Imp self-kill: Imp dies, a living Minion becomes the new Imp."""
    imp.is_alive = False
    imp.death_cause = "demon_kill"
    imp.death_day = state.day_number
    imp.death_phase = "night"
    on_player_death(state, imp)

    alive_minions = [p for p in state.minions() if p.is_alive]
    if alive_minions:
        new_imp = state.rng.choice(alive_minions)
        # The Minion's role becomes Imp
        from .roles import load_script
        script = load_script(state.config.script)
        new_imp.role = script.roles["imp"]
        new_imp.alignment = Alignment.EVIL  # Should already be evil

    return [imp.seat]


def resolve_ravenkeeper(
    state: GameState, player: Player, action: NightAction
) -> str:
    """Ravenkeeper (died tonight) chooses a player to learn their role."""
    if not action.targets:
        return "You did not choose a player."

    target_seat = action.targets[0]
    target = state.player_at(target_seat)
    role_name = target.role.name

    if _info_malfunctions(state, player):
        from .roles import load_script
        script = load_script(state.config.script)
        all_role_names = [r.name for r in script.all_roles]
        role_name = wrong_role(role_name, all_role_names, state.rng)

    return f"You learn that {_player_label(state, target_seat)} is the {role_name}."


def resolve_undertaker(state: GameState, player: Player) -> str | None:
    """Undertaker learns the role of today's executed player."""
    if state.executed_today is None:
        return None

    executed = state.player_at(state.executed_today)
    role_name = executed.role.name

    if _info_malfunctions(state, player):
        from .roles import load_script
        script = load_script(state.config.script)
        all_role_names = [r.name for r in script.all_roles]
        role_name = wrong_role(role_name, all_role_names, state.rng)

    return f"You learn that the executed player ({_player_label(state, state.executed_today)}) was the {role_name}."


# ---------------------------------------------------------------------------
# Bad Moon Rising abilities (initial pass)
# ---------------------------------------------------------------------------

def resolve_grandmother(state: GameState, player: Player) -> str:
    """Grandmother learns a random good player and their role."""
    candidates = [
        p for p in state.players
        if p.seat != player.seat and p.alignment == Alignment.GOOD
    ]
    if not candidates:
        return "You learn no grandchild tonight."

    grandchild = state.rng.choice(candidates)
    player.hidden_state["grandmother_target_seat"] = grandchild.seat
    role_name = grandchild.role.name
    if _info_malfunctions(state, player):
        from .roles import load_script
        script = load_script(state.config.script)
        all_role_names = [r.name for r in script.all_roles]
        role_name = wrong_role(role_name, all_role_names, state.rng)

    return (
        f"You learn that your grandchild is {_player_label(state, grandchild.seat)}, "
        f"the {role_name}."
    )


def resolve_sailor(state: GameState, player: Player, action: NightAction) -> str | None:
    """Sailor chooses an alive player; one of the two is drunk until dusk."""
    if should_malfunction(player):
        return None
    if not action.targets:
        return None

    target = state.player_at(action.targets[0])
    if not target.is_alive or target.seat == player.seat:
        return None

    drunked = state.rng.choice([player, target])
    drunked.hidden_state["sailor_drunk_until_day"] = state.day_number + 1
    return None


def resolve_chambermaid(state: GameState, player: Player, action: NightAction) -> str:
    """Chambermaid learns how many of two players woke due to ability."""
    if len(action.targets) < 2:
        return "You did not choose 2 players."

    from .roles import load_script
    script = load_script(state.config.script)
    wake_count = 0
    for seat in action.targets[:2]:
        if seat < 0 or seat >= len(state.players):
            continue
        chosen = state.player_at(seat)
        role_def = script.roles.get(chosen.role.id)
        if role_def and role_def.other_nights_order is not None and chosen.is_alive:
            wake_count += 1

    if _info_malfunctions(state, player):
        wake_count = wrong_number(wake_count, 2, state.rng)

    return (
        f"You learn that {wake_count} of those players "
        f"{'woke' if wake_count == 1 else 'woke'} tonight due to their ability."
    )


def resolve_exorcist(state: GameState, player: Player, action: NightAction) -> str | None:
    """Exorcist blocks a chosen Demon from acting tonight."""
    if should_malfunction(player):
        return None
    if not action.targets:
        return None

    target = state.player_at(action.targets[0])
    if target.role.role_type == RoleType.DEMON:
        target.hidden_state["exorcised_night"] = state.day_number
    player.hidden_state["exorcist_last_target"] = target.seat
    return None


def resolve_innkeeper(state: GameState, player: Player, action: NightAction) -> str | None:
    """Innkeeper protects two players; one becomes drunk until dusk."""
    if should_malfunction(player):
        return None
    if len(action.targets) < 2:
        return None

    targets = []
    for seat in action.targets[:2]:
        if seat < 0 or seat >= len(state.players):
            continue
        t = state.player_at(seat)
        if t.seat == player.seat:
            continue
        targets.append(t)

    if not targets:
        return None

    for t in targets:
        t.is_protected = True

    drunked = state.rng.choice(targets)
    drunked.hidden_state["innkeeper_drunk_until_day"] = state.day_number + 1
    return None


def resolve_gambler(state: GameState, player: Player, action: NightAction) -> str | None:
    """Gambler dies if their role guess is wrong."""
    if should_malfunction(player):
        return None
    if not action.targets or not action.role_choice:
        return None

    target = state.player_at(action.targets[0])
    guessed = action.role_choice.strip().lower().replace(" ", "_")
    true_role = target.role.id
    if guessed != true_role:
        player.is_alive = False
        player.death_cause = "gambler_wrong_guess"
        player.death_day = state.day_number
        player.death_phase = "night"
        on_player_death(state, player)
    return None


def resolve_courtier(state: GameState, player: Player, action: NightAction) -> str | None:
    """Courtier drunkens a chosen character for 3 days/nights."""
    if player.hidden_state.get("courtier_used"):
        return None
    if should_malfunction(player):
        return None
    if not action.role_choice:
        return None

    from .roles import load_script
    script = load_script(state.config.script)
    chosen = _resolve_role_choice(script, action.role_choice)
    if chosen is None:
        return None

    player.hidden_state["courtier_used"] = True
    for p in state.players:
        if p.role.id == chosen.id:
            p.hidden_state["courtier_drunk_until_day"] = state.day_number + 3
    return None


def resolve_professor(state: GameState, player: Player, action: NightAction) -> str | None:
    """Professor resurrects a dead good player once per game."""
    if player.hidden_state.get("professor_used"):
        return None
    if should_malfunction(player):
        return None
    if not action.targets:
        return None

    target = state.player_at(action.targets[0])
    player.hidden_state["professor_used"] = True
    if target.is_alive or target.alignment != Alignment.GOOD:
        return None

    target.is_alive = True
    target.death_cause = None
    target.death_day = None
    target.death_phase = None
    return None


def resolve_godfather_info(state: GameState, player: Player) -> str:
    """Godfather learns Outsiders in play."""
    outsiders = [p for p in state.players if p.role.role_type == RoleType.OUTSIDER]
    if not outsiders:
        return "You learn that no Outsiders are in play."

    labels = ", ".join(
        f"{_player_label(state, p.seat)} ({p.role.name})" for p in outsiders
    )
    return f"You learn the Outsiders in play: {labels}."


def resolve_godfather(state: GameState, action: NightAction) -> str | None:
    """Godfather picks a potential bonus-kill target."""
    actor = state.player_at(action.actor_seat)
    actor.hidden_state["godfather_target_tonight"] = action.targets[0] if action.targets else None
    return None


def resolve_devils_advocate(state: GameState, action: NightAction) -> str | None:
    """Devil's Advocate protects a player from tomorrow's execution."""
    actor = state.player_at(action.actor_seat)
    if should_malfunction(actor):
        return None
    if not action.targets:
        return None

    target = state.player_at(action.targets[0])
    target.hidden_state["devils_advocate_day"] = state.day_number + 1
    actor.hidden_state["devils_advocate_last_target"] = target.seat
    return None


def resolve_assassin(state: GameState, action: NightAction) -> str | None:
    """Assassin kills once per game at night."""
    actor = state.player_at(action.actor_seat)
    if actor.hidden_state.get("assassin_used"):
        return None
    if should_malfunction(actor):
        return None
    if not action.targets:
        return None

    actor.hidden_state["assassin_used"] = True
    target = state.player_at(action.targets[0])
    if not target.is_alive:
        return None

    target.is_alive = False
    target.death_cause = "assassin"
    target.death_day = state.day_number
    target.death_phase = "night"
    on_player_death(state, target)
    return None


def resolve_po_kill(state: GameState, action: NightAction) -> list[int]:
    """Po can charge by skipping, then kill up to 3 next night."""
    actor = state.player_at(action.actor_seat)
    if actor.hidden_state.get("exorcised_night") == state.day_number:
        return []

    if not action.targets:
        actor.hidden_state["po_charged"] = True
        return []

    max_kills = 3 if actor.hidden_state.pop("po_charged", False) else 1
    deaths: list[int] = []
    for seat in action.targets[:max_kills]:
        if seat in deaths:
            continue
        deaths.extend(_resolve_standard_demon_kill(state, seat))
    return deaths


def resolve_pukka_kill(state: GameState, action: NightAction) -> list[int]:
    """Pukka poisons a new target; previously poisoned target dies."""
    actor = state.player_at(action.actor_seat)
    if actor.hidden_state.get("exorcised_night") == state.day_number:
        return []

    deaths: list[int] = []
    previous = actor.hidden_state.get("pukka_previous_target")
    if previous is not None and 0 <= previous < len(state.players):
        prev_target = state.player_at(previous)
        prev_target.hidden_state.pop("pukka_poisoned", None)
        if prev_target.is_alive:
            deaths.extend(_resolve_standard_demon_kill(state, previous))

    actor.hidden_state["pukka_previous_target"] = None
    if action.targets:
        target = state.player_at(action.targets[0])
        target.hidden_state["pukka_poisoned"] = True
        target.is_poisoned = True
        actor.hidden_state["pukka_previous_target"] = target.seat

    return deaths


def resolve_shabaloth_kill(state: GameState, action: NightAction) -> list[int]:
    """Shabaloth kills two players and might resurrect one from previous kills."""
    actor = state.player_at(action.actor_seat)
    if actor.hidden_state.get("exorcised_night") == state.day_number:
        return []

    previous_kills = actor.hidden_state.get("shabaloth_last_kills", [])
    if previous_kills and state.rng.random() < 0.50:
        resurrectable = [
            state.player_at(seat)
            for seat in previous_kills
            if 0 <= seat < len(state.players) and not state.player_at(seat).is_alive
        ]
        if resurrectable:
            revived = state.rng.choice(resurrectable)
            revived.is_alive = True
            revived.death_cause = None
            revived.death_day = None
            revived.death_phase = None

    deaths: list[int] = []
    for seat in action.targets[:2]:
        if seat in deaths:
            continue
        deaths.extend(_resolve_standard_demon_kill(state, seat))

    actor.hidden_state["shabaloth_last_kills"] = deaths
    return deaths


def resolve_zombuul_kill(state: GameState, action: NightAction) -> list[int]:
    """Zombuul demon kill (simple model)."""
    actor = state.player_at(action.actor_seat)
    if actor.hidden_state.get("exorcised_night") == state.day_number:
        return []
    if state.executed_today is not None:
        return []
    if not action.targets:
        return []
    return _resolve_standard_demon_kill(state, action.targets[0])


def resolve_bmr_demon_kill(state: GameState, action: NightAction) -> list[int]:
    """Dispatch BMR demon kill logic by demon role."""
    actor = state.player_at(action.actor_seat)
    role_id = actor.role.id
    if role_id == "po":
        return resolve_po_kill(state, action)
    if role_id == "pukka":
        return resolve_pukka_kill(state, action)
    if role_id == "shabaloth":
        return resolve_shabaloth_kill(state, action)
    if role_id == "zombuul":
        return resolve_zombuul_kill(state, action)
    return []


def apply_godfather_bonus_kill(state: GameState) -> list[int]:
    """Resolve Godfather bonus kill if an Outsider died by execution today."""
    if state.executed_today is None:
        return []

    executed = state.player_at(state.executed_today)
    if executed.role.role_type != RoleType.OUTSIDER:
        return []

    for godfather in state.alive_players:
        if godfather.role.id != "godfather" or godfather.is_poisoned:
            continue
        target_seat = godfather.hidden_state.pop("godfather_target_tonight", None)
        if target_seat is None or not (0 <= target_seat < len(state.players)):
            continue
        return _resolve_standard_demon_kill(state, target_seat)

    return []


# ---------------------------------------------------------------------------
# Sects & Violets abilities (initial pass)
# ---------------------------------------------------------------------------

def resolve_sage(state: GameState, player: Player) -> str:
    """Sage learns 1 of 2 players, one of whom is the Demon."""
    demons = [p for p in state.players if p.role.role_type == RoleType.DEMON and p.is_alive]
    demon = demons[0] if demons else None
    if demon is None:
        return "You sense nothing. The Demon is already gone."

    others = [p for p in state.players if p.seat not in (player.seat, demon.seat)]
    if not others:
        return f"You learn that {_player_label(state, demon.seat)} is the Demon."

    decoy = state.rng.choice(others)
    pair = [demon.seat, decoy.seat]

    if _info_malfunctions(state, player):
        all_seats = [p.seat for p in state.players if p.seat != player.seat]
        pair = list(wrong_player_pair(demon.seat, decoy.seat, all_seats, state.rng))

    state.rng.shuffle(pair)
    return f"You learn the Demon is either {_player_label(state, pair[0])} or {_player_label(state, pair[1])}."


def resolve_savant(state: GameState, player: Player) -> str:
    """Savant gets two statements each day: one true and one false."""
    alive = len(state.alive_players)
    true_stmt = f"There are {alive} living players."
    false_count = alive + 1 if alive < len(state.players) else max(0, alive - 1)
    false_stmt = f"There are {false_count} living players."
    statements = [true_stmt, false_stmt]
    state.rng.shuffle(statements)

    if _info_malfunctions(state, player):
        # Under malfunction, Savant may receive two false-seeming statements.
        statements = [false_stmt, f"Exactly {max(0, alive - 2)} players are evil."]
        state.rng.shuffle(statements)

    return f"Savant info: 1) {statements[0]} 2) {statements[1]}"


def deliver_savant_info(state: GameState) -> None:
    """Deliver Savant information at the start of each day."""
    for player in state.alive_players:
        if player.role.id != "savant":
            continue
        info = resolve_savant(state, player)
        msg = Message.private_info(state.phase_id, player.seat, info)
        state.add_message(msg)
        player.private_memory.append(MemoryEntry(
            phase_id=state.phase_id,
            source="ability",
            content=info,
        ))


def deliver_juggler_info(state: GameState) -> None:
    """Deliver Juggler correct-guess count (once, on the first eligible night)."""
    for player in state.players:
        if player.role.id != "juggler":
            continue
        if player.hidden_state.get("juggler_info_given"):
            continue
        guesses = player.hidden_state.get("juggler_guesses")
        if not guesses:
            continue

        correct = 0
        for guess in guesses:
            seat = guess.get("seat")
            role_id = guess.get("role_id")
            if seat is None or role_id is None:
                continue
            if 0 <= seat < len(state.players) and state.player_at(seat).role.id == role_id:
                correct += 1

        info = (
            f"You learn that {correct} of your Juggler guess"
            f"{'es were' if correct != 1 else ' was'} correct."
        )
        msg = Message.private_info(state.phase_id, player.seat, info)
        state.add_message(msg)
        player.private_memory.append(MemoryEntry(
            phase_id=state.phase_id,
            source="ability",
            content=info,
        ))
        player.hidden_state["juggler_info_given"] = True


def answer_artist_question(state: GameState, question: str) -> bool:
    """Best-effort yes/no evaluator for Artist questions."""
    q = (question or "").strip().lower()

    # Seat-specific checks
    seat_match = re.search(r"player\s+(\d+)", q)
    seat = int(seat_match.group(1)) if seat_match else None
    target = state.player_at(seat) if seat is not None and 0 <= seat < len(state.players) else None

    if target is not None:
        if "alive" in q:
            return target.is_alive
        if "dead" in q:
            return not target.is_alive
        if "evil" in q and "not evil" not in q:
            return target.alignment == Alignment.EVIL
        if "good" in q:
            return target.alignment == Alignment.GOOD
        if "demon" in q:
            return target.role.role_type == RoleType.DEMON
        if "minion" in q:
            return target.role.role_type == RoleType.MINION
        if "townsfolk" in q:
            return target.role.role_type == RoleType.TOWNSFOLK
        if "outsider" in q:
            return target.role.role_type == RoleType.OUTSIDER

    # Pairwise alignment check
    pair_match = re.search(r"player\s+(\d+).+player\s+(\d+)", q)
    if pair_match and "same alignment" in q:
        a = int(pair_match.group(1))
        b = int(pair_match.group(2))
        if 0 <= a < len(state.players) and 0 <= b < len(state.players):
            return state.player_at(a).alignment == state.player_at(b).alignment

    # Count checks
    if "how many" in q or "at least" in q:
        if "evil" in q and "alive" in q:
            evil_alive = sum(1 for p in state.alive_players if p.alignment == Alignment.EVIL)
            num_match = re.search(r"at least\s+(\d+)", q)
            if num_match:
                return evil_alive >= int(num_match.group(1))
        if "alive" in q:
            alive = len(state.alive_players)
            num_match = re.search(r"at least\s+(\d+)", q)
            if num_match:
                return alive >= int(num_match.group(1))

    # Fallback: return a reproducible random truth value.
    return state.rng.random() < 0.5

def resolve_clockmaker(state: GameState, player: Player) -> str:
    """Clockmaker learns shortest seat-distance between any Demon and Minion."""
    demons = [p for p in state.players if p.role.role_type == RoleType.DEMON]
    minions = [p for p in state.players if p.role.role_type == RoleType.MINION]
    if not demons or not minions:
        return "You learn that the distance is 0."

    n = len(state.players)
    minimum = n
    for demon in demons:
        for minion in minions:
            delta = abs(demon.seat - minion.seat)
            steps = min(delta, n - delta)
            minimum = min(minimum, steps)

    if _info_malfunctions(state, player):
        minimum = wrong_number(minimum, max(1, n // 2), state.rng)

    return f"You learn that the Demon is {minimum} step{'s' if minimum != 1 else ''} from its nearest Minion."


def resolve_dreamer(state: GameState, player: Player, action: NightAction) -> str:
    """Dreamer learns one correct and one opposite-alignment character."""
    if not action.targets:
        return "You did not choose a player."

    target = state.player_at(action.targets[0])
    from .roles import load_script
    script = load_script(state.config.script)

    if target.alignment == Alignment.GOOD:
        opposite_pool = [r.name for r in (script.minions + script.demons)]
    else:
        opposite_pool = [r.name for r in (script.townsfolk + script.outsiders)]

    decoy_name = state.rng.choice(opposite_pool) if opposite_pool else target.role.name
    options = [target.role.name, decoy_name]

    if _info_malfunctions(state, player):
        all_names = [r.name for r in script.all_roles]
        options = [
            wrong_role(options[0], all_names, state.rng),
            wrong_role(options[1], all_names, state.rng),
        ]

    state.rng.shuffle(options)
    return (
        f"You learn that {_player_label(state, target.seat)} is either the {options[0]} or the {options[1]}."
    )


def resolve_snake_charmer(state: GameState, player: Player, action: NightAction) -> str:
    """Snake Charmer swaps role+alignment with a chosen Demon."""
    if not action.targets:
        return "You did not choose a player."

    target = state.player_at(action.targets[0])
    if target.seat == player.seat:
        return "You cannot choose yourself."

    if should_malfunction(player):
        return f"You chose {_player_label(state, target.seat)}. Nothing happened."

    if target.role.role_type != RoleType.DEMON:
        return f"You chose {_player_label(state, target.seat)}. They are not the Demon."

    player_role, player_alignment = player.role, player.alignment
    target_role, target_alignment = target.role, target.alignment
    player.role, player.alignment = target_role, target_alignment
    target.role, target.alignment = player_role, player_alignment
    return (
        f"You chose {_player_label(state, target.seat)}. You have swapped roles and alignments."
    )


def resolve_mathematician(state: GameState, player: Player) -> str:
    """Approximate Mathematician signal using currently drunk/poisoned players."""
    abnormal = sum(
        1 for p in state.players
        if p.seat != player.seat and (p.is_poisoned or p.is_drunk)
    )
    if _info_malfunctions(state, player):
        abnormal = wrong_number(abnormal, len(state.players) - 1, state.rng)
    return (
        "You learn that "
        f"{abnormal} player{'s' if abnormal != 1 else ''} had abilities behave abnormally."
    )


def resolve_flowergirl(state: GameState, player: Player) -> str:
    """Flowergirl learns whether any Demon voted during the current day."""
    demon_seats = {
        p.seat for p in state.players if p.role.role_type == RoleType.DEMON
    }
    demon_voted = any(
        seat in demon_seats
        for nomination in state.nominations
        for seat in (nomination.votes_for + nomination.votes_against)
    )

    if _info_malfunctions(state, player):
        demon_voted = wrong_fortune_teller(demon_voted, state.rng)

    return (
        "You learn that a Demon "
        f"{'did' if demon_voted else 'did not'} vote today."
    )


def resolve_town_crier(state: GameState, player: Player) -> str:
    """Town Crier learns whether any Minion nominated during the current day."""
    minion_seats = {
        p.seat for p in state.players if p.role.role_type == RoleType.MINION
    }
    minion_nominated = any(
        nomination.nominator_seat in minion_seats
        for nomination in state.nominations
    )

    if _info_malfunctions(state, player):
        minion_nominated = wrong_fortune_teller(minion_nominated, state.rng)

    return (
        "You learn that a Minion "
        f"{'did' if minion_nominated else 'did not'} nominate today."
    )


def resolve_oracle(state: GameState, player: Player) -> str:
    """Oracle learns number of dead evil players."""
    evil_dead = sum(1 for p in state.dead_players if p.alignment == Alignment.EVIL)
    if _info_malfunctions(state, player):
        evil_dead = wrong_number(evil_dead, len(state.dead_players), state.rng)
    return (
        f"You learn that {evil_dead} dead player{'s are' if evil_dead != 1 else ' is'} evil."
    )


def resolve_seamstress(state: GameState, player: Player, action: NightAction) -> str:
    """Seamstress once-per-game alignment check on two players."""
    if player.hidden_state.get("seamstress_used"):
        return "You have already used your Seamstress ability."
    if len(action.targets) < 2:
        return "You did not choose 2 players."
    if player.seat in action.targets[:2]:
        return "You cannot choose yourself."

    player.hidden_state["seamstress_used"] = True
    first = state.player_at(action.targets[0])
    second = state.player_at(action.targets[1])
    same_alignment = first.alignment == second.alignment

    if _info_malfunctions(state, player):
        same_alignment = wrong_fortune_teller(same_alignment, state.rng)

    return (
        f"You learn that {_player_label(state, first.seat)} and {_player_label(state, second.seat)} "
        f"{'are' if same_alignment else 'are not'} the same alignment."
    )


def resolve_philosopher(state: GameState, player: Player, action: NightAction) -> str:
    """Philosopher gains a chosen good character's ability."""
    if player.hidden_state.get("philosopher_used"):
        return "You have already used your Philosopher ability."

    from .roles import load_script
    script = load_script(state.config.script)

    chosen_role = None
    if action.role_choice:
        chosen_role = _resolve_role_choice(script, action.role_choice)
        if chosen_role is None:
            return "You did not choose a valid character."
    elif action.targets:
        target = state.player_at(action.targets[0])
        chosen_role = target.role
    else:
        return "You did not choose a character."

    if chosen_role.alignment != Alignment.GOOD:
        return "You can only choose a good character."
    if chosen_role.id == "philosopher":
        return "You cannot choose Philosopher."

    player.hidden_state["philosopher_used"] = True
    player.role = chosen_role

    # If that character is in play, one such player becomes drunk.
    in_play = [p for p in state.players if p.seat != player.seat and p.role.id == chosen_role.id]
    if in_play:
        target = state.rng.choice(in_play)
        target.hidden_state["philosopher_drunk"] = True
        target.is_poisoned = True

    return f"You gain the ability of {player.role.name}."


def resolve_cerenovus(state: GameState, player: Player, action: NightAction) -> str | None:
    """Cerenovus marks a player mad as a chosen good character for next day."""
    if should_malfunction(player):
        return None
    if not action.targets:
        return None

    target = state.player_at(action.targets[0])
    from .roles import load_script
    script = load_script(state.config.script)
    good_roles = [r for r in (script.townsfolk + script.outsiders) if r.id != "drunk"]
    if not good_roles:
        return None

    mad_role = None
    if action.role_choice:
        mad_role = _resolve_role_choice(script, action.role_choice)
        if mad_role is None or mad_role.alignment != Alignment.GOOD or mad_role.id == "drunk":
            return None
    else:
        mad_role = state.rng.choice(good_roles)

    target.hidden_state["cerenovus_mad_role"] = mad_role.name.lower()
    target.hidden_state["cerenovus_mad_role_id"] = mad_role.id
    target.hidden_state["cerenovus_day"] = state.day_number + 1
    return None


def resolve_pit_hag(state: GameState, player: Player, action: NightAction) -> str | None:
    """Pit-Hag changes a player's character."""
    if should_malfunction(player):
        return None
    if not action.targets:
        return None

    target = state.player_at(action.targets[0])
    from .roles import load_script
    script = load_script(state.config.script)

    in_play_ids = {p.role.id for p in state.players}
    candidates = [
        r for r in script.all_roles
        if r.id not in in_play_ids and r.id != target.role.id
    ]
    if not candidates:
        candidates = [r for r in script.all_roles if r.id != target.role.id]
    if not candidates:
        return None

    was_demon = target.role.role_type == RoleType.DEMON
    new_role = None
    if action.role_choice:
        selected = _resolve_role_choice(script, action.role_choice)
        if selected and selected.id != target.role.id and selected.id not in in_play_ids:
            new_role = selected
    if new_role is None:
        new_role = state.rng.choice(candidates)
    target.role = new_role
    target.alignment = new_role.alignment

    if new_role.role_type == RoleType.DEMON and not was_demon:
        player.hidden_state["pit_hag_created_demon_tonight"] = True
    return None


def _resolve_role_choice(script, raw_choice: str):
    """Map a role id/name string to a RoleDefinition in the current script."""
    choice = (raw_choice or "").strip().lower()
    if not choice:
        return None
    normalized = choice.replace(" ", "_")
    if normalized in script.roles:
        return script.roles[normalized]
    for role in script.all_roles:
        if role.name.lower() == choice:
            return role
    return None


def resolve_witch(state: GameState, action: NightAction) -> str | None:
    """Witch curses one player; if they nominate tomorrow, they die."""
    witch = state.player_at(action.actor_seat)
    if should_malfunction(witch):
        return None

    # Clear this witch's previous curse before applying a new one.
    for p in state.players:
        if p.hidden_state.get("witch_cursed_by") == action.actor_seat:
            p.hidden_state.pop("witch_cursed_by", None)
            p.hidden_state.pop("witch_cursed", None)
            p.hidden_state.pop("witch_cursed_day", None)

    if action.targets:
        target = state.player_at(action.targets[0])
        target.hidden_state["witch_cursed"] = True
        target.hidden_state["witch_cursed_by"] = action.actor_seat
        target.hidden_state["witch_cursed_day"] = state.day_number + 1

    return None


# ---------------------------------------------------------------------------
# Day abilities
# ---------------------------------------------------------------------------

def resolve_virgin_nomination(
    state: GameState, virgin: Player, nominator: Player
) -> bool:
    """Virgin ability: if a Townsfolk nominates the Virgin, the nominator dies.

    Returns True if the nominator was executed.
    """
    if virgin.hidden_state.get("virgin_used"):
        return False

    virgin.hidden_state["virgin_used"] = True

    if should_malfunction(virgin):
        return False

    if nominator.role.role_type == RoleType.TOWNSFOLK:
        nominator.is_alive = False
        nominator.death_cause = "executed"
        nominator.death_day = state.day_number
        nominator.death_phase = "day"
        on_player_death(state, nominator)
        return True

    return False


def resolve_slayer_shot(state: GameState, slayer: Player, target: Player) -> bool:
    """Slayer publicly chooses a player: if they're the Demon, they die.

    Returns True if the target died.
    """
    if slayer.hidden_state.get("slayer_used"):
        return False

    slayer.hidden_state["slayer_used"] = True

    if should_malfunction(slayer):
        return False

    if target.role.role_type == RoleType.DEMON:
        if target.role.id == "zombuul" and not target.hidden_state.get("zombuul_first_death_used"):
            target.hidden_state["zombuul_first_death_used"] = True
            return False
        target.is_alive = False
        target.death_cause = "slayer_shot"
        target.death_day = state.day_number
        target.death_phase = "day"
        on_player_death(state, target)
        return True

    return False


# ---------------------------------------------------------------------------
# Scarlet Woman
# ---------------------------------------------------------------------------

def check_scarlet_woman(state: GameState) -> None:
    """If the Demon dies with 5+ alive players, Scarlet Woman becomes Demon."""
    demon = state.demon()
    if demon is not None and demon.is_alive:
        return

    if len(state.alive_players) < 5:
        return

    scarlet_women = [
        p for p in state.players
        if p.role.id == "scarlet_woman" and p.is_alive
    ]
    if not scarlet_women:
        return

    sw = scarlet_women[0]
    from .roles import load_script
    script = load_script(state.config.script)
    sw.role = script.roles["imp"]
    # Alignment stays evil


# ---------------------------------------------------------------------------
# Ability dispatch
# ---------------------------------------------------------------------------

FIRST_NIGHT_INFO_ABILITIES: dict[str, callable] = {
    "washerwoman": resolve_washerwoman,
    "librarian": resolve_librarian,
    "investigator": resolve_investigator,
    "chef": resolve_chef,
    "empath": resolve_empath,
    "spy": resolve_spy,
    "grandmother": resolve_grandmother,
    "godfather": resolve_godfather_info,
    "clockmaker": resolve_clockmaker,
    "mathematician": resolve_mathematician,
    "flowergirl": resolve_flowergirl,
    "town_crier": resolve_town_crier,
    "oracle": resolve_oracle,
}

FIRST_NIGHT_ACTION_ABILITIES: dict[str, callable] = {
    "poisoner": resolve_poisoner,
    "fortune_teller": resolve_fortune_teller,
    "butler": resolve_butler,
    "dreamer": resolve_dreamer,
    "snake_charmer": resolve_snake_charmer,
    "seamstress": resolve_seamstress,
    "philosopher": resolve_philosopher,
    "sailor": resolve_sailor,
    "chambermaid": resolve_chambermaid,
    "exorcist": resolve_exorcist,
    "innkeeper": resolve_innkeeper,
    "gambler": resolve_gambler,
    "courtier": resolve_courtier,
    "professor": resolve_professor,
    "godfather": resolve_godfather,
    "devils_advocate": resolve_devils_advocate,
    "assassin": resolve_assassin,
    "witch": resolve_witch,
    "cerenovus": resolve_cerenovus,
    "pit_hag": resolve_pit_hag,
}

OTHER_NIGHT_INFO_ABILITIES: dict[str, callable] = {
    "empath": resolve_empath,
    "undertaker": resolve_undertaker,
    "spy": resolve_spy,
    "mathematician": resolve_mathematician,
    "flowergirl": resolve_flowergirl,
    "town_crier": resolve_town_crier,
    "oracle": resolve_oracle,
}

OTHER_NIGHT_ACTION_ABILITIES: dict[str, callable] = {
    "poisoner": resolve_poisoner,
    "monk": resolve_monk,
    "fortune_teller": resolve_fortune_teller,
    "butler": resolve_butler,
    "dreamer": resolve_dreamer,
    "snake_charmer": resolve_snake_charmer,
    "seamstress": resolve_seamstress,
    "philosopher": resolve_philosopher,
    "sailor": resolve_sailor,
    "chambermaid": resolve_chambermaid,
    "exorcist": resolve_exorcist,
    "innkeeper": resolve_innkeeper,
    "gambler": resolve_gambler,
    "courtier": resolve_courtier,
    "professor": resolve_professor,
    "godfather": resolve_godfather,
    "devils_advocate": resolve_devils_advocate,
    "assassin": resolve_assassin,
    "witch": resolve_witch,
    "cerenovus": resolve_cerenovus,
    "pit_hag": resolve_pit_hag,
}
