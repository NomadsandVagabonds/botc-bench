# BotC Bench — Bug Tracker

Compiled from analysis of 5 game logs. Deduplicated and categorized.

---

## Engine Bugs (Rule Violations / State Corruption)

### E1. Mayor bounce bypasses all immunity checks [FIXED]

- **Severity:** Game-breaking
- **Games:** `7f5c9e88152b` (Night 7: Soldier killed via Mayor bounce)
- **Description:** When the Imp targets the Mayor and the kill bounces, the bounce target is killed directly — bypassing Soldier immunity, Monk protection, Sailor immunity, Tea Lady protection, and Fool's first survival. In game 7f5c, an unpoisoned Soldier (seat 9) died from a Mayor bounce.
- **Root cause:** `_resolve_standard_demon_kill()` in `abilities.py` set `bounce_target.is_alive = False` directly instead of recursing through the protection checks.
- **Fix:** Added `_bounced` parameter; bounce now recursively calls `_resolve_standard_demon_kill()` so all protections are evaluated. Committed in current working tree.
- **Game impact:** Soldier incorrectly killed on Night 7, reducing alive count to 3 and (combined with E2) triggering a premature Mayor win.

### E2. Mayor win condition checks post-night-kill alive count

- **Severity:** Moderate (game-outcome-altering)
- **Games:** `7f5c9e88152b` (Day 7 → Night 7 → premature Good win)
- **Description:** `_check_mayor_win()` in `win_conditions.py` gates on `state.phase in (NIGHT, GAME_OVER)` and checks `len(state.alive_players) == 3` and `state.executed_today is None`. After night kills reduce alive count, `check_win_conditions()` runs at line 309 of `game_runner.py`. If night kills brought the count from 4→3 and the *previous* day had no execution (`executed_today=None` not yet reset), the Mayor win fires — even though the "no execution" condition was met when 4 players were alive, not 3.
- **Root cause:** The Mayor win evaluates "3 alive + no execution" at two different temporal points: alive count is post-night, but the no-execution flag is from the previous day.
- **File:** `backend/botc/engine/win_conditions.py` lines 134-157
- **Expected:** Mayor win should only trigger at end-of-day (after execution phase), not after night kills. The phase gate should be tighter, or the check should run before night resolution.
- **Fix:** Added `state.night_kills` guard — Mayor win now returns `None` when `night_kills` is populated, ensuring it only triggers at end-of-day timing (before night resolution), not after night kills change the alive count.
- **Status:** FIXED

### E3. Minstrel effect fires without Minstrel in play [FIXED]

- **Severity:** Game-breaking
- **Games:** `7f5c9e88152b` (Day 3 Baron execution, Day 4 Poisoner execution)
- **Description:** `_apply_minstrel_effect()` in `day.py` fires on every Minion execution regardless of whether a Minstrel exists in the game. When any Minion is executed, ALL other players get `minstrel_drunk_until_day = day+1`, causing `refresh_script_poisoning()` to mark them as poisoned. In game 7f5c (Trouble Brewing, no Minstrel), executing the Baron on Day 3 poisoned all 14 other players for a full day. Executing the Poisoner on Day 4 extended the effect.
- **Root cause:** `_apply_minstrel_effect()` at `day.py:244-251` never checks if an alive, non-poisoned Minstrel is in play.
- **Fix:** Added guard: early-return if no alive, non-poisoned Minstrel exists.
- **Game impact:** All players poisoned for 3 days. Did not change the outcome in this specific game but would break Soldier immunity, Empath info, Fortune Teller info, etc. in any game where a Minion is executed.
- **Status:** FIXED

### E4. Poison not cleared on Poisoner execution [FIXED]

- **Severity:** Moderate
- **Games:** `7f5c9e88152b` (Poisoner seat 0 executed Day 4, poison persisted)
- **Description:** The Poisoner's poison is only cleared at the start of `resolve_night()` via `_clear_dead_poisoner_poison()`. If the Poisoner is executed during the day, poison persists through the rest of the day and into night resolution.
- **Fix:** Added Poisoner death handling in `on_player_death()` — immediately clears `is_poisoned` and `poisoned_by` on the target. Committed in current working tree.
- **Status:** FIXED

