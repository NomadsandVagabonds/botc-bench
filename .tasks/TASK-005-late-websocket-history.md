---
id: TASK-005
title: "Late WebSocket Connect - Message History"
status: review
priority: medium
assignee: "agent-5"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T14:00:00Z
blocked_by: []
blocks: []
tags: [backend, frontend, websocket]
complexity: M
branch: "main"
files_touched:
  - backend/botc/orchestrator/game_runner.py
  - backend/botc/api/routes.py
  - frontend/src/types/events.ts
  - frontend/src/hooks/useWebSocket.ts
  - frontend/src/stores/gameStore.ts
---

## Objective

When a WebSocket client connects to a game already in progress, send the full message history so they can catch up on everything that happened before they connected.

## Context

Currently, when a WebSocket client connects to a running game, they only receive a `game.state` snapshot (current state). All messages that were broadcast before the connection are lost. If you open the UI mid-game, the conversation panel is empty and you have no context for what happened.

## Acceptance Criteria

- [x] When a WebSocket client connects to a running game, it receives all past messages as `message.new` events
- [x] Past messages arrive in chronological order
- [x] Past nominations and voting results are also sent (as `nomination.start`, `vote.cast`, `nomination.result` events)
- [x] Past death events are sent
- [x] The client receives a `game.state` snapshot FIRST, then historical events, then live events
- [x] Historical events are marked somehow so the frontend can distinguish them from live events (e.g., a `historical: true` flag)
- [x] Frontend handles the burst of historical events without performance issues (batch state updates)
- [x] The conversation panel populates correctly with all past messages on late connect
- [x] GameLog populates with past deaths, executions, and phase changes

## Implementation Notes

- The `GameState` already stores all messages in `state.all_messages` — just need to replay them on connect
- In `routes.py` `game_websocket()`, after sending `game.state`, iterate through stored messages and send them
- Consider batching — don't send 500 individual WebSocket frames. Maybe send a `message.history` event with an array
- Frontend `useWebSocket.ts` should handle the `message.history` batch event
- Frontend `gameStore.ts` `applyEvent` should handle bulk message insertion without triggering 500 re-renders
- Also replay: phase changes, nominations, deaths from the game runner's event history
- The game runner should maintain an event log (it may already — check `metrics/event_log.py`)

## Files to Reference

- `backend/botc/api/routes.py` — WebSocket endpoint (`game_websocket`)
- `backend/botc/api/websocket.py` — WebSocket manager
- `backend/botc/engine/state.py` — `snapshot_observer()` function
- `backend/botc/engine/types.py` — GameState, Message
- `frontend/src/hooks/useWebSocket.ts` — WebSocket connection
- `frontend/src/stores/gameStore.ts` — event application

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T14:00:00Z | agent-5 | completed | Implemented event history replay: GameRunner records all broadcast events in event_history list, WebSocket endpoint sends batch event.history on connect, frontend normalizes and batch-processes history in single state update |
