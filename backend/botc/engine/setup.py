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

# Path to the medieval name bank (fallback)
_NAMES_PATH = Path(__file__).parent.parent / "scripts" / "data" / "names.json"
_NAME_BANK: list[str] | None = None

# Character table: sprite_id -> (name, gender)
_CHARACTERS_PATH = Path(__file__).parent.parent / "scripts" / "data" / "characters.json"
_CHARACTER_TABLE: dict[int, dict] | None = None

# Sprite IDs — must match frontend TownMap.tsx SPRITE_IDS exactly
_SPRITE_IDS = [
    1160, 1161, 1162, 1163, 1164,
    2045, 2046, 2047, 2048, 2049,
    3312, 3313, 3314, 3315,
    4501, 4502, 4503, 4504,
    5678, 5679, 5680, 5681,
    6234, 6235, 6236,
    7890, 7891, 7892,
    8456, 8457, 8458,
    9123, 9124, 9125,
    10567, 10568, 10569,
    11234, 11235, 11236,
    12890, 12891, 12892,
    13456, 13457,
    14012, 14013,
    15678, 15679,
    16234, 16235,
    17681, 17682, 17683, 17684, 17685,
    17890, 17891,
    18456, 18457,
    19123, 19124,
    20567, 20568,
    21000, 22000, 23000, 24000, 25000, 26000, 27000, 28000, 29000,
]


def _load_name_bank() -> list[str]:
    """Load the medieval name bank from JSON (cached after first load)."""
    global _NAME_BANK
    if _NAME_BANK is None:
        with open(_NAMES_PATH) as f:
            data = json.load(f)
        _NAME_BANK = data["names"]
    return _NAME_BANK


def _load_character_table() -> dict[int, dict]:
    """Load the character table mapping sprite_id -> {name, gender}."""
    global _CHARACTER_TABLE
    if _CHARACTER_TABLE is None:
        with open(_CHARACTERS_PATH) as f:
            data = json.load(f)
        _CHARACTER_TABLE = {c["sprite_id"]: c for c in data["characters"]}
    return _CHARACTER_TABLE


def _pick_sprite_ids(game_id: str, count: int) -> list[int]:
    """Pick N unique sprite IDs using a game-specific seed.

    Must match frontend pickSpriteIds() exactly for sprite-name consistency.
    Uses the same djb2 hash + mulberry32 PRNG as the frontend.
    """
    # djb2 hash (matches frontend's signed 32-bit behavior)
    hash_val = 0
    for ch in game_id:
        hash_val = ((hash_val << 5) - hash_val + ord(ch)) & 0xFFFFFFFF
    # Convert to signed 32-bit like JavaScript's |0
    if hash_val >= 0x80000000:
        hash_val -= 0x100000000

    # mulberry32 PRNG (matches frontend seededRandom exactly)
    # All operations must emulate JavaScript's 32-bit signed integer behavior
    t = [hash_val & 0xFFFFFFFF]  # mutable container for closure

    def _to_signed32(x: int) -> int:
        x &= 0xFFFFFFFF
        return x - 0x100000000 if x >= 0x80000000 else x

    def _unsigned_rshift(x: int, n: int) -> int:
        """JavaScript's >>> operator (unsigned right shift)."""
        return (x & 0xFFFFFFFF) >> n

    def rng_next() -> float:
        t[0] = _to_signed32(t[0] + 0x6D2B79F5)
        r = _imul(t[0] ^ _unsigned_rshift(t[0], 15), 1 | t[0])
        r = _to_signed32(r + _imul(r ^ _unsigned_rshift(r, 7), 61 | r)) ^ r
        return _unsigned_rshift(r ^ _unsigned_rshift(r, 14), 0) / 4294967296

    # Fisher-Yates shuffle and pick (matches frontend)
    pool = list(_SPRITE_IDS)
    for i in range(len(pool) - 1, 0, -1):
        j = int(rng_next() * (i + 1))
        pool[i], pool[j] = pool[j], pool[i]
    return pool[:count]


def _imul(a: int, b: int) -> int:
    """Emulate JavaScript's Math.imul (32-bit integer multiplication)."""
    a &= 0xFFFFFFFF
    b &= 0xFFFFFFFF
    result = (a * b) & 0xFFFFFFFF
    if result >= 0x80000000:
        result -= 0x100000000
    return result


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

    # Generate game ID now so we can use it for sprite selection
    game_id = uuid.uuid4().hex[:12]

    # Assign character names from sprite-linked character table
    # The sprite selection must match the frontend's pickSpriteIds() exactly
    char_table = _load_character_table()
    sprite_ids = _pick_sprite_ids(game_id, num_players)
    character_names: list[str] = []
    for seat in range(num_players):
        sid = sprite_ids[seat % len(sprite_ids)]
        char = char_table.get(sid)
        if char:
            character_names.append(char["name"])
        else:
            # Fallback to random name bank if sprite not in character table
            name_bank = _load_name_bank()
            character_names.append(rng.choice(name_bank))

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

    # Generate demon bluffs: 3 good roles not in play (and not the Drunk's perceived role,
    # since the Drunk will claim that role and it would create an immediate conflict)
    drunk_perceived_ids = {
        p.perceived_role.id for p in players
        if p.role.id == "drunk" and p.perceived_role
    }
    demon_bluffs = _pick_demon_bluffs(script, roles, rng, exclude_ids=drunk_perceived_ids)

    # Fortune Teller red herring: a good player that registers as Demon
    _assign_fortune_teller_red_herring(players, rng)

    # Evil Twin pairing (Sects & Violets)
    _assign_evil_twin_pair(players, rng)

    state = GameState(
        game_id=game_id,
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
    exclude_ids: set[str] | None = None,
) -> list[RoleDefinition]:
    """Pick 3 good roles not in play for the Demon to bluff as.

    Also excludes any IDs in *exclude_ids* (e.g. the Drunk's perceived role)
    to avoid giving the Demon a bluff that conflicts with another player's claim.
    """
    in_play_ids = {r.id for r in assigned_roles}
    excluded = in_play_ids | (exclude_ids or set())
    good_not_in_play = [
        r for r in script.all_roles
        if r.alignment == Alignment.GOOD and r.id not in excluded
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
