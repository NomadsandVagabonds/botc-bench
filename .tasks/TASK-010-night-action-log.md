---
id: TASK-010
title: "Night Action Log (Observer Mode)"
status: review
priority: low
assignee: "agent-7"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T23:30:00Z
blocked_by: []
blocks: []
tags: [backend, frontend, observer]
complexity: M
branch: "main"
files_touched:
  - backend/botc/orchestrator/game_runner.py
  - frontend/src/types/events.ts
  - frontend/src/types/game.ts
  - frontend/src/stores/gameStore.ts
  - frontend/src/hooks/useWebSocket.ts
  - frontend/src/components/game/GameLog.tsx
---

## Objective

In observer mode, show a log of night abilities resolving in real-time. "Poisoner targets Seat 3", "Monk protects Seat 7", "Imp kills Seat 5". This lets observers understand what's happening during the night phase.

## Context

Currently the night phase is a black box — the overlay says "Night falls on the village..." but you can't see what's happening. For an observer/benchmark tool, seeing the night actions is crucial for understanding game dynamics.

## Acceptance Criteria

- [x] Backend emits `night.action` WebSocket events as each night ability resolves
- [x] Each event includes: acting player (seat + name), ability name, target(s), result/effect
- [x] Events are emitted in night order (Poisoner first, then Monk, then Imp, etc.)
- [x] Frontend receives and stores night action events in the game store
- [x] Observer mode shows night actions in the GameLog component as they resolve
- [x] Night actions are styled distinctly — perhaps with a moon icon and dark/purple theme
- [x] Night actions are ONLY visible in observer mode (they contain hidden information)
- [x] Actions that produce no effect (e.g., Monk protects someone who isn't attacked) still show up

## Implementation Notes

- Add event emission in `night.py` or `game_runner.py` during night resolution
- New event type: `night.action` with data like `{seat: 3, role: "poisoner", action: "poison", target: 5}`
- Frontend GameLog already has category-based filtering — add a "night" category
- Only show in observer mode — check the observer toggle state
- Consider showing these in the night overlay area on the TownMap as well (subtle text appearing)

## Files to Reference

- `backend/botc/engine/night.py` — night resolution logic
- `backend/botc/orchestrator/game_runner.py` — night phase orchestration
- `frontend/src/components/game/GameLog.tsx` — event log display
- `frontend/src/stores/gameStore.ts` — event handling
- `frontend/src/types/events.ts` — event types

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T23:30:00Z | agent-7 | completed | Implemented _emit_night_actions in game_runner.py, NightActionEvent in events.ts, nightActions store in gameStore.ts, night.action normalization in useWebSocket.ts, and moon-icon purple-styled entries in GameLog.tsx (observer-only) |
