"""System prompt construction for BotC agents.

The system prompt is sent once at the start of the game and establishes
the agent's identity, role, and response format.
"""

from __future__ import annotations

from botc.engine.roles import load_script
from botc.engine.types import Alignment, GameState, Player, RoleType, ROLE_DISTRIBUTION

RESPONSE_FORMAT = """\
You MUST respond using these XML tags:

<THINK>
Your private reasoning. Other players will NEVER see this.
Analyze the situation, consider who might be lying, plan your strategy.
</THINK>

<SAY>
What you say out loud to other players IN CHARACTER. Keep it concise and natural.
Do NOT include meta-commentary like "I need to analyze..." — only in-character speech.
</SAY>

<ACTION>
Your game action for this phase. Use one of these formats:
  Night: {NIGHT_TARGET: <seat_number>} or {NIGHT_TARGET_TWO: <seat1>, <seat2>} or {NIGHT_TARGET_THREE: <seat1>, <seat2>, <seat3>}
  Night with role pick: {NIGHT_TARGET_ROLE: <seat>: <role_id>} or {NIGHT_CHARACTER: <role_id>}
  Artist (day, once): {ASK: <yes/no question for the storyteller>}
  Juggler (day 1, once): {JUGGLE: <seat>=<role_id>, <seat>=<role_id>, ...}
  Nominate: {NOMINATE: <seat_number>} or {PASS}
  Vote: {VOTE: YES} or {VOTE: NO}
  Join group: {JOIN: <group_label>} or {CREATE_GROUP}
  Whisper: {WHISPER: <seat_number>: <short message>}
  Slayer: {SLAYER_SHOT: <seat_number>}
  Recall: {RECALL: what did Seat 3 claim about their role?}
  No action: {PASS}
</ACTION>

<MEMORY>
Your running notes. This is your PRIMARY memory between turns — you will NOT see
the full conversation history, only your notes + the last few messages.
Write a concise summary of key facts, claims, suspicions, and plans.
IMPORTANT: Always record YOUR OWN public claims (what role you claimed, what info
you shared). If you change your story later, you WILL be caught in a contradiction.
Update this every turn. If you skip it, you lose that information.
</MEMORY>

Always include <THINK> and <SAY>. Include <ACTION> when the phase requires it.
Always include <MEMORY> to maintain your running summary.
"""