### E5. Empath returns wrong count after Poisoner execution (Night 1, game 5354) [FIXED by E3]

- **Severity:** Game-breaking (outcome-altering)
- **Games:** `5354d078d9da` (Night 1: Empath seat 5 told "1" instead of "0")
- **Description:** After the Poisoner (seat 0) was executed on Day 1, the Empath (seat 5) received "1 evil neighbour" on Night 1. Both alive neighbours (seat 4 Soldier, seat 6 Slayer) are good.
- **Root cause:** Downstream consequence of E3 (phantom Minstrel effect). When the Poisoner (a Minion) was executed, `_apply_minstrel_effect` fired without a Minstrel in play, setting `minstrel_drunk_until_day` on all players. On Night 1, `refresh_script_poisoning()` saw the Empath as drunk, causing `_info_malfunctions` to return True and `wrong_number(0, 2, rng)` to produce "1". Not related to E4 at all — the Minstrel drunk operates through `hidden_state`, not `poisoned_by`.
- **Fix:** Resolved by the E3 fix (Minstrel guard). No separate fix needed.
- **Game impact:** Empath's wrong "1" led town to suspect and execute Soldier (seat 4) on Day 2, contributing to evil victory.
- **Status:** FIXED (by E3)

### E6. Butler master not updated after Night action [FIXED]

- **Severity:** Moderate (potentially outcome-altering)
- **Games:** `e6588e9e039a` (Night 1: Butler chose seat 3, but `butler_master` stayed at 0)
- **Description:** The Butler (seat 2) chose a new master (seat 3) on Night 1, but `butler_master` stayed at 0 (the first-night choice). On Day 2, the Butler's ghost vote YES was allowed because the old master (seat 0) voted YES — but the true master (seat 3) voted NO, which should have blocked it.
- **Root cause:** In `resolve_night()`, the Imp's kill resolves before the Butler's turn in night order. When the Imp kills the Butler, `_can_act_at_night()` returns False for the now-dead Butler, so `resolve_butler()` is skipped and `butler_master` stays stale.
- **Fix:** Added a post-loop pass in `night.py` that unconditionally applies any Butler action from the collected actions dict, regardless of alive status. `resolve_butler()` is idempotent.
- **Game impact:** Ghost vote counted when it should have been blocked. Vote would have been 2-2 instead of 3-2.
- **Status:** FIXED

### E7. Ghost vote consumed before Butler restriction check [FIXED]

- **Severity:** Moderate
- **Games:** Affects any game with a dead Butler
- **Description:** In `day.py:88-100`, the ghost vote is consumed (`ghost_vote_used = True`) at line 92 BEFORE the Butler restriction is checked at line 95-100. If a dead Butler's master hasn't voted YES, the ghost vote is wasted silently — consumed but the vote not counted.
- **Fix:** Reordered: dead NO votes now silently dropped (abstain); Butler restriction checked before consuming ghost vote; ghost vote only consumed after all checks pass.
- **Status:** FIXED

### E8. Poison persists after Poisoner chooses no target [FIXED]

- **Severity:** Minor
- **Games:** `7f5c9e88152b` (Night 1: Poisoner chose no target, seat 6 stayed poisoned)
- **Description:** On Night 1, the Poisoner chose no target, but seat 6 (Mayor) remained poisoned from the first night.
- **Root cause:** When the Poisoner's LLM returned no valid target, `_extract_night_action` returned `None`, so the Poisoner's seat was absent from the `actions` dict. The old code had `if action:` guard that skipped `resolve_poisoner()` entirely, so old `poisoned_by` was never cleared. `refresh_script_poisoning()` then re-derived `is_poisoned=True` from the stale `poisoned_by` field.
- **Fix:** Already fixed in commit f0227a8 (`resolve_night` now calls `resolve_poisoner` even with no action). The E8 agent added the same fix to `resolve_first_night()` for consistency, plus regression tests.
- **Status:** FIXED (historical log from pre-fix)

---

