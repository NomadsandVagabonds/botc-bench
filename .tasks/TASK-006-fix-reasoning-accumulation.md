---
id: TASK-006
title: "Fix Private Reasoning Accumulation"
status: review
priority: medium
assignee: "agent-4"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T14:00:00Z
blocked_by: []
blocks: []
tags: [frontend, bugfix, observer]
complexity: S
branch: ""
files_touched:
  - frontend/src/stores/gameStore.ts
  - frontend/src/components/game/PlayerDetailDrawer.tsx
  - frontend/src/hooks/useWebSocket.ts
---

## Objective

Fix the bug where private reasoning from agent `<THINK>` tags is not accumulating correctly in the PlayerDetailDrawer. Each turn's reasoning should append to a scrollable feed.

## Context

When agents respond, they include `<THINK>` tags with their private reasoning. This is parsed by the backend and broadcast as `player.reasoning` events. The frontend should accumulate these in the player's reasoning feed shown in the PlayerDetailDrawer. Currently this is broken — either showing only the latest reasoning, not showing any, or overwriting previous entries.

## Acceptance Criteria

- [x] Private reasoning from each turn accumulates in the player's reasoning feed (not just latest)
- [x] Each reasoning entry shows which phase/day it's from
- [x] The reasoning feed is scrollable and shows entries in chronological order
- [x] New reasoning entries appear at the bottom (most recent last)
- [x] Clicking a player sprite opens the drawer with their full reasoning history
- [x] Reasoning is only visible in observer mode (not in potential future player mode)

## Implementation Notes

- Check `gameStore.ts` for how `player.reasoning` events are handled — likely overwriting instead of appending
- Check `PlayerDetailDrawer.tsx` for how reasoning is rendered
- Check `game_runner.py` for what data the `player.reasoning` event contains
- The fix is likely in the store — need to accumulate reasoning as an array, not replace it
- Each entry should include: phase, day number, and the reasoning text

## Files to Reference

- `frontend/src/stores/gameStore.ts` — event handling for `player.reasoning`
- `frontend/src/components/game/PlayerDetailDrawer.tsx` — reasoning display
- `frontend/src/types/events.ts` — event type definition
- `backend/botc/orchestrator/game_runner.py` — reasoning event emission

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T14:00:00Z | agent-4 | completed | Changed playerReasoning from Record<number, string> to Record<number, ReasoningEntry[]>. Each entry captures phase, dayNumber, timestamp. Fixed WebSocket normalizer to forward phase from backend. Refactored PlayerDetailDrawer with ReasoningFeed component showing phase labels with color-coded headers, auto-scroll, entry count. |