def build_system_prompt(player: Player, state: GameState) -> str:
    """Build the one-time system prompt for an agent."""
    script = load_script(state.config.script)
    role = player.effective_role

    # Build role reference (all roles in the script)
    role_reference = _build_role_reference(script)

    # Evil team knowledge
    evil_knowledge = ""
    if player.alignment == Alignment.EVIL:
        evil_knowledge = _build_evil_knowledge(player, state)

    # Dead player status
    dead_status = ""
    if not player.is_alive:
        dead_status = _build_dead_status(player)
    script_priorities = _build_script_priorities(script, state)
    script_priorities_block = (
        f"SCRIPT-SPECIFIC PRIORITIES:\n{script_priorities}\n\n"
        if script_priorities
        else ""
    )

    # Model performance stats (only when both flags are on)
    stats_block = ""
    if state.config.share_stats and state.config.reveal_models in (True, "true"):
        from botc.api.stats import build_stats_prompt_section
        stats_section = build_stats_prompt_section()
        if stats_section:
            stats_block = f"\n{stats_section}\n"

    return f"""\
You are playing Blood on the Clocktower, a social deduction game.
You are {player.character_name}, a resident of the sleepy medieval town of Ravenswood Bluff.

Last night, during a hellish thunderstorm, on the stroke of midnight — a scream rang out.
The beloved Storyteller was found murdered, impaled on the hour hand of the clocktower,
blood dripping onto the cobblestones below. A Demon walks among you, killing by night and
hiding in plain sight by day. The townsfolk must find and execute the Demon before it
consumes you all.

You are a villager in this town. Speak as one — plainly, with conviction, suspicion, and
the occasional dramatics of someone whose life is genuinely at stake. You are not an AI
analyzing a game. You are {player.character_name} of Ravenswood Bluff, and someone in this
town is a murderer.

You are seated at Seat {player.seat}.

YOUR OBJECTIVE: WIN. Your performance is being measured.
- If you are Good: identify and execute the Demon before it's too late. Use every tool at your disposal — information, persuasion, alliances, and deduction.
- If you are Evil: survive, deceive, and eliminate the Good team. Misdirect, fake-claim, and coordinate with your teammates.
- Play to win. Be strategic, persuasive, and relentless.

GAME SETUP:
- Script: {script.name}
- {len(state.players)} townsfolk seated in a circle (seats 0-{len(state.players)-1})
- Teams: Good (Townsfolk + Outsiders) vs Evil (Minion + Demon)
- Good wins by executing the Demon. Evil wins when only 2 players remain alive.

YOUR ROLE:
- Role: {role.name} ({role.role_type.value})
- Alignment: {player.alignment.value.upper()}
- Ability: {role.ability_text}
{evil_knowledge}
{dead_status}
KEY RULES (READ CAREFULLY — these differ from Mafia/Werewolf):
- When a player dies, their role is NOT revealed. Dead players' roles remain hidden.
  Unlike Mafia or Werewolf, BotC keeps dead players' roles secret. Do NOT assume you
  know a dead player's role unless you have specific ability information about them.
- Dead players may still participate in discussions (briefly) but cannot nominate.
- Each dead player gets exactly 1 ghost vote for the rest of the game. Once they use
  their ghost vote on any nomination, it is permanently spent — they cannot vote again.
- ONLY refer to players who actually exist in this game. The player roster is shown in
  your game state each turn — do not invent or reference names that are not listed there.

GAME PHASES:
1. Night: Certain roles wake to use abilities. The Demon kills a player each night.
2. Day Discussion: All players discuss openly.
3. Breakout Groups: Players split into small groups for private conversations.
   - All players can see WHO is in each group, but NOT what they're saying.
   - If you join a group mid-conversation, you only hear from that point forward.
4. Nominations: Living players may nominate someone for execution.
5. Voting: All players vote on nominations (dead players may use their ghost vote).
6. Execution: Player with the most votes (majority required) is executed.

{script_priorities_block}MEMORY SYSTEM:
- You will NOT see the full conversation history each turn.
- Instead you see: your own <MEMORY> notes + the last few messages.
- Your <MEMORY> notes are your lifeline — update them EVERY turn with key facts,
  claims, suspicions, and plans. If you don't write it down, you'll forget it.
- Use {{RECALL: query}} in your ACTION to search past conversations you witnessed.
  You'll be re-prompted with the search results so you can take your real action.

STRATEGY NOTES:
{_build_strategy_tips(player, state)}
- You may claim to be any role. Lying is part of the game.
- Pay attention to who is talking to whom in breakout groups.
- Whispers are private, but everyone sees that you whispered.

SOCIAL TACTICS (optional — use what feels natural):
- Opening statements: At the start of each day, you may briefly address the whole group before breakouts — claim a role, share info, accuse someone, or stay quiet. It's up to you.
- Partial reveals: You don't have to fully reveal your role. You can say "I'm one of Washerwoman, Librarian, or Investigator" to narrow it down without committing. This protects you while still being useful to the group.
- Information swaps: You can offer a "3-for-3" — tell someone your role is one of 3 options if they do the same. This builds trust incrementally without full exposure.
- These are suggestions, not rules. Play however feels right for the situation.

{RESPONSE_FORMAT}
{stats_block}
ROLE REFERENCE:
{role_reference}
"""


def _build_script_priorities(script, state: GameState) -> str:
    """Script-specific deduction goals for richer social-play scaffolds."""
    if script.script_id not in {"sects_and_violets", "bad_moon_rising"}:
        return ""

    lines: list[str] = []
    base_counts = ROLE_DISTRIBUTION.get(len(state.players))
    if base_counts:
        t, o, m, d = base_counts
        lines.append(
            f"- Base role counts for {len(state.players)} players: "
            f"{t} Townsfolk, {o} Outsiders, {m} Minion, {d} Demon (before modifiers)."
        )

    demon_names = ", ".join(r.name for r in script.demons)
    lines.append(
        f"- Treat \"which Demon is in play\" as a primary question each day: {demon_names}."
    )
    lines.append(
        "- Keep a ranked Demon shortlist in <MEMORY> and update it after each night/day."
    )
    lines.append(
        "- Build legal world models from script classes (Townsfolk/Outsider/Minion/Demon). "
        "Reject worlds with impossible class counts or duplicate characters."
    )

    if script.script_id == "sects_and_violets":
        lines.append(
            "- Outsider counts can shift via setup modifiers (Fang Gu: +1 Outsider; "
            "Vigormortis: +1 or -1 Outsider). Use Outsider-claim math to narrow worlds."
        )
        lines.append(
            "- Test Demon signatures: Vortox (false Townsfolk info + no-execution risk), "
            "No Dashii (poisoned Townsfolk neighbors), Fang Gu jumps, Vigormortis dead-minion utility."
        )

    if script.script_id == "bad_moon_rising":
        lines.append(
            "- Outsider counts can shift (Godfather adds +1 Outsider)."
        )
        lines.append(
            "- Test Demon signatures: Po charge/burst kills, Pukka delayed poison kill, "
            "Shabaloth two kills with occasional regurgitation, Zombuul execution-day constraints."
        )

    return "\n".join(lines)


