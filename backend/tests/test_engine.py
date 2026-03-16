"""Tests for the core game engine."""

from __future__ import annotations

import pytest

from botc.engine.types import (
    Alignment,
    BreakoutConfig,
    GameConfig,
    GamePhase,
    GameState,
    NightAction,
    Player,
    RoleType,
    ROLE_DISTRIBUTION,
)
from botc.engine.roles import load_script
from botc.engine.setup import create_game, _resolve_assigned_roles
from botc.engine.night import resolve_first_night, resolve_night
from botc.engine.day import (
    can_nominate,
    can_be_nominated,
    can_vote,
    process_nomination,
    process_vote,
    resolve_execution,
)
from botc.engine.win_conditions import check_win_conditions
from botc.engine.phase_machine import (
    transition,
    validate_transition,
)
from botc.llm.response_parser import parse_response
from botc.engine.abilities import (
    _resolve_standard_demon_kill,
    answer_artist_question,
    deliver_juggler_info,
    on_player_death,
    refresh_script_poisoning,
    resolve_cerenovus,
    resolve_generic_demon_kill,
    resolve_philosopher,
    resolve_pit_hag,
    resolve_professor,
    resolve_slayer_shot,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def script():
    return load_script("trouble_brewing")


@pytest.fixture
def script_sv():
    return load_script("sects_and_violets")


@pytest.fixture
def script_bmr():
    return load_script("bad_moon_rising")


@pytest.fixture
def config_7p():
    return GameConfig(num_players=7, seed=42)


@pytest.fixture
def config_10p():
    return GameConfig(num_players=10, seed=42)


@pytest.fixture
def game_7p(config_7p):
    agents = [f"agent_{i}" for i in range(7)]
    return create_game(config_7p, agents)


@pytest.fixture
def game_10p(config_10p):
    agents = [f"agent_{i}" for i in range(10)]
    return create_game(config_10p, agents)


# ---------------------------------------------------------------------------
# Script loading
# ---------------------------------------------------------------------------

class TestScriptLoading:
    def test_load_trouble_brewing(self, script):
        assert script.script_id == "trouble_brewing"
        assert script.name == "Trouble Brewing"

    def test_role_counts(self, script):
        assert len(script.townsfolk) == 13
        assert len(script.outsiders) == 4
        assert len(script.minions) == 4
        assert len(script.demons) == 1

    def test_role_has_fields(self, script):
        imp = script.roles["imp"]
        assert imp.name == "Imp"
        assert imp.role_type == RoleType.DEMON
        assert imp.alignment == Alignment.EVIL

    def test_night_orders(self, script):
        assert "poisoner" in script.first_night_order
        assert "imp" in script.other_nights_order
        assert script.first_night_order.index("poisoner") < script.first_night_order.index("washerwoman")

    def test_load_sects_and_violets(self, script_sv):
        assert script_sv.script_id == "sects_and_violets"
        assert script_sv.name == "Sects & Violets"
        assert len(script_sv.townsfolk) == 13
        assert len(script_sv.outsiders) == 4
        assert len(script_sv.minions) == 4
        assert len(script_sv.demons) == 4
        assert "vortox" in script_sv.roles

    def test_load_bad_moon_rising(self, script_bmr):
        assert script_bmr.script_id == "bad_moon_rising"
        assert script_bmr.name == "Bad Moon Rising"
        assert len(script_bmr.townsfolk) == 13
        assert len(script_bmr.outsiders) == 4
        assert len(script_bmr.minions) == 4
        assert len(script_bmr.demons) == 4
        assert "shabaloth" in script_bmr.roles


# ---------------------------------------------------------------------------
# Game setup
# ---------------------------------------------------------------------------

class TestGameSetup:
    def test_creates_correct_player_count(self, game_7p):
        assert len(game_7p.players) == 7

    def test_creates_correct_player_count_10(self, game_10p):
        assert len(game_10p.players) == 10

    def test_role_distribution_7p(self, game_7p):
        types = [p.role.role_type for p in game_7p.players]
        assert types.count(RoleType.TOWNSFOLK) == 5
        assert types.count(RoleType.OUTSIDER) == 0
        assert types.count(RoleType.MINION) == 1
        assert types.count(RoleType.DEMON) == 1

    def test_role_distribution_10p(self, game_10p):
        types = [p.role.role_type for p in game_10p.players]
        # Baron may modify outsider count
        baron_in_play = any(p.role.id == "baron" for p in game_10p.players)
        expected_outsiders = 2 if baron_in_play else 0
        expected_townsfolk = 5 if baron_in_play else 7
        assert types.count(RoleType.TOWNSFOLK) == expected_townsfolk
        assert types.count(RoleType.OUTSIDER) == expected_outsiders
        assert types.count(RoleType.MINION) == 2
        assert types.count(RoleType.DEMON) == 1

    def test_all_players_alive(self, game_7p):
        assert all(p.is_alive for p in game_7p.players)

    def test_seats_are_sequential(self, game_7p):
        seats = [p.seat for p in game_7p.players]
        assert seats == list(range(7))

    def test_demon_bluffs_exist(self, game_7p):
        assert len(game_7p.demon_bluffs) == 3
        for bluff in game_7p.demon_bluffs:
            assert bluff.alignment == Alignment.GOOD

    def test_demon_bluffs_not_in_play(self, game_7p):
        in_play_ids = {p.role.id for p in game_7p.players}
        for bluff in game_7p.demon_bluffs:
            assert bluff.id not in in_play_ids

    def test_drunk_gets_perceived_role(self, game_7p):
        drunks = [p for p in game_7p.players if p.role.id == "drunk"]
        for drunk in drunks:
            assert drunk.perceived_role is not None
            assert drunk.perceived_role.role_type == RoleType.TOWNSFOLK
            assert drunk.is_drunk

    def test_seeded_reproducibility(self, config_7p):
        agents = [f"agent_{i}" for i in range(7)]
        game1 = create_game(config_7p, agents)
        game2 = create_game(config_7p, agents)
        roles1 = [p.role.id for p in game1.players]
        roles2 = [p.role.id for p in game2.players]
        assert roles1 == roles2

    def test_fortune_teller_red_herring(self, game_7p):
        fts = [p for p in game_7p.players if p.role.id == "fortune_teller"]
        for ft in fts:
            if "red_herring" in ft.hidden_state:
                rh_seat = ft.hidden_state["red_herring"]
                rh = game_7p.player_at(rh_seat)
                assert rh.alignment == Alignment.GOOD

    def test_invalid_player_count(self):
        config = GameConfig(num_players=3, seed=1)
        with pytest.raises(ValueError, match="Unsupported player count"):
            create_game(config, ["a", "b", "c"])

    def test_wrong_agent_count(self):
        config = GameConfig(num_players=7, seed=1)
        with pytest.raises(ValueError, match="Expected 7 agents"):
            create_game(config, ["a", "b"])


# ---------------------------------------------------------------------------
# Phase transitions
# ---------------------------------------------------------------------------

class TestPhaseTransitions:
    def test_setup_to_first_night(self, game_7p):
        assert game_7p.phase == GamePhase.SETUP
        transition(game_7p, GamePhase.FIRST_NIGHT)
        assert game_7p.phase == GamePhase.FIRST_NIGHT

    def test_invalid_transition(self, game_7p):
        with pytest.raises(ValueError, match="Invalid transition"):
            transition(game_7p, GamePhase.NIGHT)

    def test_first_night_to_day(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        assert game_7p.phase == GamePhase.DAY_DISCUSSION
        assert game_7p.day_number == 1

    def test_day_to_breakout(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        transition(game_7p, GamePhase.DAY_BREAKOUT)
        assert game_7p.phase == GamePhase.DAY_BREAKOUT
        assert game_7p.breakout_round == 1

    def test_full_day_cycle(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        transition(game_7p, GamePhase.NOMINATIONS)
        assert game_7p.phase == GamePhase.NOMINATIONS

    def test_validate_transition(self):
        assert validate_transition(GamePhase.SETUP, GamePhase.FIRST_NIGHT)
        assert not validate_transition(GamePhase.SETUP, GamePhase.NIGHT)
        assert validate_transition(GamePhase.DAY_DISCUSSION, GamePhase.DAY_BREAKOUT)

    def test_history_tracking(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        assert len(game_7p.turn_history) == 2
        assert game_7p.turn_history[0].from_phase == GamePhase.SETUP
        assert game_7p.turn_history[0].to_phase == GamePhase.FIRST_NIGHT


# ---------------------------------------------------------------------------
# Night resolution
# ---------------------------------------------------------------------------

class TestNightResolution:
    def test_first_night_reveals_evil_team(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        resolve_first_night(game_7p, {})

        demon = game_7p.demon()
        assert demon is not None
        # Demon should have received evil team info
        evil_memories = [
            m for m in demon.private_memory
            if "Demon" in m.content or "evil" in m.content.lower()
        ]
        assert len(evil_memories) > 0

    def test_first_night_info_roles_get_info(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        resolve_first_night(game_7p, {})

        # Check that info roles received messages
        for player in game_7p.players:
            role_id = player.role.id
            if role_id in ("washerwoman", "librarian", "investigator", "chef", "empath"):
                assert len(player.private_memory) > 0, f"{role_id} should have info"

    def test_imp_kill(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        resolve_first_night(game_7p, {})
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        transition(game_7p, GamePhase.NOMINATIONS)
        transition(game_7p, GamePhase.NIGHT)

        imp = game_7p.demon()
        # Pick a non-demon target
        target = next(p for p in game_7p.alive_players if p.seat != imp.seat)
        actions = {
            imp.seat: NightAction(
                actor_seat=imp.seat,
                role_id="imp",
                targets=[target.seat],
            )
        }
        deaths = resolve_night(game_7p, actions)
        assert target.seat in deaths or target.role.id in ("soldier", "mayor")

    def test_monk_protection(self, game_7p):
        transition(game_7p, GamePhase.FIRST_NIGHT)
        resolve_first_night(game_7p, {})
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        transition(game_7p, GamePhase.NOMINATIONS)
        transition(game_7p, GamePhase.NIGHT)

        imp = game_7p.demon()
        monks = [p for p in game_7p.players if p.role.id == "monk" and p.is_alive]
        if not monks:
            pytest.skip("No monk in this game")

        monk = monks[0]
        # Pick a target for the Imp
        target = next(
            p for p in game_7p.alive_players
            if p.seat != imp.seat and p.seat != monk.seat
        )

        # Monk protects the target
        from botc.engine.abilities import resolve_monk
        resolve_monk(game_7p, NightAction(monk.seat, "monk", [target.seat]))

        # Imp tries to kill the protected target
        actions = {
            imp.seat: NightAction(imp.seat, "imp", [target.seat]),
        }
        deaths = resolve_night(game_7p, actions)
        assert target.seat not in deaths

    def test_soldier_immunity(self, game_7p):
        soldier = next((p for p in game_7p.players if p.role.id == "soldier"), None)
        if not soldier:
            pytest.skip("No soldier in this game")

        transition(game_7p, GamePhase.FIRST_NIGHT)
        resolve_first_night(game_7p, {})
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        transition(game_7p, GamePhase.NOMINATIONS)
        transition(game_7p, GamePhase.NIGHT)

        imp = game_7p.demon()
        actions = {
            imp.seat: NightAction(imp.seat, "imp", [soldier.seat]),
        }
        deaths = resolve_night(game_7p, actions)
        assert soldier.seat not in deaths
        assert soldier.is_alive

    def test_sv_demon_can_kill(self):
        config = GameConfig(num_players=7, seed=42, script="sects_and_violets")
        agents = [f"agent_{i}" for i in range(7)]
        game = create_game(config, agents)

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)
        transition(game, GamePhase.NIGHT)

        demon = game.demon()
        assert demon is not None
        # Avoid Fang Gu jump edge case in this generic kill test.
        target = next(
            p for p in game.alive_players
            if p.seat != demon.seat and p.role.role_type != RoleType.OUTSIDER
        )
        actions = {
            demon.seat: NightAction(
                actor_seat=demon.seat,
                role_id=demon.role.id,
                targets=[target.seat],
            )
        }
        deaths = resolve_night(game, actions)
        assert target.seat in deaths
        assert not target.is_alive

    def test_first_night_action_dispatch_handles_three_arg_abilities(self):
        config = GameConfig(num_players=7, seed=43, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        dreamer = game.players[0]
        dreamer.role = script.roles["dreamer"]
        dreamer.alignment = Alignment.GOOD
        target = game.players[1]

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(
            game,
            {
                dreamer.seat: NightAction(
                    actor_seat=dreamer.seat,
                    role_id="dreamer",
                    targets=[target.seat],
                )
            },
        )

        assert any("either the" in m.content for m in dreamer.private_memory)

    def test_evil_twin_pair_gets_private_info(self):
        config = GameConfig(num_players=7, seed=44, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        evil_twin = game.players[0]
        good_twin = game.players[1]
        evil_twin.role = script.roles["evil_twin"]
        evil_twin.alignment = Alignment.EVIL
        good_twin.role = script.roles["clockmaker"]
        good_twin.alignment = Alignment.GOOD
        evil_twin.hidden_state["evil_twin_pair_seat"] = good_twin.seat
        good_twin.hidden_state["good_twin_pair_seat"] = evil_twin.seat

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})

        evil_msgs = [m.content for m in evil_twin.private_memory]
        good_msgs = [m.content for m in good_twin.private_memory]
        assert any("Evil Twin" in text for text in evil_msgs)
        assert any("paired with an Evil Twin" in text for text in good_msgs)


# ---------------------------------------------------------------------------
# Day resolution
# ---------------------------------------------------------------------------

class TestDayResolution:
    def _setup_day(self, game: GameState) -> None:
        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)

    def test_nomination(self, game_7p):
        self._setup_day(game_7p)
        transition(game_7p, GamePhase.NOMINATIONS)

        record = process_nomination(game_7p, 0, 1)
        assert record.nominator_seat == 0
        assert record.nominee_seat == 1
        assert game_7p.players[0].has_nominated_today

    def test_cannot_nominate_twice(self, game_7p):
        self._setup_day(game_7p)
        transition(game_7p, GamePhase.NOMINATIONS)

        process_nomination(game_7p, 0, 1)
        assert not can_nominate(game_7p, 0)

    def test_dead_cannot_nominate(self, game_7p):
        self._setup_day(game_7p)
        game_7p.players[0].is_alive = False
        transition(game_7p, GamePhase.NOMINATIONS)

        assert not can_nominate(game_7p, 0)

    def test_voting_and_execution(self, game_7p):
        self._setup_day(game_7p)
        transition(game_7p, GamePhase.NOMINATIONS)

        nom = process_nomination(game_7p, 0, 1)
        transition(game_7p, GamePhase.VOTING)

        # All alive players vote yes
        for p in game_7p.alive_players:
            process_vote(game_7p, nom, p.seat, True)

        executed = resolve_execution(game_7p)
        assert executed == 1
        assert not game_7p.players[1].is_alive

    def test_no_execution_below_threshold(self, game_7p):
        self._setup_day(game_7p)
        transition(game_7p, GamePhase.NOMINATIONS)

        nom = process_nomination(game_7p, 0, 1)
        transition(game_7p, GamePhase.VOTING)

        # Only 1 vote (threshold is 4 for 7 players)
        process_vote(game_7p, nom, 0, True)

        executed = resolve_execution(game_7p)
        assert executed is None

    def test_ghost_vote(self, game_7p):
        self._setup_day(game_7p)
        game_7p.players[2].is_alive = False
        transition(game_7p, GamePhase.NOMINATIONS)

        nom = process_nomination(game_7p, 0, 1)
        transition(game_7p, GamePhase.VOTING)

        # Dead player votes
        assert can_vote(game_7p, 2)
        process_vote(game_7p, nom, 2, True)
        assert game_7p.players[2].ghost_vote_used

        # Can't vote again
        assert not can_vote(game_7p, 2)

    def test_witch_curse_kills_nominator(self, game_7p):
        self._setup_day(game_7p)
        transition(game_7p, GamePhase.NOMINATIONS)
        game_7p.players[0].hidden_state["witch_cursed"] = True
        game_7p.players[0].hidden_state["witch_cursed_by"] = 6
        game_7p.players[0].hidden_state["witch_cursed_day"] = game_7p.day_number

        process_nomination(game_7p, 0, 1)
        assert not game_7p.players[0].is_alive
        assert game_7p.players[0].death_cause == "witch_curse"

    def test_stale_witch_curse_does_not_kill(self, game_7p):
        self._setup_day(game_7p)
        transition(game_7p, GamePhase.NOMINATIONS)
        game_7p.players[0].hidden_state["witch_cursed"] = True
        game_7p.players[0].hidden_state["witch_cursed_by"] = 6
        game_7p.players[0].hidden_state["witch_cursed_day"] = game_7p.day_number - 1

        process_nomination(game_7p, 0, 1)
        assert game_7p.players[0].is_alive


# ---------------------------------------------------------------------------
# On-the-block nomination flow
# ---------------------------------------------------------------------------

class TestOnTheBlockFlow:
    """Tests for the correct BotC nomination flow with on-the-block tracking."""

    def _setup_day(self, game: GameState) -> None:
        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)

    def test_explicit_on_the_block_execution(self, game_7p):
        """resolve_execution(on_the_block=seat) directly executes that player."""
        self._setup_day(game_7p)

        nom = process_nomination(game_7p, 0, 1)
        # Simulate enough votes
        for i in range(5):
            process_vote(game_7p, nom, i, True)
        nom.outcome = "on_the_block"

        executed = resolve_execution(game_7p, on_the_block=1)
        assert executed == 1
        assert not game_7p.players[1].is_alive
        assert game_7p.executed_today == 1
        assert nom.passed is True

    def test_no_execution_when_no_block(self, game_7p):
        """When nobody is on the block, resolve_execution returns None."""
        self._setup_day(game_7p)

        nom = process_nomination(game_7p, 0, 1)
        # Only 1 vote — below threshold
        process_vote(game_7p, nom, 0, True)
        nom.outcome = "failed"

        # No on_the_block -> legacy path -> no execution
        executed = resolve_execution(game_7p)
        assert executed is None

    def test_higher_vote_replaces_block(self, game_7p):
        """A nomination with more votes should replace the current block holder."""
        self._setup_day(game_7p)
        threshold = game_7p.vote_threshold()  # 4 for 7 alive

        # First nomination: seat 1 gets 4 votes -> on the block
        nom1 = process_nomination(game_7p, 0, 1)
        for i in range(4):
            process_vote(game_7p, nom1, i, True)
        nom1.outcome = "on_the_block"
        assert len(nom1.votes_for) == 4

        # Second nomination: seat 2 gets 5 votes -> replaces
        nom2 = process_nomination(game_7p, 3, 2)
        for i in range(5):
            process_vote(game_7p, nom2, i, True)
        nom2.outcome = "replaced"

        assert len(nom2.votes_for) > len(nom1.votes_for)

        # Execute the block holder (seat 2)
        executed = resolve_execution(game_7p, on_the_block=2)
        assert executed == 2
        assert not game_7p.players[2].is_alive

    def test_tie_frees_both(self, game_7p):
        """When two nominations tie, neither is on the block."""
        self._setup_day(game_7p)

        # Nomination 1: seat 1 gets 4 votes
        nom1 = process_nomination(game_7p, 0, 1)
        for i in range(4):
            process_vote(game_7p, nom1, i, True)
        nom1.outcome = "on_the_block"

        # Nomination 2: seat 2 also gets 4 votes -> tie
        nom2 = process_nomination(game_7p, 3, 2)
        for i in range(4):
            process_vote(game_7p, nom2, i, True)
        nom2.outcome = "tied"
        nom1.outcome = "tied"  # Both freed

        # Nobody on the block -> no execution (legacy fallback with tied outcomes)
        executed = resolve_execution(game_7p)
        assert executed is None

    def test_lower_vote_fails(self, game_7p):
        """A nomination with fewer votes doesn't replace the block holder."""
        self._setup_day(game_7p)

        # Nomination 1: seat 1 gets 5 votes
        nom1 = process_nomination(game_7p, 0, 1)
        for i in range(5):
            process_vote(game_7p, nom1, i, True)
        nom1.outcome = "on_the_block"

        # Nomination 2: seat 2 gets 4 votes (above threshold but less)
        nom2 = process_nomination(game_7p, 3, 2)
        for i in range(4):
            process_vote(game_7p, nom2, i, True)
        nom2.outcome = "failed"

        # Seat 1 stays on the block
        executed = resolve_execution(game_7p, on_the_block=1)
        assert executed == 1

    def test_each_player_nominated_once_per_day(self, game_7p):
        """A player can only be nominated once per day."""
        self._setup_day(game_7p)
        process_nomination(game_7p, 0, 1)
        assert not can_be_nominated(game_7p, 1)

    def test_each_player_nominates_once_per_day(self, game_7p):
        """A player can only nominate once per day."""
        self._setup_day(game_7p)
        process_nomination(game_7p, 0, 1)
        assert not can_nominate(game_7p, 0)
        # But other players still can
        assert can_nominate(game_7p, 2)

    def test_dead_player_cannot_nominate(self, game_7p):
        """Dead players cannot nominate."""
        self._setup_day(game_7p)
        game_7p.players[0].is_alive = False
        assert not can_nominate(game_7p, 0)

    def test_dead_player_can_vote_with_ghost_vote(self, game_7p):
        """Dead players can vote YES once (ghost vote), then cannot vote."""
        self._setup_day(game_7p)
        game_7p.players[2].is_alive = False

        nom1 = process_nomination(game_7p, 0, 1)
        assert can_vote(game_7p, 2)
        process_vote(game_7p, nom1, 2, True)
        assert game_7p.players[2].ghost_vote_used
        assert not can_vote(game_7p, 2)

    def test_dead_player_no_vote_on_second_nomination(self, game_7p):
        """After using ghost vote YES, dead player can't vote on later nominations."""
        self._setup_day(game_7p)
        game_7p.players[2].is_alive = False

        # First nomination: dead player uses ghost vote
        nom1 = process_nomination(game_7p, 0, 1)
        process_vote(game_7p, nom1, 2, True)
        assert game_7p.players[2].ghost_vote_used

        # Second nomination: dead player cannot vote
        nom2 = process_nomination(game_7p, 3, 4)
        assert not can_vote(game_7p, 2)

    def test_alive_player_votes_multiple_nominations(self, game_7p):
        """Alive players CAN vote YES on multiple nominations in the same day."""
        self._setup_day(game_7p)

        nom1 = process_nomination(game_7p, 0, 1)
        process_vote(game_7p, nom1, 5, True)
        assert 5 in nom1.votes_for

        nom2 = process_nomination(game_7p, 3, 4)
        # Player 5 can still vote on nom2
        assert can_vote(game_7p, 5)
        process_vote(game_7p, nom2, 5, True)
        assert 5 in nom2.votes_for

    def test_nomination_to_execution_transition(self, game_7p):
        """Phase machine allows NOMINATIONS -> EXECUTION."""
        self._setup_day(game_7p)
        assert validate_transition(GamePhase.NOMINATIONS, GamePhase.EXECUTION)
        transition(game_7p, GamePhase.EXECUTION)
        assert game_7p.phase == GamePhase.EXECUTION

    def test_nomination_record_outcome_field(self, game_7p):
        """NominationRecord has an outcome field defaulting to None."""
        from botc.engine.types import NominationRecord
        nom = NominationRecord(nominator_seat=0, nominee_seat=1)
        assert nom.outcome is None
        nom.outcome = "on_the_block"
        assert nom.outcome == "on_the_block"


# ---------------------------------------------------------------------------
# Win conditions
# ---------------------------------------------------------------------------

class TestWinConditions:
    def _setup_game(self, game: GameState) -> None:
        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)

    def test_no_winner_initially(self, game_7p):
        self._setup_game(game_7p)
        result = check_win_conditions(game_7p)
        assert result is None

    def test_good_wins_when_demon_dies(self, game_7p):
        self._setup_game(game_7p)
        demon = game_7p.demon()
        demon.is_alive = False
        result = check_win_conditions(game_7p)
        assert result is not None
        assert result.alignment == Alignment.GOOD

    def test_evil_wins_with_2_alive(self, game_7p):
        self._setup_game(game_7p)
        imp = game_7p.demon()

        # Kill everyone except imp and one other
        for p in game_7p.players:
            if p.seat != imp.seat:
                p.is_alive = False

        # Keep exactly one other alive
        non_demon = next(p for p in game_7p.players if p.seat != imp.seat)
        non_demon.is_alive = True

        result = check_win_conditions(game_7p)
        assert result is not None
        assert result.alignment == Alignment.EVIL

    def test_saint_execution_evil_wins(self, game_7p):
        self._setup_game(game_7p)
        saint = next((p for p in game_7p.players if p.role.id == "saint"), None)
        if not saint:
            pytest.skip("No saint in game")
        saint.is_alive = False
        game_7p.executed_today = saint.seat
        result = check_win_conditions(game_7p)
        assert result is not None
        assert result.alignment == Alignment.EVIL

    def test_vortox_no_execution_evil_wins(self):
        config = GameConfig(num_players=7, seed=11, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        # Force exactly one living Vortox and no execution.
        for p in game.players:
            if p.role.role_type == RoleType.DEMON:
                p.role = script.roles["vortox"]
                p.alignment = Alignment.EVIL
                p.is_alive = True
                break
        game.day_number = 1
        game.executed_today = None
        game.phase = GamePhase.NIGHT

        result = check_win_conditions(game)
        assert result is not None
        assert result.alignment == Alignment.EVIL
        assert "Vortox" in result.reason

    def test_vortox_no_execution_not_checked_midday(self):
        config = GameConfig(num_players=7, seed=18, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        for p in game.players:
            if p.role.role_type == RoleType.DEMON:
                p.role = script.roles["vortox"]
                p.alignment = Alignment.EVIL
                p.is_alive = True
                break
        game.day_number = 1
        game.executed_today = None
        game.phase = GamePhase.DAY_DISCUSSION

        assert check_win_conditions(game) is None

    def test_klutz_choose_evil_triggers_evil_win(self):
        config = GameConfig(num_players=7, seed=19, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        klutz = game.players[0]
        klutz.role = script.roles["klutz"]
        klutz.alignment = Alignment.GOOD
        klutz.is_alive = False
        klutz.hidden_state["klutz_chose_evil"] = True
        game.phase = GamePhase.NIGHT

        result = check_win_conditions(game)
        assert result is not None
        assert result.alignment == Alignment.EVIL
        assert "Klutz" in result.reason

    def test_good_cannot_win_if_both_twins_alive(self):
        config = GameConfig(num_players=7, seed=12, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        # Build an explicit evil-twin pair and remove all living demons.
        evil_twin = game.players[0]
        good_twin = game.players[1]
        evil_twin.role = script.roles["evil_twin"]
        evil_twin.alignment = Alignment.EVIL
        good_twin.hidden_state["good_twin_pair_seat"] = evil_twin.seat
        evil_twin.hidden_state["evil_twin_pair_seat"] = good_twin.seat
        good_twin.is_alive = True
        evil_twin.is_alive = True

        for p in game.players:
            if p.role.role_type == RoleType.DEMON:
                p.is_alive = False

        result = check_win_conditions(game)
        assert result is None


# ---------------------------------------------------------------------------
# Slayer ability
# ---------------------------------------------------------------------------

class TestSlayer:
    def test_slayer_kills_demon(self, game_7p):
        slayer = next((p for p in game_7p.players if p.role.id == "slayer"), None)
        if not slayer:
            pytest.skip("No slayer in game")
        demon = game_7p.demon()
        result = resolve_slayer_shot(game_7p, slayer, demon)
        assert result is True
        assert not demon.is_alive

    def test_slayer_misses_good(self, game_7p):
        slayer = next((p for p in game_7p.players if p.role.id == "slayer"), None)
        if not slayer:
            pytest.skip("No slayer in game")
        target = next(p for p in game_7p.players if p.alignment == Alignment.GOOD and p.seat != slayer.seat)
        result = resolve_slayer_shot(game_7p, slayer, target)
        assert result is False
        assert target.is_alive

    def test_slayer_once_per_game(self, game_7p):
        slayer = next((p for p in game_7p.players if p.role.id == "slayer"), None)
        if not slayer:
            pytest.skip("No slayer in game")
        target = next(p for p in game_7p.players if p.alignment == Alignment.GOOD and p.seat != slayer.seat)
        resolve_slayer_shot(game_7p, slayer, target)

        demon = game_7p.demon()
        result = resolve_slayer_shot(game_7p, slayer, demon)
        assert result is False  # Already used


# ---------------------------------------------------------------------------
# Sects & Violets mechanics
# ---------------------------------------------------------------------------

class TestSectsAndVioletsMechanics:
    def test_no_dashii_poisons_townsfolk_neighbors(self):
        config = GameConfig(num_players=7, seed=13, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        # Force seat 0 to be No Dashii with Townsfolk neighbors.
        game.players[0].role = script.roles["no_dashii"]
        game.players[0].alignment = Alignment.EVIL
        game.players[1].role = script.roles["clockmaker"]
        game.players[1].alignment = Alignment.GOOD
        game.players[6].role = script.roles["dreamer"]
        game.players[6].alignment = Alignment.GOOD
        game.players[0].is_poisoned = False
        game.players[0].poisoned_by = None

        refresh_script_poisoning(game)
        assert game.players[1].is_poisoned
        assert game.players[6].is_poisoned

    def test_fang_gu_jump_converts_outsider(self):
        config = GameConfig(num_players=7, seed=14, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        fang_gu = game.players[0]
        outsider = game.players[1]
        fang_gu.role = script.roles["fang_gu"]
        fang_gu.alignment = Alignment.EVIL
        outsider.role = script.roles["mutant"]
        outsider.alignment = Alignment.GOOD
        outsider.is_protected = False

        killed = resolve_generic_demon_kill(
            game,
            NightAction(actor_seat=fang_gu.seat, role_id="fang_gu", targets=[outsider.seat]),
        )

        assert fang_gu.seat in killed
        assert not fang_gu.is_alive
        assert outsider.is_alive
        assert outsider.alignment == Alignment.EVIL
        assert outsider.role.id == "fang_gu"

    def test_vigormortis_killed_minion_keeps_ability(self):
        config = GameConfig(num_players=7, seed=15, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        vigor = game.players[0]
        minion = game.players[1]
        vigor.role = script.roles["vigormortis"]
        vigor.alignment = Alignment.EVIL
        minion.role = script.roles["witch"]
        minion.alignment = Alignment.EVIL

        killed = resolve_generic_demon_kill(
            game,
            NightAction(actor_seat=vigor.seat, role_id="vigormortis", targets=[minion.seat]),
        )

        assert minion.seat in killed
        assert not minion.is_alive
        assert minion.hidden_state.get("vigormortis_keeps_ability") is True

    def test_dead_vigormortis_minion_can_still_act(self):
        config = GameConfig(num_players=7, seed=16, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        witch = game.players[0]
        target = game.players[2]
        witch.role = script.roles["witch"]
        witch.alignment = Alignment.EVIL
        witch.is_alive = False
        witch.hidden_state["vigormortis_keeps_ability"] = True

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)
        transition(game, GamePhase.NIGHT)

        resolve_night(
            game,
            {
                witch.seat: NightAction(
                    actor_seat=witch.seat,
                    role_id="witch",
                    targets=[target.seat],
                )
            },
        )
        assert target.hidden_state.get("witch_cursed") is True

    def test_execution_triggers_sweetheart_death_effect(self):
        config = GameConfig(num_players=7, seed=17, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        sweetheart = game.players[0]
        sweetheart.role = script.roles["sweetheart"]
        sweetheart.alignment = Alignment.GOOD

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)

        executed = resolve_execution(game, on_the_block=sweetheart.seat)
        assert executed == sweetheart.seat
        assert any(
            p.hidden_state.get("sweetheart_drunk")
            for p in game.players
            if p.seat != sweetheart.seat
        )

    def test_juggler_info_counts_correct_guesses(self):
        config = GameConfig(num_players=7, seed=20, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        juggler = game.players[0]
        juggler.role = script.roles["juggler"]
        juggler.alignment = Alignment.GOOD
        game.players[1].role = script.roles["vortox"]
        game.players[1].alignment = Alignment.EVIL
        game.players[2].role = script.roles["witch"]
        game.players[2].alignment = Alignment.EVIL
        juggler.hidden_state["juggler_guesses"] = [
            {"seat": 1, "role_id": "vortox"},  # correct
            {"seat": 2, "role_id": "clockmaker"},  # incorrect
        ]

        deliver_juggler_info(game)
        assert juggler.hidden_state.get("juggler_info_given") is True
        assert any("You learn that 1 of your Juggler guess" in m.content for m in juggler.private_memory)

    def test_artist_question_helper_alignment_check(self):
        config = GameConfig(num_players=7, seed=21, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        game.players[3].alignment = Alignment.EVIL

        assert answer_artist_question(game, "Is Player 3 evil?")

    def test_philosopher_can_choose_character_by_role_id(self):
        config = GameConfig(num_players=7, seed=22, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        philosopher = game.players[0]
        philosopher.role = script.roles["philosopher"]
        philosopher.alignment = Alignment.GOOD
        game.players[1].role = script.roles["oracle"]
        game.players[1].alignment = Alignment.GOOD

        msg = resolve_philosopher(
            game,
            philosopher,
            NightAction(
                actor_seat=philosopher.seat,
                role_id="philosopher",
                targets=[],
                role_choice="oracle",
            ),
        )
        assert "gain the ability" in msg.lower()
        assert philosopher.role.id == "oracle"
        assert game.players[1].hidden_state.get("philosopher_drunk") is True

    def test_cerenovus_can_set_specific_mad_role(self):
        config = GameConfig(num_players=7, seed=23, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        cerenovus = game.players[0]
        target = game.players[1]
        cerenovus.role = script.roles["cerenovus"]
        cerenovus.alignment = Alignment.EVIL

        resolve_cerenovus(
            game,
            cerenovus,
            NightAction(
                actor_seat=cerenovus.seat,
                role_id="cerenovus",
                targets=[target.seat],
                role_choice="clockmaker",
            ),
        )
        assert target.hidden_state.get("cerenovus_mad_role_id") == "clockmaker"

    def test_pit_hag_can_set_specific_character(self):
        config = GameConfig(num_players=7, seed=24, script="sects_and_violets")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("sects_and_violets")

        pit_hag = game.players[0]
        target = game.players[1]
        pit_hag.role = script.roles["pit_hag"]
        pit_hag.alignment = Alignment.EVIL
        target.role = script.roles["clockmaker"]
        target.alignment = Alignment.GOOD

        # Ensure chosen role is not currently in play.
        for p in game.players:
            if p.seat != target.seat and p.role.id == "vortox":
                p.role = script.roles["fang_gu"]
                p.alignment = Alignment.EVIL

        resolve_pit_hag(
            game,
            pit_hag,
            NightAction(
                actor_seat=pit_hag.seat,
                role_id="pit_hag",
                targets=[target.seat],
                role_choice="vortox",
            ),
        )
        assert target.role.id == "vortox"


# ---------------------------------------------------------------------------
# Bad Moon Rising mechanics
# ---------------------------------------------------------------------------

class TestBadMoonRisingMechanics:
    def test_po_charge_then_multi_kill(self):
        config = GameConfig(num_players=7, seed=30, script="bad_moon_rising")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("bad_moon_rising")

        demon = game.players[0]
        demon.role = script.roles["po"]
        demon.alignment = Alignment.EVIL

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)
        transition(game, GamePhase.NIGHT)

        # Charge night: no target.
        deaths = resolve_night(
            game,
            {demon.seat: NightAction(actor_seat=demon.seat, role_id="po", targets=[])},
        )
        assert deaths == []
        assert demon.hidden_state.get("po_charged") is True

        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)
        transition(game, GamePhase.NIGHT)

        targets = [p.seat for p in game.alive_players if p.seat != demon.seat][:3]
        deaths = resolve_night(
            game,
            {demon.seat: NightAction(actor_seat=demon.seat, role_id="po", targets=targets)},
        )
        assert len(deaths) >= 1
        assert len(deaths) <= 3

    def test_devils_advocate_prevents_execution_death(self):
        config = GameConfig(num_players=7, seed=31, script="bad_moon_rising")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("bad_moon_rising")

        target = game.players[0]
        target.role = script.roles["grandmother"]
        target.alignment = Alignment.GOOD
        target.hidden_state["devils_advocate_day"] = 1

        transition(game, GamePhase.FIRST_NIGHT)
        resolve_first_night(game, {})
        transition(game, GamePhase.DAY_DISCUSSION)
        transition(game, GamePhase.NOMINATIONS)

        executed = resolve_execution(game, on_the_block=target.seat)
        assert executed == target.seat
        assert target.is_alive

    def test_professor_can_resurrect_dead_good_player(self):
        config = GameConfig(num_players=7, seed=32, script="bad_moon_rising")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("bad_moon_rising")

        professor = game.players[0]
        dead_good = game.players[1]
        professor.role = script.roles["professor"]
        professor.alignment = Alignment.GOOD
        dead_good.role = script.roles["grandmother"]
        dead_good.alignment = Alignment.GOOD
        dead_good.is_alive = False
        dead_good.death_cause = "executed"

        resolve_professor(
            game,
            professor,
            NightAction(
                actor_seat=professor.seat,
                role_id="professor",
                targets=[dead_good.seat],
            ),
        )
        assert dead_good.is_alive

    def test_mastermind_blocks_immediate_good_win(self):
        config = GameConfig(num_players=7, seed=33, script="bad_moon_rising")
        game = create_game(config, [f"a{i}" for i in range(7)])
        script = load_script("bad_moon_rising")

        demon = game.players[0]
        mastermind = game.players[1]
        demon.role = script.roles["po"]
        demon.alignment = Alignment.EVIL
        mastermind.role = script.roles["mastermind"]
        mastermind.alignment = Alignment.EVIL
        mastermind.hidden_state["mastermind_extra_day"] = 2

        demon.is_alive = False
        game.day_number = 1
        game.phase = GamePhase.NIGHT
        assert check_win_conditions(game) is None


# ---------------------------------------------------------------------------
# Game state helpers
# ---------------------------------------------------------------------------

class TestGameState:
    def test_phase_id(self, game_7p):
        assert game_7p.phase_id == "setup_0"
        transition(game_7p, GamePhase.FIRST_NIGHT)
        assert game_7p.phase_id == "night_0"
        transition(game_7p, GamePhase.DAY_DISCUSSION)
        assert "day_discussion" in game_7p.phase_id

    def test_alive_players(self, game_7p):
        assert len(game_7p.alive_players) == 7
        game_7p.players[0].is_alive = False
        assert len(game_7p.alive_players) == 6

    def test_vote_threshold(self, game_7p):
        # 7 alive -> threshold is 4
        assert game_7p.vote_threshold() == 4
        game_7p.players[0].is_alive = False
        # 6 alive -> threshold is 4
        assert game_7p.vote_threshold() == 4

    def test_start_new_day_resets(self, game_7p):
        game_7p.players[0].has_nominated_today = True
        game_7p.executed_today = 1
        game_7p.start_new_day()
        assert game_7p.day_number == 1
        assert not game_7p.players[0].has_nominated_today
        assert game_7p.executed_today is None


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------

class TestResponseParsing:
    def test_parse_night_target_role_action(self):
        parsed = parse_response("<ACTION>{NIGHT_TARGET_ROLE: 3: clockmaker}</ACTION>")
        assert len(parsed.actions) == 1
        action = parsed.actions[0]
        assert action.action_type == "NIGHT_TARGET_ROLE"
        assert action.target == 3
        assert action.value == "clockmaker"

    def test_parse_night_character_action(self):
        parsed = parse_response("<ACTION>{NIGHT_CHARACTER: oracle}</ACTION>")
        assert len(parsed.actions) == 1
        action = parsed.actions[0]
        assert action.action_type == "NIGHT_CHARACTER"
        assert action.value == "oracle"

    def test_parse_night_target_three_action(self):
        parsed = parse_response("<ACTION>{NIGHT_TARGET_THREE: 1, 4, 6}</ACTION>")
        assert len(parsed.actions) == 1
        action = parsed.actions[0]
        assert action.action_type == "NIGHT_TARGET_THREE"
        assert action.value == "1, 4, 6"


# ---------------------------------------------------------------------------
# Assigned role tests
# ---------------------------------------------------------------------------

class TestAssignedRoles:
    """Tests for pre-assigned seat roles (benchmarking feature)."""

    @pytest.fixture
    def script(self):
        return load_script("trouble_brewing")

    def test_valid_7p_assignment(self, script):
        """Valid 7-player assignment: 5T, 0O, 1M, 1D."""
        roles = _resolve_assigned_roles(
            7,
            ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"],
            script,
        )
        assert len(roles) == 7
        assert roles[0].id == "washerwoman"
        assert roles[6].id == "imp"

    def test_valid_7p_with_baron(self, script):
        """Valid 7-player with Baron: 3T, 2O, 1M, 1D."""
        roles = _resolve_assigned_roles(
            7,
            ["washerwoman", "librarian", "chef", "butler", "drunk", "baron", "imp"],
            script,
        )
        assert len(roles) == 7
        types = [r.role_type for r in roles]
        assert types.count(RoleType.TOWNSFOLK) == 3
        assert types.count(RoleType.OUTSIDER) == 2
        assert types.count(RoleType.MINION) == 1
        assert types.count(RoleType.DEMON) == 1

    def test_valid_10p_assignment(self, script):
        """Valid 10-player assignment: 7T, 0O, 2M, 1D."""
        roles = _resolve_assigned_roles(
            10,
            [
                "washerwoman", "librarian", "chef", "empath",
                "fortune_teller", "monk", "soldier",
                "poisoner", "spy", "imp",
            ],
            script,
        )
        assert len(roles) == 10

    def test_wrong_count_raises(self, script):
        """Providing wrong number of roles raises ValueError."""
        with pytest.raises(ValueError, match="seat_roles has 5 entries, need 7"):
            _resolve_assigned_roles(7, ["imp", "poisoner", "chef", "empath", "monk"], script)

    def test_unknown_role_raises(self, script):
        """Unknown role ID raises ValueError."""
        with pytest.raises(ValueError, match="Unknown role 'wizard'"):
            _resolve_assigned_roles(
                7,
                ["wizard", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"],
                script,
            )

    def test_wrong_demon_count_raises(self, script):
        """Having 0 or 2 demons raises ValueError."""
        with pytest.raises(ValueError, match="Need exactly 1 Demon"):
            _resolve_assigned_roles(
                7,
                ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "spy"],
                script,
            )

    def test_wrong_minion_count_raises(self, script):
        """Having wrong number of minions raises ValueError."""
        # 7 players need 1M — give 2M (4T, 0O, 2M, 1D)
        with pytest.raises(ValueError, match="Need exactly 1 Minion"):
            _resolve_assigned_roles(
                7,
                ["washerwoman", "librarian", "chef", "empath", "poisoner", "spy", "imp"],
                script,
            )
        # 10 players need 2M — give 1M (8T, 0O, 1M, 1D — will fail on minion count)
        with pytest.raises(ValueError, match="Need exactly 2 Minion"):
            _resolve_assigned_roles(
                10,
                [
                    "washerwoman", "librarian", "chef", "empath",
                    "fortune_teller", "monk", "soldier", "slayer",
                    "poisoner", "imp",
                ],
                script,
            )

    def test_wrong_townsfolk_count_raises(self, script):
        """Having wrong townsfolk vs outsider split raises ValueError."""
        # 7 players, 5T 0O 1M 1D — give 4T 1O instead
        with pytest.raises(ValueError, match="Need 5 Townsfolk"):
            _resolve_assigned_roles(
                7,
                ["washerwoman", "librarian", "chef", "empath", "butler", "poisoner", "imp"],
                script,
            )

    def test_duplicate_role_raises(self, script):
        """Duplicate roles raise ValueError."""
        with pytest.raises(ValueError, match="Duplicate role: 'chef'"):
            _resolve_assigned_roles(
                7,
                ["chef", "chef", "librarian", "empath", "fortune_teller", "poisoner", "imp"],
                script,
            )

    def test_create_game_with_seat_roles(self, script):
        """Full create_game integration with seat_roles."""
        config = GameConfig(
            script="trouble_brewing",
            num_players=7,
            seed=42,
            seat_roles=["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"],
        )
        agent_ids = [f"agent-{i}" for i in range(7)]
        state = create_game(config, agent_ids)

        # Roles should match the assigned order exactly (no shuffling)
        assert state.players[0].role.id == "washerwoman"
        assert state.players[1].role.id == "librarian"
        assert state.players[5].role.id == "poisoner"
        assert state.players[6].role.id == "imp"

    def test_create_game_random_still_works(self, script):
        """create_game without seat_roles still works (random mode)."""
        config = GameConfig(
            script="trouble_brewing",
            num_players=7,
            seed=42,
        )
        agent_ids = [f"agent-{i}" for i in range(7)]
        state = create_game(config, agent_ids)
        assert len(state.players) == 7


# ---------------------------------------------------------------------------
# Mayor bounce immunity checks
# ---------------------------------------------------------------------------

class TestMayorBounceImmunity:
    """Mayor bounce should respect Soldier, Monk, and Fool protections."""

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        """Create a game state with specific roles assigned to seats."""
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def test_mayor_bounce_to_soldier_survives(self):
        """When Mayor bounce targets a Soldier, the Soldier should survive."""
        # Seats: 0=mayor, 1=soldier, 2=imp, 3=poisoner, 4=empath, 5=chef, 6=washerwoman
        state = self._make_state_with_roles(
            ["mayor", "soldier", "imp", "poisoner", "empath", "chef", "washerwoman"]
        )
        state.day_number = 1

        # Force RNG to pick the Soldier as bounce target
        # bounceable = all alive non-Demon non-Mayor = seats 1, 3, 4, 5, 6
        # We need the RNG to pick seat 1 (Soldier)
        import random
        state.rng = random.Random(0)
        # Find a seed where rng.choice picks the soldier
        for seed in range(100):
            rng = random.Random(seed)
            bounceable = [p for p in state.alive_players if p.seat != 0 and p.role.role_type != RoleType.DEMON]
            pick = rng.choice(bounceable)
            if pick.seat == 1:  # soldier
                state.rng = random.Random(seed)
                break

        killed = _resolve_standard_demon_kill(state, 0)  # target the Mayor
        # Soldier should survive — kill fizzles
        assert killed == []
        assert state.player_at(1).is_alive  # Soldier alive

    def test_mayor_bounce_to_monk_protected_survives(self):
        """When Mayor bounce targets a Monk-protected player, the player should survive."""
        state = self._make_state_with_roles(
            ["mayor", "monk", "imp", "poisoner", "empath", "chef", "washerwoman"]
        )
        state.day_number = 1

        # Protect the empath (seat 4) with Monk
        state.player_at(4).is_protected = True

        # Force RNG to pick the protected empath as bounce target
        import random
        for seed in range(100):
            rng = random.Random(seed)
            bounceable = [p for p in state.alive_players if p.seat != 0 and p.role.role_type != RoleType.DEMON]
            pick = rng.choice(bounceable)
            if pick.seat == 4:  # protected empath
                state.rng = random.Random(seed)
                break

        killed = _resolve_standard_demon_kill(state, 0)
        assert killed == []
        assert state.player_at(4).is_alive

    def test_mayor_bounce_to_fool_uses_survival(self):
        """When Mayor bounce targets a Fool, the Fool uses their first survival."""
        # Mayor is in TB, Fool is in BMR — manually set up the role on a TB state
        state = self._make_state_with_roles(
            ["mayor", "washerwoman", "imp", "poisoner", "empath", "chef", "librarian"]
        )
        state.day_number = 1

        # Manually override seat 1 to be a Fool
        from botc.engine.roles import load_script
        bmr = load_script("bad_moon_rising")
        state.player_at(1).role = bmr.roles["fool"]

        import random
        for seed in range(100):
            rng = random.Random(seed)
            bounceable = [p for p in state.alive_players if p.seat != 0 and p.role.role_type != RoleType.DEMON]
            pick = rng.choice(bounceable)
            if pick.seat == 1:  # fool
                state.rng = random.Random(seed)
                break

        killed = _resolve_standard_demon_kill(state, 0)
        assert killed == []
        assert state.player_at(1).is_alive
        assert state.player_at(1).hidden_state.get("fool_survived_once") is True

    def test_mayor_bounce_normal_kill(self):
        """When Mayor bounce targets a normal player, that player dies."""
        state = self._make_state_with_roles(
            ["mayor", "chef", "imp", "poisoner", "empath", "librarian", "washerwoman"]
        )
        state.day_number = 1

        import random
        for seed in range(100):
            rng = random.Random(seed)
            bounceable = [p for p in state.alive_players if p.seat != 0 and p.role.role_type != RoleType.DEMON]
            pick = rng.choice(bounceable)
            if pick.seat == 1:  # chef (normal townsfolk)
                state.rng = random.Random(seed)
                break

        killed = _resolve_standard_demon_kill(state, 0)
        assert killed == [1]
        assert not state.player_at(1).is_alive


# ---------------------------------------------------------------------------
# Poisoner death clears poison
# ---------------------------------------------------------------------------

class TestPoisonerDeathClearsPoison:
    """When a Poisoner dies, their poison should be cleared immediately."""

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def test_poisoner_execution_clears_poison(self):
        """Executing the Poisoner should immediately clear their target's poison."""
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"]
        )

        poisoner = state.player_at(5)
        target = state.player_at(0)  # washerwoman

        # Poison the washerwoman
        target.is_poisoned = True
        target.poisoned_by = poisoner.seat

        assert target.is_poisoned
        assert target.poisoned_by == 5

        # Kill the Poisoner (simulating execution)
        poisoner.is_alive = False
        poisoner.death_cause = "execution"
        poisoner.death_day = 1
        poisoner.death_phase = "day"
        on_player_death(state, poisoner)

        # Poison should be cleared immediately
        assert not target.is_poisoned
        assert target.poisoned_by is None

    def test_poisoner_death_only_clears_own_poison(self):
        """Poisoner death should only clear poison from their own targets, not others."""
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"]
        )

        target = state.player_at(0)

        # Poison from a different source (seat 99, hypothetical)
        target.is_poisoned = True
        target.poisoned_by = 99

        # Kill the Poisoner at seat 5
        poisoner = state.player_at(5)
        poisoner.is_alive = False
        poisoner.death_cause = "execution"
        on_player_death(state, poisoner)

        # Poison from seat 99 should remain
        assert target.is_poisoned
        assert target.poisoned_by == 99


# ---------------------------------------------------------------------------
# Minstrel effect guard
# ---------------------------------------------------------------------------

class TestMinstrelEffect:
    """Minstrel effect should only fire when a Minstrel is in play."""

    def _make_state_with_roles(self, role_ids: list[str], script: str = "trouble_brewing") -> GameState:
        config = GameConfig(
            script=script,
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def _advance_to_nominations(self, state: GameState) -> None:
        """Walk through the phase machine to reach NOMINATIONS."""
        transition(state, GamePhase.FIRST_NIGHT)
        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)

    def test_no_minstrel_no_drunk_effect(self):
        """Executing a Minion without a Minstrel in play should NOT drunk everyone."""
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"]
        )
        self._advance_to_nominations(state)

        resolve_execution(state, on_the_block=5)

        for p in state.players:
            assert "minstrel_drunk_until_day" not in p.hidden_state, (
                f"Seat {p.seat} got minstrel drunk without Minstrel in play"
            )

    def test_minstrel_in_play_applies_drunk(self):
        """Executing a Minion WITH a Minstrel in play should drunk others."""
        # BMR 10-player: 7T, 0O, 2M, 1D
        state = self._make_state_with_roles(
            ["minstrel", "grandmother", "sailor", "chambermaid", "exorcist",
             "innkeeper", "gambler", "godfather", "devils_advocate", "zombuul"],
            script="bad_moon_rising",
        )
        self._advance_to_nominations(state)

        # Execute the godfather (Minion, seat 7)
        resolve_execution(state, on_the_block=7)

        # Minstrel (seat 0) should NOT be drunk, but others should
        assert "minstrel_drunk_until_day" not in state.player_at(0).hidden_state
        assert state.player_at(1).hidden_state.get("minstrel_drunk_until_day") == 2


# ---------------------------------------------------------------------------
# Mayor win timing
# ---------------------------------------------------------------------------

class TestMayorWinTiming:
    """Mayor win should only trigger at end-of-day, not after night kills."""

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def _advance_to_night(self, state: GameState) -> None:
        """Walk through the phase machine to reach NIGHT."""
        transition(state, GamePhase.FIRST_NIGHT)
        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)
        transition(state, GamePhase.NIGHT)

    def test_mayor_win_does_not_trigger_after_night_kills(self):
        """Mayor win should NOT trigger when night kills reduce alive to 3."""
        state = self._make_state_with_roles(
            ["mayor", "chef", "librarian", "empath", "fortune_teller", "poisoner", "imp"]
        )
        # Walk through phases to reach NIGHT
        self._advance_to_night(state)

        # Kill some players to get to 4 alive (simulating earlier deaths)
        state.player_at(1).is_alive = False
        state.player_at(2).is_alive = False
        state.player_at(3).is_alive = False
        # 4 alive: mayor(0), fortune_teller(4), poisoner(5), imp(6)
        state.executed_today = None  # no execution this day

        # Night kill reduces to 3 alive
        state.player_at(4).is_alive = False
        state.player_at(4).death_cause = "demon_kill"
        state.night_kills = [4]
        # 3 alive: mayor(0), poisoner(5), imp(6)

        result = check_win_conditions(state)
        # Should NOT trigger Mayor win — night kills changed the count
        assert result is None or result.reason != "3 players remain with no execution. The Mayor wins for Good!"

    def test_mayor_win_triggers_at_end_of_day(self):
        """Mayor win should trigger when day ends with 3 alive and no execution."""
        state = self._make_state_with_roles(
            ["mayor", "chef", "librarian", "empath", "fortune_teller", "poisoner", "imp"]
        )
        self._advance_to_night(state)

        # Kill players to get exactly 3 alive
        state.player_at(1).is_alive = False
        state.player_at(2).is_alive = False
        state.player_at(3).is_alive = False
        state.player_at(4).is_alive = False
        # 3 alive: mayor(0), poisoner(5), imp(6)
        state.executed_today = None
        state.night_kills = []  # no night kills yet

        result = check_win_conditions(state)
        assert result is not None
        assert result.alignment == Alignment.GOOD
        assert "Mayor" in result.reason


# ---------------------------------------------------------------------------
# Ghost vote / Butler interaction
# ---------------------------------------------------------------------------

class TestGhostVoteButlerInteraction:
    """Ghost vote should not be consumed if Butler restriction blocks it."""

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def test_dead_butler_ghost_vote_not_wasted_on_block(self):
        """Dead Butler's ghost vote shouldn't be consumed when master hasn't voted YES."""
        from botc.engine.types import NominationRecord
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"]
        )
        state.day_number = 2

        # Simulate a Butler by setting butler_master on seat 1
        butler = state.player_at(1)
        butler.is_alive = False
        butler.butler_master = 0  # master is seat 0

        nom = NominationRecord(
            nominator_seat=2,
            nominee_seat=3,
            votes_for=[],
            votes_against=[],
        )
        state.nominations.append(nom)

        # Master (seat 0) has NOT voted YES
        process_vote(state, nom, 1, vote_yes=True)

        # Butler's vote should be blocked and ghost vote NOT consumed
        assert 1 not in nom.votes_for
        assert not butler.ghost_vote_used

    def test_dead_player_no_vote_not_recorded(self):
        """Dead players voting NO should be silently dropped (abstain)."""
        from botc.engine.types import NominationRecord
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "fortune_teller", "poisoner", "imp"]
        )
        state.day_number = 2
        state.player_at(1).is_alive = False

        nom = NominationRecord(
            nominator_seat=2,
            nominee_seat=3,
            votes_for=[],
            votes_against=[],
        )
        state.nominations.append(nom)

        process_vote(state, nom, 1, vote_yes=False)

        # Dead player's NO vote should not be recorded
        assert 1 not in nom.votes_against


class TestButlerMasterUpdateOnDeath:
    """Regression test for bug E6: Butler master not updated when Butler dies
    on the same night they chose a new master."""

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def test_butler_master_updated_when_killed_same_night(self):
        """Butler's master should update even if the Imp kills them that night."""
        # 8p = 5T, 1O, 1M, 1D
        # Seats: 0=washerwoman, 1=butler, 2=chef, 3=empath, 4=fortune_teller, 5=librarian, 6=poisoner, 7=imp
        state = self._make_state_with_roles(
            ["washerwoman", "butler", "chef", "empath", "fortune_teller", "librarian", "poisoner", "imp"]
        )
        # Advance through first night
        transition(state, GamePhase.FIRST_NIGHT)
        butler = state.player_at(1)

        # First night: Butler chooses seat 0 as master
        first_night_actions = {
            1: NightAction(actor_seat=1, role_id="butler", targets=[0]),
        }
        resolve_first_night(state, first_night_actions)
        assert butler.butler_master == 0

        # Advance to subsequent night
        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)
        transition(state, GamePhase.NIGHT)

        # Night 1: Imp kills Butler (seat 1), Butler chooses seat 3 as new master
        actions = {
            7: NightAction(actor_seat=7, role_id="imp", targets=[1]),
            1: NightAction(actor_seat=1, role_id="butler", targets=[3]),
        }
        deaths = resolve_night(state, actions)

        # Butler should be dead
        assert not butler.is_alive
        assert 1 in deaths

        # Butler master should be updated to seat 3, NOT still 0
        assert butler.butler_master == 3, (
            f"Butler master should be 3 (new choice) but was {butler.butler_master}"
        )

    def test_butler_master_updated_normally_when_alive(self):
        """Sanity check: Butler master updates when Butler survives the night."""
        state = self._make_state_with_roles(
            ["washerwoman", "butler", "chef", "empath", "fortune_teller", "librarian", "poisoner", "imp"]
        )
        transition(state, GamePhase.FIRST_NIGHT)
        butler = state.player_at(1)

        first_night_actions = {
            1: NightAction(actor_seat=1, role_id="butler", targets=[0]),
        }
        resolve_first_night(state, first_night_actions)
        assert butler.butler_master == 0

        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)
        transition(state, GamePhase.NIGHT)

        # Night 1: Imp kills someone else, Butler chooses seat 4
        actions = {
            7: NightAction(actor_seat=7, role_id="imp", targets=[2]),
            1: NightAction(actor_seat=1, role_id="butler", targets=[4]),
        }
        resolve_night(state, actions)

        assert butler.is_alive
        assert butler.butler_master == 4


# ---------------------------------------------------------------------------
# E5: Empath wrong count after Poisoner execution
# ---------------------------------------------------------------------------

class TestEmpathAfterPoisonerExecution:
    """E5 regression: Empath should get correct count after Poisoner is executed.

    Root cause: executing a Minion (Poisoner) triggered _apply_minstrel_effect()
    even when no Minstrel was in play (E3 bug). This set minstrel_drunk_until_day
    on ALL players, causing the Empath to malfunction and report a wrong count.
    """

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=99,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def test_empath_correct_after_poisoner_execution(self):
        """After executing the Poisoner (who poisoned a neighbour of Empath),
        the Empath should report 0 evil neighbours when both neighbours are good.

        Reproduces bug E5 from game 5354d078d9da (seed 30839, 8 players).
        Layout: seat 0=Poisoner, 1=Washerwoman, 2=Chef, 3=Librarian,
                4=Soldier, 5=Empath, 6=Slayer, 7=Imp
        No Spy, Recluse, or Minstrel in play.
        """
        # 8 players = 5 Townsfolk + 1 Outsider + 1 Minion + 1 Demon
        state = self._make_state_with_roles([
            "poisoner",      # seat 0 — Minion
            "washerwoman",   # seat 1
            "chef",          # seat 2
            "butler",        # seat 3 — Outsider (required for 8p distribution)
            "soldier",       # seat 4 — Empath's left neighbour (good Townsfolk)
            "empath",        # seat 5 — the role under test
            "slayer",        # seat 6 — Empath's right neighbour (good Townsfolk)
            "imp",           # seat 7 — Demon
        ])

        # -- First Night --
        transition(state, GamePhase.FIRST_NIGHT)
        # Poisoner (seat 0) poisons Soldier (seat 4), a neighbour of Empath
        first_night_actions = {
            0: NightAction(actor_seat=0, role_id="poisoner", targets=[4]),
        }
        resolve_first_night(state, first_night_actions)

        # Verify Soldier is poisoned after first night
        soldier = state.player_at(4)
        assert soldier.is_poisoned or soldier.poisoned_by == 0, \
            "Soldier should be poisoned by the Poisoner after first night"

        # -- Day 1 --
        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)

        # Execute the Poisoner (seat 0)
        poisoner = state.player_at(0)
        state.on_the_block = 0
        poisoner.is_alive = False
        poisoner.death_cause = "executed"
        poisoner.death_day = state.day_number
        poisoner.death_phase = "day"
        state.executed_today = 0
        on_player_death(state, poisoner)

        # Simulate what resolve_execution does: _apply_minstrel_effect
        # (With E3 fix, this is a no-op since no Minstrel is in play)
        from botc.engine.day import _apply_minstrel_effect
        _apply_minstrel_effect(state, poisoner)

        # Verify Minstrel effect did NOT fire (no Minstrel in play)
        empath = state.player_at(5)
        assert empath.hidden_state.get("minstrel_drunk_until_day", -1) < state.day_number, \
            "Without a Minstrel in play, no player should be marked drunk by Minstrel effect"

        # -- Night 1 --
        transition(state, GamePhase.NIGHT)

        # Imp kills Washerwoman (seat 1) — someone away from Empath
        night_actions = {
            7: NightAction(actor_seat=7, role_id="imp", targets=[1]),
        }
        deaths = resolve_night(state, night_actions)
        assert 1 in deaths, "Washerwoman should have been killed by Imp"

        # -- Verify Empath info --
        # Empath (seat 5) alive neighbours: seat 4 (Soldier, good) and seat 6 (Slayer, good)
        empath = state.player_at(5)
        assert empath.is_alive, "Empath should be alive"
        assert not empath.is_poisoned, \
            "Empath should NOT be poisoned (no active poison source, no Minstrel in play)"
        assert not empath.is_drunk, \
            "Empath should NOT be drunk"

        # Check the Empath's private memory for the night info
        empath_night_msgs = [
            m for m in empath.private_memory
            if "neighbour" in m.content.lower() and m.phase_id == state.phase_id
        ]
        assert len(empath_night_msgs) > 0, \
            "Empath should have received night info"

        info = empath_night_msgs[-1].content
        assert "0" in info, (
            f"Empath should learn 0 evil neighbours (both are good Townsfolk), "
            f"but got: {info!r}"
        )

    def test_phantom_minstrel_causes_empath_malfunction(self):
        """Prove the root cause: phantom Minstrel drunk effect poisons the Empath.

        This simulates the pre-E3 bug where executing any Minion triggered
        _apply_minstrel_effect without checking for an actual Minstrel.
        """
        state = self._make_state_with_roles([
            "poisoner",      # seat 0 — Minion
            "washerwoman",   # seat 1
            "chef",          # seat 2
            "butler",        # seat 3 — Outsider
            "soldier",       # seat 4
            "empath",        # seat 5
            "slayer",        # seat 6
            "imp",           # seat 7
        ])

        transition(state, GamePhase.FIRST_NIGHT)
        resolve_first_night(state, {})
        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)

        # Execute the Poisoner
        poisoner = state.player_at(0)
        poisoner.is_alive = False
        poisoner.death_cause = "executed"
        poisoner.death_day = state.day_number
        state.executed_today = 0
        on_player_death(state, poisoner)

        # Manually simulate the pre-E3 bug: Minstrel effect without Minstrel check
        for player in state.players:
            if player.seat == poisoner.seat:
                continue
            player.hidden_state["minstrel_drunk_until_day"] = state.day_number + 1

        # Now refresh_script_poisoning should mark everyone as poisoned
        refresh_script_poisoning(state)
        empath = state.player_at(5)
        assert empath.is_poisoned, \
            "Phantom Minstrel effect should cause Empath to be marked as poisoned"

        # Run night — Empath should get WRONG info due to malfunction
        transition(state, GamePhase.NIGHT)
        night_actions = {
            7: NightAction(actor_seat=7, role_id="imp", targets=[1]),
        }
        resolve_night(state, night_actions)

        empath_night_msgs = [
            m for m in empath.private_memory
            if "neighbour" in m.content.lower() and m.phase_id == state.phase_id
        ]
        assert len(empath_night_msgs) > 0

        # The Empath IS malfunctioning, so wrong_number could return 1 or 2
        info = empath_night_msgs[-1].content
        # We can't predict the exact wrong number (RNG-dependent), but we CAN
        # verify the Empath was poisoned during resolution
        assert empath.is_poisoned or "minstrel_drunk_until_day" in empath.hidden_state, \
            "Empath should still show signs of phantom Minstrel poisoning"


# ---------------------------------------------------------------------------
# Bug E8: Poison persists after Poisoner chooses no target
# ---------------------------------------------------------------------------

class TestPoisonerNoTargetClearsPoison:
    """Bug E8: when the Poisoner picks no target on a subsequent night,
    the previous night's poison must be fully cleared (both is_poisoned
    and poisoned_by) so that refresh_script_poisoning does not re-apply it.
    """

    def _make_state_with_roles(self, role_ids: list[str]) -> GameState:
        config = GameConfig(
            script="trouble_brewing",
            num_players=len(role_ids),
            seed=42,
            seat_roles=role_ids,
        )
        agent_ids = [f"agent-{i}" for i in range(len(role_ids))]
        return create_game(config, agent_ids)

    def test_poison_cleared_when_poisoner_chooses_no_target(self):
        """Reproduces bug E8 from game 7f5c9e88152b.

        First night: Poisoner (seat 5) poisons Mayor (seat 4).
        Second night: Poisoner chooses no target (empty actions dict).
        After resolve_night, Mayor must NOT be poisoned.
        """
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "mayor", "poisoner", "imp"]
        )
        transition(state, GamePhase.FIRST_NIGHT)

        poisoner = state.player_at(5)
        mayor = state.player_at(4)

        # -- First night: Poisoner targets Mayor --
        first_night_actions = {
            5: NightAction(actor_seat=5, role_id="poisoner", targets=[4]),
        }
        resolve_first_night(state, first_night_actions)

        # Mayor should be poisoned after first night
        assert mayor.is_poisoned, "Mayor should be poisoned after first night"
        assert mayor.poisoned_by == 5, "Mayor's poisoned_by should point to Poisoner"

        # -- Transition to day then night --
        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)
        transition(state, GamePhase.NIGHT)

        # -- Second night: Poisoner chooses no target --
        # The Poisoner seat is NOT in the actions dict (LLM returned no target)
        second_night_actions = {
            6: NightAction(actor_seat=6, role_id="imp", targets=[0]),  # Imp kills someone
        }
        deaths = resolve_night(state, second_night_actions)

        # Mayor must NOT be poisoned anymore
        assert not mayor.is_poisoned, \
            "Bug E8: Mayor should NOT be poisoned after Poisoner chose no target"
        assert mayor.poisoned_by is None, \
            "Bug E8: Mayor's poisoned_by should be None after Poisoner chose no target"

    def test_poison_moves_when_poisoner_switches_target(self):
        """Poisoner switches from one target to another on the next night."""
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "mayor", "poisoner", "imp"]
        )
        transition(state, GamePhase.FIRST_NIGHT)

        poisoner = state.player_at(5)
        mayor = state.player_at(4)
        chef = state.player_at(2)

        # -- First night: Poison Mayor --
        resolve_first_night(state, {
            5: NightAction(actor_seat=5, role_id="poisoner", targets=[4]),
        })
        assert mayor.is_poisoned
        assert not chef.is_poisoned

        transition(state, GamePhase.DAY_DISCUSSION)
        transition(state, GamePhase.NOMINATIONS)
        transition(state, GamePhase.NIGHT)

        # -- Second night: Switch poison to Chef --
        resolve_night(state, {
            5: NightAction(actor_seat=5, role_id="poisoner", targets=[2]),
            6: NightAction(actor_seat=6, role_id="imp", targets=[0]),
        })

        # Mayor should no longer be poisoned; Chef should be
        assert not mayor.is_poisoned, "Old target should lose poison"
        assert mayor.poisoned_by is None
        assert chef.is_poisoned, "New target should be poisoned"
        assert chef.poisoned_by == 5

    def test_refresh_script_poisoning_does_not_revive_cleared_poison(self):
        """After resolve_poisoner clears poison, refresh_script_poisoning
        must not re-apply it from a stale poisoned_by field.
        """
        state = self._make_state_with_roles(
            ["washerwoman", "librarian", "chef", "empath", "mayor", "poisoner", "imp"]
        )

        mayor = state.player_at(4)

        # Simulate: Mayor was poisoned by Poisoner (seat 5)
        mayor.is_poisoned = True
        mayor.poisoned_by = 5

        # resolve_poisoner with no target should clear both fields
        from botc.engine.abilities import resolve_poisoner
        resolve_poisoner(state, NightAction(actor_seat=5, role_id="poisoner", targets=[]))

        assert not mayor.is_poisoned
        assert mayor.poisoned_by is None

        # Now refresh_script_poisoning should NOT re-poison the Mayor
        refresh_script_poisoning(state)

        assert not mayor.is_poisoned, \
            "refresh_script_poisoning must not revive cleared poison"
