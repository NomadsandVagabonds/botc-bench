# Known Bugs — BotC Engine

Audit performed 2026-03-22 across all 12 game logs and code review of TB/BMR/S&V implementations.

## Fixed (this session)

| Bug | Fix | File |
|-----|-----|------|
| Imp can target dead players — generates duplicate death events | Added `if not target.is_alive: return []` guard | `abilities.py:326` |
| Imp can skip night kill when LLM returns no target | Force random alive target if Demon has no action | `game_runner.py:580` |
| Virgin kill emits no death/execution events | Emit `execution`, `death` events + death notification | `game_runner.py:870` |
| Scarlet Woman threshold counts post-death (N-1) | Count `alive_players + 1` to include dying Demon | `abilities.py:1578` |
| Scarlet Woman hardcodes `script.roles["imp"]` | Use dead demon's actual role; crashes in BMR/S&V | `abilities.py:1604` |
| Witch curse kills on 3 alive (should be exempt) | Added `len(state.alive_players) > 3` guard | `day.py:47` |
| Barber swap changes alignment (should only swap roles) | Removed alignment reassignment | `abilities.py:177` |
| Pukka poison persists after Pukka dies | Added cleanup in `on_player_death` | `abilities.py:203` |
| Philosopher drunk persists after Philosopher dies | Added cleanup in `on_player_death` with source tracking | `abilities.py:203` |

---

## Cross-Script Architectural Bugs

### HIGH: Invisible night deaths (Assassin, Gambler, Moonchild)
Deaths from these roles bypass the `deaths` list in `resolve_night()`. The player dies (state is correct) but gets no death announcement, narration, or frontend notification. Fix: collect all deaths that occur during night resolution, not just demon kills.
- **Files:** `night.py:219` (only tracks demon kills + Godfather), `abilities.py:945` (Assassin), `abilities.py:846` (Gambler), `abilities.py:211` (Moonchild)

### MEDIUM: Ravenkeeper doesn't trigger on non-demon night deaths
Ravenkeeper death ability is only checked inside the demon kill loop in `night.py:168-176`. If killed by Assassin, Gambler, or Moonchild, the Ravenkeeper silently loses their ability.
- **File:** `night.py:168-176`

### MEDIUM: Philosopher overwrites role entirely
`resolve_philosopher` sets `player.role = chosen_role`, losing the Philosopher identity. Should grant the ability while remaining a Philosopher. Also missing red herring setup if gaining Fortune Teller.
- **File:** `abilities.py:1415`

### LOW: Role swap functions don't transfer/clear hidden_state
Snake Charmer swap, Pit-Hag role change, and Barber swap don't handle hidden_state. Stale state (e.g., `fang_gu_jumped`, `red_herring`, `butler_master`) can leak to the wrong player.
- **Files:** `abilities.py:1282` (Snake Charmer), `abilities.py:1471` (Pit-Hag), `abilities.py:177` (Barber)

---

## Bad Moon Rising Bugs

### CRITICAL: Zombuul mechanic fundamentally broken
The "appears dead but keeps playing" mechanic isn't implemented. `survives_execution` publicly reveals survival. If marked `is_alive=False` to appear dead, the Zombuul can't act at night (`_can_act_at_night` skips dead non-Vigormortis players) and `_check_demon_dead` triggers instant Good win. Needs an `is_apparently_dead` concept.
- **Files:** `abilities.py:262`, `night.py:50-57`, `win_conditions.py:70`

### CRITICAL: Pukka missing from first night
No `first_night_order` in JSON, not in `FIRST_NIGHT_ACTION_ABILITIES`. First poison never happens on Night 1.
- **Files:** `bad_moon_rising.json`, `abilities.py` dispatch tables

### CRITICAL: Godfather trigger condition is wrong
Code checks if an **Outsider** was executed. Rule says bonus kill triggers when **no one died today** (no execution, or execution was survived).
- **File:** `abilities.py:1055-1060`

### CRITICAL: Mastermind extra day win condition wrong
Code only checks if no execution occurs. Rule says evil wins if no **good player** is executed — executing an evil player on the extra day should still let evil win.
- **File:** `win_conditions.py:88-94`

### SIGNIFICANT: Completely unimplemented roles
- **Gossip** — no code at all
- **Tinker** — no code at all
- **Goon** — `goon_drunk_until_day` referenced in `refresh_script_poisoning` but never set

### SIGNIFICANT: Lunatic only has setup
Perceived role is set but: no fake night interaction, no fake Minion info on Night 1, Demon never learns Lunatic's choices. The `is_drunk` check in `night.py:77` doesn't match Lunatic (only matches `role.id == "drunk"`).
- **Files:** `setup.py:94-97`, `night.py:77`, `types.py:225`

### SIGNIFICANT: Devil's Advocate poisoned check on wrong player
`survives_execution` checks `target.is_poisoned` but should check whether the **Devil's Advocate** was poisoned when they chose. The DA's own `resolve` function correctly checks `should_malfunction(actor)`, but the execution-time check adds an incorrect check on the target.
- **File:** `abilities.py:269`