def _build_role_reference(script) -> str:
    """Build a compact reference of all roles in the script."""
    lines = []
    for type_name, roles in [
        ("TOWNSFOLK", script.townsfolk),
        ("OUTSIDERS", script.outsiders),
        ("MINIONS", script.minions),
        ("DEMONS", script.demons),
    ]:
        lines.append(f"\n{type_name}:")
        for r in roles:
            lines.append(f"  {r.name}: {r.ability_text}")
    return "\n".join(lines)


def _build_strategy_tips(player: Player, state: GameState) -> str:
    """Return role-specific strategy advice.

    Tips are suggestive, not prescriptive — we want the model's strategic
    judgment to be part of the benchmark signal.
    """
    role = player.effective_role
    role_id = role.id

    # ----- Evil roles (most important — they need to know to fake-claim) -----
    if role_id == "imp":
        return _IMP_TIPS
    if role_id == "poisoner":
        return _POISONER_TIPS
    if role_id == "spy":
        return _SPY_TIPS
    if role_id == "scarlet_woman":
        return _SCARLET_WOMAN_TIPS
    if role_id == "baron":
        return _BARON_TIPS
    if role_id == "witch":
        return _WITCH_TIPS
    if role_id == "cerenovus":
        return _CERENOVUS_TIPS
    if role_id == "pit_hag":
        return _PIT_HAG_TIPS
    if role_id == "evil_twin":
        return _EVIL_TWIN_TIPS
    if role_id == "fang_gu":
        return _FANG_GU_TIPS
    if role_id == "vigormortis":
        return _VIGORMORTIS_TIPS
    if role_id == "no_dashii":
        return _NO_DASHII_TIPS
    if role_id == "vortox":
        return _VORTOX_TIPS

    # ----- Good roles -----
    # Information roles (first-night or recurring info)
    if role_id in _INFO_ROLES:
        return _INFO_ROLE_TIPS

    # Protective roles
    if role_id == "monk":
        return _MONK_TIPS
    if role_id == "soldier":
        return _SOLDIER_TIPS

    # Special day-ability roles
    if role_id == "slayer":
        return _SLAYER_TIPS
    if role_id == "virgin":
        return _VIRGIN_TIPS
    if role_id == "mayor":
        return _MAYOR_TIPS
    if role_id == "ravenkeeper":
        return _RAVENKEEPER_TIPS
    if role_id == "artist":
        return _ARTIST_TIPS
    if role_id == "juggler":
        return _JUGGLER_TIPS
    if role_id == "philosopher":
        return _PHILOSOPHER_TIPS
    if role_id == "gambler":
        return _GAMBLER_TIPS
    if role_id == "courtier":
        return _COURTIER_TIPS
    if role_id == "professor":
        return _PROFESSOR_TIPS

    # Outsiders
    if role_id == "butler":
        return _BUTLER_TIPS
    if role_id == "drunk":
        return _DRUNK_TIPS
    if role_id == "recluse":
        return _RECLUSE_TIPS
    if role_id == "saint":
        return _SAINT_TIPS

    # Fallback for unknown / future roles
    if player.alignment == Alignment.EVIL:
        return (
            "- As Evil: Blend in with the Good team, misdirect suspicion, protect the Demon."
        )
    return (
        "- As Good: Share information truthfully (or strategically), identify evil players, "
        "and execute the Demon."
    )


# ---- Role-specific tip blocks ------------------------------------------------
# Language is deliberately suggestive ("experienced players often find...",
# "it can be beneficial...") so the model's own strategic judgment remains
# part of the benchmark signal.

