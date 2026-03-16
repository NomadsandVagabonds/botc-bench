# Breakout Group Formation — Issues to Fix

## Problem Observed
All agents clustering into one or two breakout groups instead of spreading across 3-4 groups. Group B exists but is empty or has only 1-2 players while Group A has 5+.

## Root Causes

### 1. Group count is demand-driven, not pre-seeded
Currently `_distribute_floaters()` creates `n_groups = min(max_groups, len(floaters) // min_size)` groups. This means if agents don't express preferences, the number of groups is derived from math — not guaranteed to be `max_groups`.

**Fix:** Always create `max_groups` groups (e.g. 4), then distribute players across them. The groups should exist as options regardless of demand.

### 2. No per-group size cap enforced during distribution
The 1/3 rule (`max_per_group = len(all_seats) // 3`) is applied to *requested* groups (line 80-87) but the floater distribution (line 144-146) just dumps into the smallest group with no cap. So if everyone floats, round-robin works OK, but if 5 people request the same group and 2 float, the 5-person group gets split to ~2 and the rest become floaters who get dumped into whatever bucket is smallest — potentially recreating the mega-group.

**Fix:** During floater distribution, enforce `max_per_group` cap. If the smallest group is already at cap, skip to the next smallest or create a new group (up to `max_groups`).

### 3. Macbeth speech style may suppress action parsing
The strong speech style prompt ("speak exclusively in Shakespearean iambic pentameter") may cause agents to skip the `{JOIN: label}` / `{CREATE_GROUP}` action in favor of more verse. When no action is parsed, the agent becomes a floater. If ALL agents do this, everyone floats and the distribution algorithm decides.

**Fix:** This is lower priority — the distribution algorithm should handle all-floaters correctly (spread evenly across `max_groups` groups). Fix #1 and #2 first.

## Desired Behavior
- Always present **at least 4 group options** (A, B, C, D) for agents to choose from — groups don't need to be filled, just available as choices
- Groups with 0 members after preferences are resolved simply don't run (no empty group conversations)
- No single group can have more than 1/3 of total players — overflow gets redistributed to other groups
- Floaters are distributed evenly across groups that have room
- If an agent's JOIN target is full (1/3 cap), they go to the smallest available group
- Agents can still `{CREATE_GROUP}` to make a new group beyond the 4 defaults (up to `max_groups` ceiling)
- The key distinction: `max_groups` is a **ceiling** on how many groups can exist, but `min_group_options` (new field or just hardcode 4) is the **floor** on how many are presented as default choices

## Files to Change
- `backend/botc/comms/group_manager.py` — `create_groups()` and `_distribute_floaters()`
- Possibly `backend/botc/engine/types.py` — add `min_group_options` to `BreakoutConfig` if we want it configurable
