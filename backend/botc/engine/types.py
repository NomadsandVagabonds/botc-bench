"""Core types for the Blood on the Clocktower game engine."""

from __future__ import annotations

import random
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Alignment(str, Enum):
    GOOD = "good"
    EVIL = "evil"


class RoleType(str, Enum):
    TOWNSFOLK = "townsfolk"
    OUTSIDER = "outsider"
    MINION = "minion"
    DEMON = "demon"


class GamePhase(str, Enum):
    SETUP = "setup"
    FIRST_NIGHT = "first_night"
    DAY_DISCUSSION = "day_discussion"
    DAY_BREAKOUT = "day_breakout"
    DAY_REGROUP = "day_regroup"
    NOMINATIONS = "nominations"
    VOTING = "voting"
    EXECUTION = "execution"
    NIGHT = "night"
    GAME_OVER = "game_over"
    DEBRIEF = "debrief"


class MessageType(str, Enum):
    PUBLIC_SPEECH = "public_speech"
    GROUP_SPEECH = "group_speech"
    WHISPER = "whisper"
    WHISPER_NOTIFICATION = "whisper_notification"
    NOMINATION = "nomination"
    VOTE = "vote"
    SYSTEM = "system"
    NARRATION = "narration"
    PRIVATE_INFO = "private_info"
    THINK = "think"
    ACCUSATION = "accusation"
    DEFENSE = "defense"


class ActionType(str, Enum):
    NIGHT_TARGET = "night_target"
    NIGHT_TARGET_TWO = "night_target_two"  # Fortune Teller picks 2
    NIGHT_TARGET_THREE = "night_target_three"
    ASK = "ask"
    JUGGLE = "juggle"
    NOMINATE = "nominate"
    VOTE = "vote"
    JOIN_GROUP = "join_group"
    SPEAK = "speak"
    WHISPER = "whisper_action"
    SLAYER_SHOT = "slayer_shot"
    PASS = "pass"


# ---------------------------------------------------------------------------
# Role definition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RoleDefinition:
    id: str
    name: str
    role_type: RoleType
    alignment: Alignment
    ability_text: str
    first_night_order: int | None = None  # None = doesn't wake
    other_nights_order: int | None = None
    setup_modifies: bool = False  # Baron adds outsiders, etc.
    acts_on_death: bool = False  # Ravenkeeper wakes when killed


# ---------------------------------------------------------------------------
# Messages and communication
# ---------------------------------------------------------------------------

@dataclass
class MemoryEntry:
    phase_id: str
    source: str  # "ability", "conversation", "observation", "deduction"
    content: str
    timestamp: float = field(default_factory=time.time)


@dataclass
class Message:
    id: str
    type: MessageType
    phase_id: str
    sender_seat: int | None  # None for system messages
    content: str
    visible_to: set[int] | None = None  # None = public
    group_id: str | None = None
    timestamp: float = field(default_factory=time.time)

    @staticmethod
    def system(phase_id: str, content: str) -> Message:
        return Message(
            id=uuid.uuid4().hex,
            type=MessageType.SYSTEM,
            phase_id=phase_id,
            sender_seat=None,
            content=content,
        )

    @staticmethod
    def private_info(phase_id: str, seat: int, content: str) -> Message:
        return Message(
            id=uuid.uuid4().hex,
            type=MessageType.PRIVATE_INFO,
            phase_id=phase_id,
            sender_seat=None,
            content=content,
            visible_to={seat},
        )


# ---------------------------------------------------------------------------
# Breakout groups and whispers
# ---------------------------------------------------------------------------

@dataclass
class BreakoutGroup:
    id: str
    round_number: int
    members: list[int] = field(default_factory=list)
    messages: list[Message] = field(default_factory=list)
    join_timestamps: dict[int, float] = field(default_factory=dict)

    def add_member(self, seat: int) -> None:
        if seat not in self.members:
            self.members.append(seat)
            self.join_timestamps[seat] = time.time()


@dataclass
class WhisperRecord:
    sender_seat: int
    receiver_seat: int
    content: str
    phase_id: str
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Nominations and voting
# ---------------------------------------------------------------------------