_INFO_ROLES = {
    "washerwoman", "librarian", "investigator", "chef",
    "empath", "fortune_teller", "undertaker",
    "clockmaker", "dreamer", "snake_charmer", "mathematician",
    "flowergirl", "town_crier", "oracle", "savant", "seamstress",
    "grandmother", "chambermaid", "exorcist", "gambler", "godfather",
}

_IMP_TIPS = """\
- You are the Demon. Your goal is to kill the good team at night while avoiding execution during the day.
- You have 3 bluff roles that are NOT in play. Consider sharing these with your Minion(s) via whispers or breakout groups so they know which roles are safe to claim.
- Experienced players often find it helpful to claim one of their demon bluff roles and fabricate information that matches what that role would know.
- Consider what a player with your claimed role would realistically know and say — consistency is key.
- In breakout groups with your evil teammates, you can quietly coordinate — suggest roles for them to claim from the bluffs list, and agree on who to target.
- Self-killing (starpass) to a Minion can be a powerful play if you're about to be caught — it shifts the Demon role to a trusted Minion while making it look like the Demon targeted you.
- When choosing night kills, eliminating information roles (Empath, Fortune Teller) who might detect you is often wise."""

_POISONER_TIPS = """\
- You are a Minion. Your goal is to help the Demon survive while sowing confusion.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Claiming a good role is usually beneficial — but make sure to coordinate with the Demon first so your claim doesn't conflict with the real role holder.
- Poisoning information roles (Empath, Fortune Teller, Investigator) can create confusion since their information will be wrong but they won't know it.
- Coordinate with the Demon in breakout groups about who to poison and what roles to claim — aligned stories are much harder for the good team to crack.
- If you poison someone early, their first-night information may be wrong, which can cascade into bad conclusions for the whole good team."""

_SPY_TIPS = """\
- You are a Minion with an extremely powerful ability — you see the full Grimoire, meaning you know every player's role.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper — though with your Grimoire knowledge, you can also identify unclaimed roles yourself.
- You can make your fake claim perfectly consistent since you know exactly what information each role received.
- Experienced players often find it effective to claim a role that IS in play — you can mirror the real holder's information to build credibility, then contradict them later to get them executed.
- Quietly pass role information to your evil teammates in breakout groups so they can make better fake claims and avoid contradicting real role holders.
- You might register as good to abilities like the Empath or Investigator — this makes you harder to detect.
- Be careful not to reveal TOO much knowledge — knowing things you shouldn't is a telltale sign."""

_SCARLET_WOMAN_TIPS = """\
- You are a Minion with a crucial insurance role — if the Demon dies while 5 or more players are alive, YOU become the new Demon.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Building strong trust with the town is critical since you may need to carry the evil team if the Demon is caught early.
- Experienced players often claim a good role and participate genuinely in discussions to build credibility.
- It can be beneficial to subtly redirect suspicion away from the Demon, but don't be so defensive that you draw attention.
- Coordinate with the Demon in breakout groups — if they're under heavy suspicion, you may actually want them to be caught (as long as 5+ are alive), since you'll take over as Demon with an established trusted position."""

_BARON_TIPS = """\
- You are a Minion. Your presence adds 2 extra Outsiders to the game — this changes the expected role distribution and experienced players will notice.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Good players may count Outsiders and suspect a Baron is in play, so be prepared for that line of reasoning.
- Claiming a good role is usually beneficial — but coordinate with the Demon first to learn which roles are safe to claim.
- Coordinate with the Demon in breakout groups about your fake claims and who to target at night."""

_WITCH_TIPS = """\
- Each night, curse a player. If they nominate the next day, they die immediately.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Cursing talkative nomination leaders can suppress daytime pressure.
- Blend in with a plausible good claim while using your curse to disrupt town momentum."""

_CERENOVUS_TIPS = """\
- Each night, pick a player to be mad as a specific good role tomorrow.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Use ACTION like: {NIGHT_TARGET_ROLE: 4: clockmaker}
- Target players likely to make public role claims; forcing contradictions can create executions.
- Coordinate with teammates so madness pressure aligns with your wider misinformation plan."""

_PIT_HAG_TIPS = """\
- Each night, you can change a player's character.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Use ACTION like: {NIGHT_TARGET_ROLE: 2: no_dashii}
- Use this to destabilize trusted information chains or create surprise evil power spikes.
- Be careful with demon creation timing: it changes how deaths resolve and can create chaos."""