### MODERATE: Moonchild auto-picks target, kills immediately
Rule says Moonchild player chooses target, death happens "tonight." Code picks randomly and kills in `on_player_death` (instantly).
- **File:** `abilities.py:204-215`

### MODERATE: Pukka delayed kill checks protections it shouldn't
Calls `_resolve_standard_demon_kill` which checks Soldier/Monk/Mayor protections. The delayed poison death shouldn't be blockable by these.
- **File:** `abilities.py:984`

### MODERATE: Zombuul night kill condition checks execution, not death
`if state.executed_today is not None: return []` — should check if someone actually **died**, not just if an execution occurred (execution can be survived).
- **File:** `abilities.py:1031`

### MODERATE: Chambermaid uses wrong night order on first night
Always checks `other_nights_order` even on Night 1. Roles with `first_night_order` but no `other_nights_order` (e.g., Grandmother) are missed.
- **File:** `abilities.py:782`

### MODERATE: Sailor self-target is a no-op
If Sailor targets self, ability does nothing. Should make Sailor drunk. Also, non-demon death sources bypass Sailor immunity.
- **File:** `abilities.py:761`

### MODERATE: Exorcist/Innkeeper have no "different from last night" enforcement
Both store previous target but never validate against it.
- **Files:** `abilities.py:804` (Exorcist), `abilities.py` (Innkeeper)

### MODERATE: Shabaloth resurrection pool based on deaths, not targets
Should include targeted-but-protected players as resurrection candidates.
- **File:** `abilities.py:1002`

### MODERATE: Professor resurrection has no notification and doesn't reset ghost_vote_used
- **File:** `abilities.py:890`

### MODERATE: Grandmother malfunction sets wrong info text but correct hidden grandchild link
Poisoned Grandmother still has correct death trigger.
- **File:** `abilities.py:739`

### MINOR: First night order errors
Exorcist, Gambler, Innkeeper registered in `FIRST_NIGHT_ACTION_ABILITIES` but rules say "Each night*" (not first night). JSON data also incorrectly has `first_night_order` values for these.
- **File:** `abilities.py` dispatch tables, `bad_moon_rising.json`

---

## Sects & Violets Bugs

### MAJOR: No Dashii poisons wrong neighbors
Poisons immediate seat neighbors (`seat ± 1`). Should find nearest **Townsfolk** in each direction, skipping non-Townsfolk roles.
- **File:** `abilities.py:135-139`

### MAJOR: Vigormortis missing neighbor poisoning
When Vigormortis kills a Minion, the Minion keeps their ability (`vigormortis_keeps_ability = True`) but the **Townsfolk neighbor poisoning** is completely absent.
- **File:** `abilities.py:657-663`

### MAJOR: Vigormortis setup modifier is random ±1 instead of -1
Should be `-1 Outsider` specifically, not a random coin flip.
- **File:** `setup.py:166-168`

### MAJOR: Snake Charmer doesn't poison former Demon
After swap, the former Demon (now Snake Charmer) should be poisoned. Code only swaps roles and alignments.
- **File:** `abilities.py:1282-1288`

### MAJOR: Klutz auto-picks player
Engine randomly chooses instead of letting the Klutz agent decide. Removes all player agency.
- **File:** `abilities.py:185-195`

### MODERATE: Cerenovus madness never enforced
`cerenovus_mad_role` and `cerenovus_day` stored in hidden_state but never checked during day phases.
- **File:** `abilities.py:1436-1438`

### MODERATE: Pit-Hag `pit_hag_created_demon_tonight` flag never consumed
Flag is set but never checked during night resolution. New demon could act the same night.
- **File:** `abilities.py:1474-1475`

### MODERATE: Flowergirl/Town Crier/Oracle in first night dispatch
All three are "each night*" abilities but registered in `FIRST_NIGHT_INFO_ABILITIES`. On first night, they return trivially empty info.
- **File:** `abilities.py:1623-1625`

### MODERATE: Flowergirl counts NO votes as "voted"
Checks both `votes_for` and `votes_against`. BotC "voted" typically means YES only.
- **File:** `abilities.py:1313`

### MODERATE: Mathematician counts poisoned players, not malfunctioned abilities
Approximation — counts players currently drunk/poisoned, not abilities that actually malfunctioned.
- **File:** `abilities.py:1293-1296`

### MODERATE: Mutant madness not mechanically enforceable
Acceptable limitation for automated benchmark.

### LOW: Setup validation (`_resolve_assigned_roles`) ignores Godfather/Fang Gu/Vigormortis outsider modifiers
Only accounts for Baron (+2 Outsiders).
- **File:** `setup.py:253-277`

---

## Pre-existing Test Issues

### Integration tests fail on unmodified code
`test_integration.py:69` — mock LLM provider receives `list` for `context` parameter but calls `.lower()` on it. Fails with `'list' object has no attribute 'lower'`. This is a test mock issue, not an engine bug.
