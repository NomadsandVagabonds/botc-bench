"""Game setup: seat assignment, role distribution, and initial state creation."""

from __future__ import annotations

import json
import random
import uuid
from pathlib import Path

from .roles import ScriptData, load_script
from .types import (
    Alignment,
    BreakoutConfig,
    GameConfig,
    GamePhase,
    GameState,
    Player,
    RoleDefinition,
    RoleType,
    ROLE_DISTRIBUTION,
)

# Path to the medieval name bank
_NAMES_PATH = Path(__file__).parent.parent / "scripts" / "data" / "names.json"
_NAME_BANK: list[str] | None = None


def _load_name_bank() -> list[str]:
    """Load the medieval name bank from JSON (cached after first load)."""
    global _NAME_BANK
    if _NAME_BANK is None:
        with open(_NAMES_PATH) as f:
            data = json.load(f)
        _NAME_BANK = data["names"]
    return _NAME_BANK


def create_game(config: GameConfig, agent_ids: list[str]) -> GameState:
    """Create a new game with roles assigned to seats.

    Args:
        config: Game configuration.
        agent_ids: List of agent identifiers, one per player. Length determines
                   player count (must match config.num_players).

    Returns:
        Fully initialized GameState ready for first night.
    """
    num_players = config.num_players
    if len(agent_ids) != num_players:
        raise ValueError(
            f"Expected {num_players} agents, got {len(agent_ids)}"
        )
    if num_players not in ROLE_DISTRIBUTION:
        raise ValueError(
            f"Unsupported player count: {num_players}. "
            f"Supported: {sorted(ROLE_DISTRIBUTION.keys())}"
        )

    # Seed RNG for reproducibility
    seed = config.seed if config.seed is not None else random.randint(0, 2**32 - 1)
    rng = random.Random(seed)

    # Load script
    script = load_script(config.script)

    # Determine role composition — assigned or random
    if config.seat_roles is not None:
        roles = _resolve_assigned_roles(num_players, config.seat_roles, script)
    else:
        roles = _select_roles(num_players, script, rng)
        # Shuffle and assign to seats
        rng.shuffle(roles)

    # Assign character names from the name bank (no repeats within a game)
    name_bank = _load_name_bank()
    character_names = rng.sample(name_bank, num_players)

    # Create players
    players: list[Player] = []
    for seat, (agent_id, role) in enumerate(zip(agent_ids, roles)):
        player = Player(
            seat=seat,
            agent_id=agent_id,
            role=role,
            alignment=role.alignment,
            character_name=character_names[seat],
        )

        # Handle Drunk: they think they're a Townsfolk
        if role.id == "drunk":
            fake_role = _pick_drunk_perceived_role(script, roles, rng)
            player.perceived_role = fake_role
        # Lunatic: they think they're a Demon.
        if role.id == "lunatic":
            fake_demon = _pick_lunatic_perceived_demon(script, roles, rng)
            player.perceived_role = fake_demon

        players.append(player)

    # Generate demon bluffs: 3 good roles not in play
    demon_bluffs = _pick_demon_bluffs(script, roles, rng)

    # Fortune Teller red herring: a good player that registers as Demon
    _assign_fortune_teller_red_herring(players, rng)

    # Evil Twin pairing (Sects & Violets)
    _assign_evil_twin_pair(players, rng)

    state = GameState(
        game_id=uuid.uuid4().hex[:12],
        config=config,
        players=players,
        phase=GamePhase.SETUP,
        demon_bluffs=demon_bluffs,
        rng_seed=seed,
        rng=rng,
    )

    return state