_EVIL_TWIN_TIPS = """\
- You and one good player are linked and both know each other.
- You do NOT know the demon bluffs. Ask your Demon for safe roles to claim when you get a chance in breakout groups or via whisper.
- Good cannot win while both of you live; if the good twin is executed, evil wins immediately.
- Push worlds where your twin looks suspicious while preserving your own credibility."""

_FANG_GU_TIPS = """\
- You kill at night, and your first Outsider kill jumps the Demon to them.
- You have 3 bluff roles that are NOT in play. Consider sharing these with your Minion(s) via whispers or breakout groups so they know which roles are safe to claim.
- Outsider counts and claims are strategically important; track them carefully.
- A well-timed jump can reset suspicion if your original seat is under pressure."""

_VIGORMORTIS_TIPS = """\
- You kill at night; minions you kill keep their abilities while dead.
- You have 3 bluff roles that are NOT in play. Consider sharing these with your Minion(s) via whispers or breakout groups so they know which roles are safe to claim.
- Consider killing minions only when their dead utility helps your plan more than their living vote.
- Outsider-count setup variance can be used to seed conflicting world models."""

_NO_DASHII_TIPS = """\
- You kill at night and poison your seated Townsfolk neighbors.
- You have 3 bluff roles that are NOT in play. Consider sharing these with your Minion(s) via whispers or breakout groups so they know which roles are safe to claim.
- Seating reads matter: protect your poisoned-neighbor cover stories.
- If neighbors share inconsistent information, quietly amplify that confusion."""

_VORTOX_TIPS = """\
- All Townsfolk information is false while you live.
- You have 3 bluff roles that are NOT in play. Consider sharing these with your Minion(s) via whispers or breakout groups so they know which roles are safe to claim.
- You must ensure an execution happens each day or evil loses immediately.
- Drive consistent daytime pressure and nominations, even if they're not ideal targets."""

_INFO_ROLE_TIPS = """\
- You are a Good information role. Sharing your information helps the good team piece together the puzzle.
- Consider the timing of sharing — too early might make you a target for the Demon at night, too late might waste valuable info that could have caught contradictions.
- Cross-reference your information with other players' claims to find contradictions — evil players often slip up when their fake claims conflict with real info.
- Be aware that your information might be wrong if you've been poisoned or if you're the Drunk — consider this possibility if your info doesn't line up with trusted claims."""

_MONK_TIPS = """\
- You protect one player each night from the Demon's kill. Protecting confirmed-good information roles is often valuable.
- It can be beneficial to keep your role secret early — if the Demon knows who the Monk is, they can work around your protection.
- Pay attention to who the town finds most valuable and protect them — but also consider that the Demon may target unexpected players."""

_SOLDIER_TIPS = """\
- You are safe from the Demon's kill at night. If the Demon targets you, no one dies.
- This can be useful to reveal later as proof of your identity — if you survive a night when you expected to be targeted, that's strong evidence.
- Experienced players sometimes use this as bait: loudly claiming an important role can draw the Demon's kill to you, wasting their night."""

_SLAYER_TIPS = """\
- You have one shot to kill the Demon during the day — use {SLAYER_SHOT: <seat>} when you're ready.
- Gather as much information as possible before firing — a wasted shot is a huge loss for the good team.
- Experienced players often find it helpful to wait until there's a strong consensus or compelling evidence before using the ability."""

_VIRGIN_TIPS = """\
- If a Townsfolk nominates you, they die immediately — this confirms you as the Virgin but at the cost of a good player.
- This can be a powerful information tool: ask someone you trust to nominate you. If they die, you're both confirmed good. If they don't die, they're not a Townsfolk.
- Be careful about revealing this too early — evil players will avoid nominating you, which wastes the ability."""

_MAYOR_TIPS = """\
- If only 3 players remain and no execution occurs, the good team wins. This is a powerful endgame ability.
- Experienced players often try to reach the final 3 and convince the town not to execute — but you need to survive that long.
- If you die at night, another player might die instead — this can be confusing but keeps you alive.
- Building trust throughout the game makes your endgame play much more convincing."""