## Voting / Nomination Bugs

### V1. Dead players record NO votes [FIXED]

- **Severity:** Cosmetic (no gameplay impact)
- **Games:** `6a6555484944`, `5354d078d9da`
- **Description:** Dead players who haven't used their ghost vote are recorded as voting NO in `nomination.votes_against`. BotC rules say dead players either use their one ghost vote (YES) or abstain — they don't actively vote NO.
- **Fix:** Dead players voting NO now early-return (treated as abstain). Fixed alongside E7.
- **Status:** FIXED

### V2. `vote.cast` events emitted before Butler restriction applied [FIXED]

- **Severity:** Minor (data quality)
- **Games:** `8aa07259ac16` (Butler seat 1 shows `vote: true` but vote was blocked)
- **Description:** The game runner emitted `vote.cast` with the raw `vote_yes` value before `process_vote()` applied restrictions. The event was misleading.
- **Fix:** Moved emit to after `process_vote()`. Now checks actual outcome (whether voter ended up in `votes_for`/`votes_against`). Blocked/dropped votes produce no event.
- **Status:** FIXED

---

## Data Quality Issues

### D1. `initial_state` captures final state instead of initial [FIXED]

- **Severity:** Moderate
- **Games:** ALL (`7f5c`, `5354`, `e658`, `6a65`, `8aa0`)
- **Description:** `routes.py` called `snapshot_observer(runner.state)` after the game ends, capturing debrief phase, mutated roles, dead players, final nominations, etc. The field is meant for replay.
- **Fix:** Added `_initial_snapshot` captured right after `create_game()`. Committed in current working tree.
- **Status:** FIXED

### D2. Missing `initial_role` and `model` in result players [FIXED]

- **Severity:** Minor
- **Games:** ALL
- **Description:** `result.players` only has the final role (post-Scarlet Woman conversion shows both as "Imp") and no provider/model info. Makes post-game analysis require cross-referencing.
- **Fix:** Added `initial_role` and `model` fields to `_compile_result`. Committed in current working tree.
- **Status:** FIXED

### D3. Missing first-night events in saved logs

- **Severity:** Minor
- **Games:** `6a6555484944`
- **Description:** No events between `phase.change: first_night` and `phase.change: day_discussion`. Night ability results, private info, evil team reveals are all absent. Cannot verify what information agents received.
- **Status:** OPEN — may be version-dependent (older game format)

### D4. Missing `game.state` event and top-level fields in older logs

- **Severity:** Minor
- **Games:** `6a6555484944`
- **Description:** Older game logs are missing `game_id` and `status` top-level fields, `game.state` event, `night.action` events, and some `phase.change` events (e.g., execution phase). Newer games have these.
- **Status:** OPEN — legacy format, may not be worth backfilling

### D5. Dead Undertaker shows "receives information" in night action events

- **Severity:** Cosmetic
- **Games:** `7f5c9e88152b` (Night 3: Undertaker seat 11 killed by Imp, still shows action)
- **Description:** `_emit_night_actions` emits events before resolution (by design — shows planned actions), so players who die during night resolution appear as if they acted.
- **Status:** WONTFIX — by design (pre-resolution observer preview)

---

## Agent Behavior Issues

These are not engine bugs but affect benchmark quality.

### A1. Agents hallucinate non-existent player names [MITIGATED]

- **Severity:** Moderate (benchmark quality)
- **Games:** `8aa07259ac16` (**claude-opus-4** fabricated "Grimgar", **gpt-4o** confirmed it)
- **Description:** Frontier models hallucinated a non-existent player name. The roster is in the per-turn context, but agents still fabricated names.
- **Fix:** Added explicit instruction to system prompt: "ONLY refer to players who actually exist in this game." Won't fully prevent hallucinations but gives the model a clear rule to follow.
- **Status:** MITIGATED

### A2. Agents misinterpret Chef information [FIXED]

