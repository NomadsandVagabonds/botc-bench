---
id: TASK-001
title: "Post-Game Debrief System"
status: pending
priority: high
assignee: ""
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T12:00:00Z
blocked_by: []
blocks: []
tags: [backend, frontend, game-feel, llm]
complexity: L
branch: ""
files_touched: []
---

## Objective

Add a post-game debrief phase where ALL agents (alive and dead) receive the full Grimoire reveal and get to react. This makes the game ending feel satisfying rather than abrupt, and provides interesting benchmark data about model self-reflection.

## Context

Currently the game ends with a `GAME_OVER` phase and a simple overlay. There's no moment where agents learn the truth and react. In real BotC, the post-game reveal is one of the most entertaining parts — gasps, laughter, "I KNEW IT!" moments.

The backend needs a new `DEBRIEF` phase after `GAME_OVER`, and the frontend needs a debrief UI to show agent reactions alongside the role reveal.

## Acceptance Criteria

- [ ] `DEBRIEF` phase added to `GamePhase` enum in `engine/types.py`
- [ ] Phase machine allows `GAME_OVER → DEBRIEF` transition in `engine/phase_machine.py`
- [ ] `game_runner.py` runs a debrief round after the game ends: prompts ALL agents (alive + dead) with full Grimoire reveal
- [ ] Debrief prompt includes: all roles revealed, all alignments, who was poisoned/drunk, key night actions, who won and why
- [ ] Debrief prompt asks agents to react naturally: surprise, humor, what they'd do differently, memorable moments
- [ ] Agent debrief responses are broadcast as `debrief.message` WebSocket events
- [ ] Frontend `gameStore.ts` handles `debrief.message` events and stores them
- [ ] Frontend `events.ts` has the `debrief.message` event type defined
- [ ] Frontend shows a debrief panel/screen after game over with all agent reactions and the full role reveal table
- [ ] Debrief UI shows each agent's name, role (revealed), alignment, and their reaction text
- [ ] Debrief messages appear in the conversation panel under a "Debrief" tab or section

## Implementation Notes

- The debrief prompt should be built in `prompt_builder.py` — a new function like `build_debrief_prompt()`
- Use the same LLM call pattern as other phases but skip the XML action tags — just ask for a natural response
- The Grimoire data is already available in `GameState` — all player roles, alignments, statuses
- Dead agents should still participate — they have interesting perspectives ("I was the Empath and I was poisoned the whole time!")
- Fire all debrief LLM calls in parallel (same pattern as voting)
- Keep debrief responses short — maybe 150 max tokens
- The frontend debrief should feel like a wrap-up screen, not just another phase

## Files to Reference

- `backend/botc/engine/types.py` — GamePhase enum, Player dataclass
- `backend/botc/engine/phase_machine.py` — phase transitions
- `backend/botc/orchestrator/game_runner.py` — main game loop, see how GAME_OVER is handled
- `backend/botc/llm/prompt_builder.py` — prompt construction patterns
- `backend/botc/api/websocket.py` — WebSocket event broadcasting
- `frontend/src/stores/gameStore.ts` — event handling
- `frontend/src/types/events.ts` — event type definitions
- `frontend/src/components/game/TownMap.tsx` — game over overlay (to augment/replace)
- `frontend/src/components/game/GameView.tsx` — layout

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