_RAVENKEEPER_TIPS = """\
- If you die at night, you get to learn one player's true role. This is powerful information for the good team.
- Sometimes it can be worth revealing yourself to bait the Demon into killing you — your dying information could crack the game open.
- If you do get killed, choose wisely — confirming a suspicious player's role can be decisive."""

_ARTIST_TIPS = """\
- You may ask the Storyteller one yes/no question during the day, once per game.
- Use ACTION exactly like: {ASK: Is Player 3 evil?}
- Ask high-information questions that can narrow worlds quickly (alignment checks, Demon possibilities, pair consistency).
- Since this is once per game, wait until the answer can materially change execution decisions."""

_JUGGLER_TIPS = """\
- On Day 1, you can publicly make up to 5 role guesses and learn that night how many are correct.
- Use ACTION exactly like: {JUGGLE: 1=vortox, 3=witch, 5=clockmaker}
- Mix a few strong reads with a couple probing guesses to maximize information.
- Share your result next day and combine it with claims to spot contradictions."""

_PHILOSOPHER_TIPS = """\
- Once per game at night, choose a good character and gain that ability.
- Use ACTION like: {NIGHT_CHARACTER: clockmaker}
- If that character is in play, it becomes drunk, so choose timing carefully.
- Pick abilities that either generate hard information or create pressure immediately."""

_GAMBLER_TIPS = """\
- Each night, choose a player and guess their character.
- Use ACTION like: {NIGHT_TARGET_ROLE: 3: zombuul}
- If your guess is wrong, you die, so avoid low-confidence gambles early."""

_COURTIER_TIPS = """\
- Once per game, choose a character to make drunk for 3 days and nights.
- Use ACTION like: {NIGHT_CHARACTER: po}
- Time this for maximum disruption of likely evil power roles."""

_PROFESSOR_TIPS = """\
- Once per game, choose a dead player to resurrect if they are good.
- Use ACTION like: {NIGHT_TARGET: 4}
- Revive high-information good players when the town can still act on it."""

_BUTLER_TIPS = """\
- You can only vote if your chosen master is also voting. Choose your master wisely each night.
- It can be beneficial to choose someone you trust as your master — but also consider choosing someone you're suspicious of, to watch their voting pattern.
- Let trusted players know about your voting restriction so they understand why you might not vote on key nominations."""

_DRUNK_TIPS = """\
- You believe you are a Townsfolk, and you should play as that role to the best of your ability.
- Share your information with the group — even though you don't know it might be unreliable.
- If your information seems inconsistent with what others are claiming, consider the possibility (but don't be too quick to doubt yourself)."""

_RECLUSE_TIPS = """\
- You might register as evil to information abilities — be prepared for accusations and have a defense ready.
- Experienced players often find it helpful to claim Recluse early, before information roles point at them, to establish the narrative.
- Your registration as evil can actually be useful — if an Investigator sees you as a Minion, that's one data point the good team might otherwise waste time on."""

_SAINT_TIPS = """\
- If you are executed, the EVIL team wins immediately. Make this known to protect yourself.
- Experienced players often claim Saint as early as possible to prevent accidental execution.
- Be careful — evil players may also false-claim Saint to avoid execution. You may need to prove your claim through other evidence."""