def _select_roles(
    num_players: int,
    script: ScriptData,
    rng: random.Random,
) -> list[RoleDefinition]:
    """Select roles for the game based on player count and distribution rules."""
    n_townsfolk, n_outsiders, n_minions, n_demons = ROLE_DISTRIBUTION[num_players]

    # Check if Baron is available and might be selected
    available_minions = list(script.minions)
    rng.shuffle(available_minions)

    # Pick demons first
    available_demons = list(script.demons)
    rng.shuffle(available_demons)
    selected_demons = available_demons[:n_demons]

    # Pick minions
    selected_minions = available_minions[:n_minions]

    # Check for Baron: if in play, +2 outsiders, -2 townsfolk
    baron_in_play = any(m.id == "baron" for m in selected_minions)
    if baron_in_play:
        n_outsiders += 2
        n_townsfolk -= 2

    # BMR Godfather: +1 outsider, -1 townsfolk.
    godfather_in_play = any(m.id == "godfather" for m in selected_minions)
    if godfather_in_play:
        n_outsiders += 1
        n_townsfolk -= 1

    # S&V setup modifiers from selected Demon.
    demon_ids = {d.id for d in selected_demons}
    if "fang_gu" in demon_ids:
        n_outsiders += 1
        n_townsfolk -= 1
    if "vigormortis" in demon_ids:
        delta = 1 if rng.random() < 0.5 else -1
        n_outsiders += delta
        n_townsfolk -= delta

    # Clamp outsiders floor while preserving total selected good slots.
    if n_outsiders < 0:
        n_townsfolk += n_outsiders  # n_outsiders is negative
        n_outsiders = 0

    # Pick outsiders
    available_outsiders = list(script.outsiders)
    rng.shuffle(available_outsiders)
    selected_outsiders = available_outsiders[:n_outsiders]

    # Pick townsfolk
    available_townsfolk = list(script.townsfolk)
    rng.shuffle(available_townsfolk)
    selected_townsfolk = available_townsfolk[:n_townsfolk]

    roles = selected_townsfolk + selected_outsiders + selected_minions + selected_demons

    if len(roles) != num_players:
        raise RuntimeError(
            f"Role selection produced {len(roles)} roles for {num_players} players"
        )

    return roles


def _resolve_assigned_roles(
    num_players: int,
    seat_roles: list[str],
    script: ScriptData,
) -> list[RoleDefinition]:
    """Resolve pre-assigned role IDs into RoleDefinition objects with validation.

    Validates:
    - Correct number of roles
    - All role IDs exist in the script
    - Exactly 1 demon
    - Correct number of minions for the player count
    - Townsfolk + outsider count matches (accounting for Baron if present)
    """
    if len(seat_roles) != num_players:
        raise ValueError(
            f"seat_roles has {len(seat_roles)} entries, need {num_players}"
        )

    # Look up each role ID in the script
    roles: list[RoleDefinition] = []
    for role_id in seat_roles:
        role_def = script.roles.get(role_id)
        if role_def is None:
            valid_ids = sorted(script.roles.keys())
            raise ValueError(
                f"Unknown role '{role_id}' for script '{script.script_id}'. "
                f"Valid roles: {valid_ids}"
            )
        roles.append(role_def)

    # Count by type
    counts = {rt: 0 for rt in RoleType}
    for role in roles:
        counts[role.role_type] += 1

    # Get base distribution
    if num_players not in ROLE_DISTRIBUTION:
        raise ValueError(
            f"Unsupported player count: {num_players}. "
            f"Supported: {sorted(ROLE_DISTRIBUTION.keys())}"
        )
    base_t, base_o, expected_m, expected_d = ROLE_DISTRIBUTION[num_players]

    # Validate demon count
    if counts[RoleType.DEMON] != expected_d:
        raise ValueError(
            f"Need exactly {expected_d} Demon(s) for {num_players} players, "
            f"got {counts[RoleType.DEMON]}"
        )

    # Validate minion count
    if counts[RoleType.MINION] != expected_m:
        raise ValueError(
            f"Need exactly {expected_m} Minion(s) for {num_players} players, "
            f"got {counts[RoleType.MINION]}"
        )

    # Account for Baron modifier: +2 outsiders, -2 townsfolk
    baron_in_play = any(r.id == "baron" for r in roles)
    expected_t = base_t
    expected_o = base_o
    if baron_in_play:
        expected_o += 2
        expected_t -= 2

    # Validate townsfolk + outsider counts
    actual_good = counts[RoleType.TOWNSFOLK] + counts[RoleType.OUTSIDER]
    expected_good = expected_t + expected_o
    if actual_good != expected_good:
        raise ValueError(
            f"Need {expected_good} good roles ({expected_t}T + {expected_o}O"
            f"{' with Baron' if baron_in_play else ''}) for {num_players} players, "
            f"got {counts[RoleType.TOWNSFOLK]}T + {counts[RoleType.OUTSIDER]}O"
        )

    if counts[RoleType.TOWNSFOLK] != expected_t:
        raise ValueError(
            f"Need {expected_t} Townsfolk and {expected_o} Outsiders "
            f"{'(Baron adds +2 Outsiders, -2 Townsfolk) ' if baron_in_play else ''}"
            f"for {num_players} players, "
            f"got {counts[RoleType.TOWNSFOLK]}T + {counts[RoleType.OUTSIDER]}O"
        )

    # Check for duplicate roles
    role_ids = [r.id for r in roles]
    seen = set()
    for rid in role_ids:
        if rid in seen:
            raise ValueError(f"Duplicate role: '{rid}'. Each role can only appear once.")
        seen.add(rid)

    return roles