@dataclass
class NominationRecord:
    nominator_seat: int
    nominee_seat: int
    votes_for: list[int] = field(default_factory=list)
    votes_against: list[int] = field(default_factory=list)
    passed: bool = False
    # Outcome after comparing to threshold & current block holder:
    #   "on_the_block" — this nominee is currently the execution candidate
    #   "replaced"     — this nominee replaced the previous block holder
    #   "tied"         — vote count tied with block holder; both freed
    #   "failed"       — below threshold or below current block holder
    #   None           — not yet resolved
    outcome: str | None = None


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------

@dataclass
class Player:
    seat: int
    agent_id: str
    role: RoleDefinition
    alignment: Alignment
    character_name: str = ""
    model_name: str = ""  # LLM model identifier (real)
    display_model_name: str = ""  # Shown to other agents — real, scrambled, or empty based on reveal_models
    is_alive: bool = True
    is_poisoned: bool = False
    poisoned_by: int | None = None
    is_protected: bool = False  # Monk protection this night
    ghost_vote_used: bool = False
    has_nominated_today: bool = False
    was_nominated_today: bool = False

    # Death metadata
    death_cause: str | None = None   # "executed", "demon_kill", "slayer_shot"
    death_day: int | None = None     # Day/night number when death occurred
    death_phase: str | None = None   # "day" or "night"

    # Drunk sees a different role
    perceived_role: RoleDefinition | None = None

    # Flexible hidden state for special mechanics
    hidden_state: dict = field(default_factory=dict)

    # What this player has learned
    private_memory: list[MemoryEntry] = field(default_factory=list)

    # Butler's master (seat number)
    butler_master: int | None = None

    @property
    def effective_role(self) -> RoleDefinition:
        """The role this player believes they are."""
        return self.perceived_role if self.perceived_role else self.role

    @property
    def is_drunk(self) -> bool:
        return self.role.id == "drunk"

    @property
    def gets_true_info(self) -> bool:
        """Whether this player receives accurate information from abilities."""
        return not self.is_poisoned and not self.is_drunk


# ---------------------------------------------------------------------------
# Phase transitions
# ---------------------------------------------------------------------------

@dataclass
class PhaseTransition:
    from_phase: GamePhase
    to_phase: GamePhase
    day_number: int
    timestamp: float = field(default_factory=time.time)


# ---------------------------------------------------------------------------
# Night actions
# ---------------------------------------------------------------------------

@dataclass
class NightAction:
    actor_seat: int
    role_id: str
    targets: list[int]  # Seat numbers targeted
    role_choice: str | None = None  # Optional character id/name target (S&V roles)


# ---------------------------------------------------------------------------
# Game configuration
# ---------------------------------------------------------------------------

@dataclass
class BreakoutConfig:
    num_rounds: int = 2
    messages_per_agent: int = 2
    max_groups: int = 4
    min_group_size: int = 2
    whispers_per_round: int = 1
    max_whisper_chars: int = 200


@dataclass
class GameConfig:
    script: str = "trouble_brewing"
    num_players: int = 10
    breakout: BreakoutConfig = field(default_factory=BreakoutConfig)
    opening_statements: bool = True
    regroup_messages: int = 1
    seed: int | None = None
    narrator_enabled: bool = False
    max_concurrent_llm_calls: int = 8
    speed_multiplier: float = 1.0
    log_think_tags: bool = True
    output_dir: str = "./games"
    max_days: int = 20  # Safety cap
    reveal_models: str = "true"  # "true" = show real models, "false" = hide, "scramble" = show randomized fake models
    share_stats: bool = False  # When True (and reveal_models=True), inject historical model stats into prompts
    seat_roles: list[str] | None = None  # Pre-assigned role IDs per seat (None = random)
    speech_style: str | None = None  # Optional speech style directive injected into agent prompts
    phase_max_tokens: dict[str, int] = field(default_factory=lambda: {
        "discussion": 4096,
        "breakout": 4096,
        "regroup": 2048,
        "nomination": 2048,
        "vote": 512,
        "night": 2048,
        "whisper": 768,
        "default": 4096,
    })


# ---------------------------------------------------------------------------
# Game state
# ---------------------------------------------------------------------------