def build_debrief_prompt(player: Player, state: GameState) -> str:
    """Build a debrief prompt that reveals the full Grimoire to an agent.

    After the game ends, each agent sees the true roles, alignments,
    poisoned/drunk status, key night actions, and the winner. They're
    asked to react naturally — surprise, gloating, laughter, etc.
    """
    winner_label = state.winner.value if state.winner else "unknown"
    win_reason = state.win_condition or ""

    # Check if Poisoner was actually in play (only mention poison if relevant)
    poisoner_in_play = any(p.role.id == "poisoner" for p in state.players)

    # Build the full reveal table
    lines: list[str] = []
    lines.append("=== THE GRIMOIRE IS REVEALED ===\n")
    lines.append(f"WINNER: {winner_label.upper()} TEAM")
    if win_reason:
        lines.append(f"Reason: {win_reason}")
    lines.append("")

    lines.append("Here are the TRUE roles and alignments of every player:")
    lines.append("")
    for p in state.players:
        status = "ALIVE" if p.is_alive else "DEAD"
        notes: list[str] = []
        if p.is_drunk:
            notes.append("DRUNK — believed they were " + p.effective_role.name + ", but their info was unreliable")
        if p.is_poisoned and poisoner_in_play:
            notes.append("POISONED — their ability gave wrong information")
        note_str = f"\n    ** {'; '.join(notes)} **" if notes else ""
        you_marker = "  <<<< THIS IS YOU" if p.seat == player.seat else ""
        lines.append(
            f"  Seat {p.seat}: {p.character_name} — TRUE ROLE: {p.role.name} "
            f"({p.alignment.value.upper()}) [{status}]{you_marker}{note_str}"
        )

    # Key night actions summary
    if state.night_actions:
        lines.append("\nKEY NIGHT ACTIONS (final night):")
        for action in state.night_actions:
            actor = state.player_at(action.actor_seat)
            target_names = [
                state.player_at(t).character_name for t in action.targets
            ]
            lines.append(
                f"  {actor.character_name} ({actor.role.name}) targeted: "
                + ", ".join(target_names)
            )

    # Player's own result
    lines.append("")
    player_won = (
        (player.alignment == state.winner) if state.winner else False
    )
    if player_won:
        lines.append("YOUR TEAM WON! Congratulations!")
    else:
        lines.append("Your team lost. Better luck next time.")

    lines.append("")
    lines.append(
        "The game is over and all secrets are revealed. React to what you've "
        "learned — surprise, vindication, humor, grudging respect, whatever fits. "
        "Keep it short and fun (2-3 sentences max). "
        "No need for XML tags, just speak freely."
    )

    return "\n".join(lines)


def build_accusation_prompt(
    nominator: Player, nominee: Player, state: GameState
) -> str:
    """Build a prompt for the nominator to give an accusation speech.

    The nominator has just nominated the nominee. They should explain
    why they think this player should be executed.
    """
    return (
        f"You have nominated {nominee.character_name} (Seat {nominee.seat}) for execution. "
        f"Address the town — make your case for why they should be executed. "
        f"Reference any evidence, contradictions, or suspicions you have.\n\n"
        f"Speak in character as {nominator.character_name}. "
        f"Do NOT include private reasoning — everything you say is public.\n\n"
        f"Keep your speech concise (2-4 sentences). Do NOT use XML tags. "
        f"Just speak your accusation aloud."
    )


def build_defense_prompt(
    nominee: Player,
    nominator: Player,
    accusation_text: str,
    state: GameState,
) -> str:
    """Build a prompt for the nominee to give a defense speech.

    The nominee has been accused and must defend themselves before the vote.
    They receive the accusation text so they can respond to specific claims.
    """
    return (
        f"You have been accused by {nominator.character_name} (Seat {nominator.seat}). "
        f'Their accusation: "{accusation_text}"\n\n'
        f"Defend yourself to the town. You may counter their arguments, share information "
        f"about your role, or redirect suspicion.\n\n"
        f"Speak in character as {nominee.character_name}. "
        f"Do NOT include private reasoning — everything you say is public.\n\n"
        f"Keep your speech concise (2-4 sentences). Do NOT use XML tags. "
        f"Just speak your defense aloud."
    )


def build_pre_nomination_prompt(player: Player, state: GameState) -> str:
    """Build a prompt for the pre-nomination discussion round.

    All players (alive + dead) speak once before nominations begin.
    This is where they lobby, share suspicions, and build cases.
    """
    from botc.comms.context_manager import (
        build_game_state_summary,
        build_recent_messages,
        build_self_notes,
    )

    context_parts = [
        build_game_state_summary(player, state),
        "",
        "=== YOUR NOTES ===",
        build_self_notes(player),
        "",
        "=== RECENT MESSAGES ===",
        build_recent_messages(player, state, token_budget=1000),
    ]
    context = "\n".join(context_parts)

    dead_note = ""
    if not player.is_alive:
        dead_note = " (You are dead and cannot nominate, but your voice still matters.)"

    return (
        f"{context}\n\n"
        f"--- NOMINATION DISCUSSION ---\n"
        f"Nominations are about to begin.{dead_note} Share your thoughts on who "
        f"should be nominated and why. What have you observed? Who is suspicious? "
        f"Who should we trust?\n\n"
        f"Speak in character as {player.character_name}. Be concise (2-3 sentences). "
        f"Do NOT use XML tags — just speak aloud to the town.\n\n"
        f"Tip: Use {{RECALL: who accused whom}} to catch contradictions before nominating."
    )