- **Severity:** Minor (benchmark quality)
- **Games:** `6a6555484944` (Chef misunderstood "0 pairs" as "my neighbors are good")
- **Description:** The Chef publicly stated "neither of my immediate neighbors are evil" based on learning 0 evil adjacent pairs. The Chef ability is about ALL pairs in the circle, not just the Chef's neighbors.
- **Fix:** Clarified the Chef info delivery string to explicitly say "anywhere in the seating circle (this is about the whole circle, not just your neighbours)."
- **Status:** FIXED

### A3. Agents vote against their own nominations

- **Severity:** Cosmetic
- **Games:** `6a6555484944` (seat 0), `e6588e9e039a` (seat 1)
- **Description:** Agents nominate a player then vote NO on that same nomination. Behaviorally nonsensical.
- **Status:** WONTFIX — weaker model reasoning issue; not worth over-engineering prompts

### A4. Agents vote YES to execute themselves

- **Severity:** Cosmetic
- **Games:** `e6588e9e039a` (seat 1 voted YES on own execution)
- **Description:** Agent voted to execute itself. Technically legal in BotC but indicates confusion.
- **Status:** WONTFIX — weaker model reasoning issue

### A5. Agent leaks internal reasoning into public speech [MITIGATED]

- **Severity:** Minor
- **Games:** `8aa07259ac16` (seat 0, **claude-opus-4**)
- **Description:** Frontier model produced meta-reasoning ("I need to analyze what just happened") as public speech instead of in-character dialogue.
- **Fix:** Added explicit instruction to SAY tag: "Do NOT include meta-commentary like 'I need to analyze...' — only in-character speech."
- **Status:** MITIGATED

### A6. Imp changes bluff mid-game (inconsistent claims) [MITIGATED]

- **Severity:** Minor
- **Games:** `8aa07259ac16` (seat 0, **claude-opus-4** claimed Washerwoman then Librarian)
- **Description:** Frontier model failed to maintain bluff consistency across turns because MEMORY didn't prompt tracking of own public claims.
- **Fix:** Added instruction to MEMORY tag: "Always record YOUR OWN public claims (what role you claimed, what info you shared). If you change your story later, you WILL be caught in a contradiction."
- **Status:** MITIGATED

### A7. Debrief hallucinations (fabricated game history)

- **Severity:** Cosmetic
- **Games:** `8aa07259ac16` (Butler claimed choosing Fenris as master "for half the days" — game lasted 1 day, chose Ursula)
- **Description:** Agents produce factually incorrect debrief statements. Debrief prompts may not include sufficient actual game history.
- **Status:** WONTFIX — cosmetic, debrief doesn't affect gameplay

---

## Summary

| ID | Category | Severity | Status |
|----|----------|----------|--------|
| E1 | Mayor bounce immunity | Game-breaking | FIXED |
| E2 | Mayor win timing | Moderate | FIXED |
| E3 | Phantom Minstrel effect | Game-breaking | FIXED |
| E4 | Poison on Poisoner death | Moderate | FIXED |
| E5 | Wrong Empath count | Game-breaking | FIXED (by E3) |
| E6 | Butler master not updated | Moderate | FIXED |
| E7 | Ghost vote before Butler check | Moderate | FIXED |
| E8 | Poison persists after no-target | Minor | FIXED |
| V1 | Dead player NO votes | Cosmetic | FIXED |
| V2 | vote.cast before Butler block | Minor | FIXED |
| D1 | initial_state is final state | Moderate | FIXED |
| D2 | Missing initial_role/model | Minor | FIXED |
| D3 | Missing first-night events | Minor | OPEN (legacy) |
| D4 | Legacy log format gaps | Minor | OPEN (legacy) |
| D5 | Dead player night action event | Cosmetic | WONTFIX |
| A1 | Hallucinated player names | Moderate | MITIGATED |
| A2 | Chef info misinterpreted | Minor | FIXED |
| A3 | Vote against own nomination | Cosmetic | WONTFIX (mini only) |
| A4 | Vote to execute self | Cosmetic | WONTFIX (mini only) |
| A5 | Internal reasoning leaked | Minor | MITIGATED |
| A6 | Inconsistent Imp bluffs | Minor | MITIGATED |
| A7 | Debrief hallucinations | Cosmetic | WONTFIX |
