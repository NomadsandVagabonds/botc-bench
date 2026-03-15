---
id: TASK-011
title: "Death Details in Player Drawer"
status: review
priority: low
assignee: "agent-7"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T23:30:00Z
blocked_by: []
blocks: []
tags: [backend, frontend, player-info]
complexity: M
branch: "main"
files_touched:
  - backend/botc/engine/types.py
  - backend/botc/engine/day.py
  - backend/botc/engine/abilities.py
  - backend/botc/orchestrator/game_runner.py
  - frontend/src/types/game.ts
  - frontend/src/types/events.ts
  - frontend/src/stores/gameStore.ts
  - frontend/src/hooks/useWebSocket.ts
  - frontend/src/components/game/PlayerDetailDrawer.tsx
---

## Objective

Show how and when a player died in the PlayerDetailDrawer — cause of death (executed, demon kill, Slayer shot), which day, and which phase. This gives observers important context about each player's fate.

## Context

Currently dead players show as dead in the drawer but there's no information about how they died. For benchmark analysis and observation, knowing the cause and timing of death is valuable.

## Acceptance Criteria

- [x] `Player` type (backend + frontend) includes death metadata: cause, day_number, phase
- [x] Death cause is set when a player dies — in execution logic, night kill logic, and Slayer logic
- [x] Cause categories: "executed" (voted out), "demon_kill" (killed by Imp at night), "slayer_shot" (killed by Slayer ability)
- [x] PlayerDetailDrawer shows death info section for dead players: "Died: Day 2 (Executed)" or "Died: Night 3 (Demon Kill)"
- [x] Death info is styled with appropriate iconography (skull, crossed swords, etc. using text/emoji)
- [x] The death event WebSocket message includes cause and timing
- [x] Frontend stores death metadata per player

## Implementation Notes

- Add death metadata fields to `Player` in `types.py`: `death_cause`, `death_day`, `death_phase`
- Set these fields in `day.py` (execution), `night.py` (demon kill), and ability handlers (Slayer)
- Include in the `death` WebSocket event data
- Frontend `gameStore.ts` should store this on the player object when a death event arrives
- `PlayerDetailDrawer.tsx` should display a death info section when the player is dead

## Files to Reference

- `backend/botc/engine/types.py` — Player dataclass
- `backend/botc/engine/day.py` — execution logic
- `backend/botc/engine/night.py` — demon kill logic
- `backend/botc/engine/abilities.py` — Slayer ability
- `frontend/src/components/game/PlayerDetailDrawer.tsx` — player info display
- `frontend/src/stores/gameStore.ts` — player state updates
- `frontend/src/types/game.ts` — Player type

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T23:30:00Z | agent-7 | completed | Added death_cause/death_day/death_phase to Player (types.py), set in day.py, abilities.py (execution, Imp kill, Slayer, Virgin, starpass, Mayor bounce), included in death/execution WebSocket events, stored in frontend gameStore, displayed in PlayerDetailDrawer with icons |