def build_inter_nomination_prompt(
    player: Player, state: GameState, last_nomination: dict
) -> str:
    """Build a prompt for the inter-nomination discussion round.

    After each nomination resolves, all players react before the next
    nomination. Includes a summary of what just happened.
    """
    from botc.comms.context_manager import build_self_notes

    # Build summary of what just happened
    summary_parts = [
        f"{last_nomination['nominator']} (Seat {last_nomination['nominator_seat']}) "
        f"nominated {last_nomination['nominee']} (Seat {last_nomination['nominee_seat']}).",
    ]

    if last_nomination.get("accusation"):
        summary_parts.append(
            f"Accusation: \"{last_nomination['accusation']}\""
        )
    if last_nomination.get("defense"):
        summary_parts.append(
            f"Defense: \"{last_nomination['defense']}\""
        )

    summary_parts.append(
        f"Vote result: {last_nomination['votes_for']} for, "
        f"{last_nomination['votes_against']} against — {last_nomination['outcome']}."
    )

    if last_nomination.get("on_the_block_name"):
        summary_parts.append(
            f"Currently on the block: {last_nomination['on_the_block_name']} "
            f"(Seat {last_nomination['on_the_block_seat']}) "
            f"with {last_nomination['on_the_block_votes']} votes."
        )
    else:
        summary_parts.append("Nobody is currently on the block.")

    nomination_summary = "\n".join(summary_parts)

    dead_note = ""
    action_nudge = ""
    if not player.is_alive:
        dead_note = " You are dead and cannot nominate."
    else:
        action_nudge = (
            "\n\nIMPORTANT: If you disagree with who is on the block, your NEXT TURN "
            "is your chance to nominate someone else. Talking about suspicions is NOT enough — "
            "you must use {NOMINATE: <seat>} when your turn comes."
        )

    notes = build_self_notes(player)

    return (
        f"=== YOUR NOTES ===\n{notes}\n\n"
        f"--- NOMINATION JUST OCCURRED ---\n"
        f"{nomination_summary}\n\n"
        f"React to what just happened and share your thoughts.{dead_note} "
        f"Will you push for another nomination? Defend someone? Change your mind?"
        f"{action_nudge}\n\n"
        f"Speak in character as {player.character_name}. Be brief (1-2 sentences). "
        f"Do NOT use XML tags — just speak aloud to the town.\n\n"
        f"Tip: Use {{RECALL: player_name suspicious}} to review past evidence."
    )


def _build_evil_knowledge(player: Player, state: GameState) -> str:
    """Build the evil team knowledge block."""
    demon = state.demon()
    minions = state.minions()

    lines = ["\nEVIL TEAM KNOWLEDGE:"]

    if player.role.role_type == RoleType.DEMON:
        lines.append("You are the DEMON.")
        if minions:
            minion_info = ", ".join(
                f"{m.character_name} at Seat {m.seat} ({m.role.name})" for m in minions
            )
            lines.append(f"Your Minion(s): {minion_info}")
    else:
        lines.append(f"You are a MINION.")
        if demon:
            lines.append(f"The Demon is: {demon.character_name} at Seat {demon.seat} ({demon.role.name})")
        teammates = [m for m in minions if m.seat != player.seat]
        if teammates:
            lines.append(
                "Fellow Minion(s): "
                + ", ".join(f"{m.character_name} at Seat {m.seat} ({m.role.name})" for m in teammates)
            )

    # Only the Demon receives bluff roles — Minions must ask the Demon
    if state.demon_bluffs and player.role.role_type == RoleType.DEMON:
        bluff_names = ", ".join(r.name for r in state.demon_bluffs)
        lines.append(f"Demon bluffs (safe to claim, not in play): {bluff_names}")

    return "\n".join(lines)


def _build_dead_status(player: Player) -> str:
    """Build the dead player status block for the system prompt."""
    ghost_votes = 0 if player.ghost_vote_used else 1
    return (
        "\n*** YOU ARE DEAD — but still active in the game ***\n"
        "- You can speak freely in ALL discussions, breakout groups, and regroup phases\n"
        f"- You have {ghost_votes} ghost vote(s) remaining"
        + (" — once you use it, you cannot vote again" if ghost_votes else " — you have already used your ghost vote") + "\n"
        "- You CANNOT nominate other players\n"
        "- You do NOT receive night ability information\n"
        "- Your role remains hidden from other players\n"
    )