@dataclass
class GameState:
    game_id: str
    config: GameConfig
    players: list[Player]
    phase: GamePhase = GamePhase.SETUP
    day_number: int = 0

    # Message log (complete, unfiltered)
    all_messages: list[Message] = field(default_factory=list)

    # Day state
    breakout_groups: list[BreakoutGroup] = field(default_factory=list)
    breakout_round: int = 0
    whispers: list[WhisperRecord] = field(default_factory=list)
    nominations: list[NominationRecord] = field(default_factory=list)
    executed_today: int | None = None
    on_the_block: tuple[int, int] | None = None  # (seat, vote_count) or None

    # Night state
    night_kills: list[int] = field(default_factory=list)
    night_actions: list[NightAction] = field(default_factory=list)

    # Demon bluffs (3 not-in-play roles shown to evil team)
    demon_bluffs: list[RoleDefinition] = field(default_factory=list)

    # Outcome
    winner: Alignment | None = None
    win_condition: str | None = None

    # Reproducibility
    rng_seed: int = 0
    rng: random.Random = field(default_factory=random.Random)

    # History
    turn_history: list[PhaseTransition] = field(default_factory=list)

    @property
    def phase_id(self) -> str:
        """Human-readable ID for the current phase, e.g. 'night_1', 'day_2_breakout_1'."""
        if self.phase == GamePhase.FIRST_NIGHT:
            return "night_0"
        if self.phase == GamePhase.NIGHT:
            return f"night_{self.day_number}"
        if self.phase == GamePhase.DAY_BREAKOUT:
            return f"day_{self.day_number}_breakout_{self.breakout_round}"
        if self.phase == GamePhase.DAY_REGROUP:
            return f"day_{self.day_number}_regroup_{self.breakout_round}"
        return f"{self.phase.value}_{self.day_number}"

    @property
    def alive_players(self) -> list[Player]:
        return [p for p in self.players if p.is_alive]

    @property
    def dead_players(self) -> list[Player]:
        return [p for p in self.players if not p.is_alive]

    def player_at(self, seat: int) -> Player:
        return self.players[seat]

    def players_with_role(self, role_id: str) -> list[Player]:
        return [p for p in self.players if p.role.id == role_id]

    def demon(self) -> Player | None:
        demons = [p for p in self.players if p.role.role_type == RoleType.DEMON]
        return demons[0] if demons else None

    def minions(self) -> list[Player]:
        return [p for p in self.players if p.role.role_type == RoleType.MINION]

    def evil_team(self) -> list[Player]:
        return [p for p in self.players if p.alignment == Alignment.EVIL]

    def good_team(self) -> list[Player]:
        return [p for p in self.players if p.alignment == Alignment.GOOD]

    def vote_threshold(self) -> int:
        """Number of votes required to put someone on the block (majority of alive)."""
        alive_count = len(self.alive_players)
        return (alive_count // 2) + 1

    def add_message(self, msg: Message) -> None:
        self.all_messages.append(msg)

    def transition_to(self, new_phase: GamePhase) -> None:
        self.turn_history.append(PhaseTransition(
            from_phase=self.phase,
            to_phase=new_phase,
            day_number=self.day_number,
        ))
        self.phase = new_phase

    def start_new_day(self) -> None:
        self.day_number += 1
        self.breakout_round = 0
        self.breakout_groups = []
        self.whispers = []
        self.nominations = []
        self.executed_today = None
        self.on_the_block = None
        self.night_kills = []
        self.night_actions = []
        for p in self.players:
            p.has_nominated_today = False
            p.was_nominated_today = False
            p.is_protected = False


# ---------------------------------------------------------------------------
# Role distribution table
# ---------------------------------------------------------------------------

ROLE_DISTRIBUTION: dict[int, tuple[int, int, int, int]] = {
    # players: (townsfolk, outsiders, minions, demons)
    5:  (3, 0, 1, 1),
    6:  (3, 1, 1, 1),
    7:  (5, 0, 1, 1),
    8:  (5, 1, 1, 1),
    9:  (5, 2, 1, 1),
    10: (7, 0, 2, 1),
    11: (7, 1, 2, 1),
    12: (7, 2, 2, 1),
    13: (9, 0, 3, 1),
    14: (9, 1, 3, 1),
    15: (9, 2, 3, 1),
}