def _pick_drunk_perceived_role(
    script: ScriptData,
    assigned_roles: list[RoleDefinition],
    rng: random.Random,
) -> RoleDefinition:
    """Pick a Townsfolk role for the Drunk to think they are.

    Must be a Townsfolk not already in play.
    """
    in_play_ids = {r.id for r in assigned_roles}
    candidates = [r for r in script.townsfolk if r.id not in in_play_ids]
    if not candidates:
        # Fallback: pick any Townsfolk
        candidates = list(script.townsfolk)
    return rng.choice(candidates)


def _pick_lunatic_perceived_demon(
    script: ScriptData,
    assigned_roles: list[RoleDefinition],
    rng: random.Random,
) -> RoleDefinition:
    """Pick a Demon role for the Lunatic to believe they are."""
    in_play_ids = {r.id for r in assigned_roles}
    candidates = [r for r in script.demons if r.id not in in_play_ids]
    if not candidates:
        candidates = list(script.demons)
    return rng.choice(candidates)


def _pick_demon_bluffs(
    script: ScriptData,
    assigned_roles: list[RoleDefinition],
    rng: random.Random,
) -> list[RoleDefinition]:
    """Pick 3 good roles not in play for the Demon to bluff as."""
    in_play_ids = {r.id for r in assigned_roles}
    good_not_in_play = [
        r for r in script.all_roles
        if r.alignment == Alignment.GOOD and r.id not in in_play_ids
    ]
    rng.shuffle(good_not_in_play)
    return good_not_in_play[:3]


def _assign_fortune_teller_red_herring(
    players: list[Player],
    rng: random.Random,
) -> None:
    """Assign a red herring player for the Fortune Teller.

    The red herring is a good player that registers as a Demon to the
    Fortune Teller. Stored in the Fortune Teller's hidden_state.
    """
    fortune_tellers = [p for p in players if p.role.id == "fortune_teller"]
    if not fortune_tellers:
        return

    good_players = [p for p in players if p.alignment == Alignment.GOOD and p.role.id != "fortune_teller"]
    if not good_players:
        return

    red_herring = rng.choice(good_players)
    for ft in fortune_tellers:
        ft.hidden_state["red_herring"] = red_herring.seat


def _assign_evil_twin_pair(players: list[Player], rng: random.Random) -> None:
    """Assign the opposite-alignment 'good twin' for each Evil Twin in play."""
    evil_twins = [p for p in players if p.role.id == "evil_twin"]
    if not evil_twins:
        return

    good_players = [p for p in players if p.alignment == Alignment.GOOD]
    if not good_players:
        return

    for evil_twin in evil_twins:
        candidates = [p for p in good_players if p.seat != evil_twin.seat]
        if not candidates:
            continue
        twin = rng.choice(candidates)
        evil_twin.hidden_state["evil_twin_pair_seat"] = twin.seat
        twin.hidden_state["good_twin_pair_seat"] = evil_twin.seat
