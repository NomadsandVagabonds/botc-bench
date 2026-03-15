---
id: TASK-002
title: "Medieval Name Bank"
status: review
priority: high
assignee: "agent-2"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T14:00:00Z
blocked_by: []
blocks: []
tags: [backend, frontend, immersion]
complexity: M
branch: "main"
files_touched:
  - backend/botc/scripts/data/names.json
  - backend/botc/engine/types.py
  - backend/botc/engine/setup.py
  - backend/botc/engine/state.py
  - backend/botc/llm/prompt_builder.py
  - backend/botc/comms/context_manager.py
  - backend/botc/orchestrator/game_runner.py
  - frontend/src/types/game.ts
  - frontend/src/hooks/useWebSocket.ts
  - frontend/src/stores/gameStore.ts
  - frontend/src/components/game/TownMap.tsx
  - frontend/src/components/game/ConversationPanel.tsx
  - frontend/src/components/game/PlayerDetailDrawer.tsx
  - frontend/src/components/game/VotingOverlay.tsx
---

## Objective

Add a bank of 100+ medieval/fantasy character names so agents see character names instead of model identifiers. "Aldric accused Elara of being the Imp" is much more immersive than "Claude-0 accused GPT-2 of being the Imp."

## Context

Currently agents are identified by their `agent_id` which is something like "Claude-0", "GPT-3", "Gemini-5". This breaks immersion and also leaks model identity information to agents (relevant for the `reveal_models` flag in TASK-009).

Names should be assigned during game setup, stored on the Player object, and used consistently in all prompts and frontend display.

## Acceptance Criteria

- [x] Name bank of 100+ medieval/fantasy names exists as data (JSON file or Python list)
- [x] Names are varied: mix of male, female, and gender-neutral medieval names. No "the Bold" epithets — just first names for simplicity
- [x] Names are assigned to players during `setup.py` game initialization, using the seeded RNG for reproducibility
- [x] `Player` dataclass in `types.py` has a `character_name` field
- [x] All agent prompts use `character_name` instead of `agent_id` when referring to players
- [x] `prompt_builder.py` uses character names in the game state section and when listing players
- [x] Frontend displays character names on sprites, in conversation panel, in player drawer, and in voting overlay
- [x] Frontend still shows the model/provider info somewhere (e.g., smaller text or tooltip) for observer reference
- [x] The `agent_id` still exists for internal tracking — character_name is display only
- [x] Names don't repeat within a single game

## Implementation Notes

- Good medieval name sources: English, French, Germanic, Celtic, Norse — keep them pronounceable
- Examples: Aldric, Elara, Godwin, Isolde, Leofric, Maren, Oswin, Rowena, Theron, Wynn
- Store as `backend/botc/scripts/data/names.json` alongside `trouble_brewing.json`
- Use `state.rng.sample(names, num_players)` for deterministic assignment
- Frontend: character name should be the primary display, model name secondary (small, dimmed, or tooltip)
- In the conversation panel, messages should show character name with a small provider-colored dot

## Files to Reference

- `backend/botc/engine/types.py` — Player dataclass
- `backend/botc/engine/setup.py` — game initialization
- `backend/botc/llm/prompt_builder.py` — prompt construction
- `backend/botc/comms/context_manager.py` — message context building
- `frontend/src/components/game/TownMap.tsx` — sprite labels
- `frontend/src/components/game/ConversationPanel.tsx` — message sender display
- `frontend/src/components/game/PlayerDetailDrawer.tsx` — player info panel
- `frontend/src/components/game/VotingOverlay.tsx` — voter display
- `frontend/src/stores/gameStore.ts` — player state
- `frontend/src/types/game.ts` — Player type

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T14:00:00Z | agent-2 | claimed | Started implementation |
| 2026-03-14T14:00:00Z | agent-2 | completed | Created 120-name bank (English, French, Germanic, Celtic, Norse). Added character_name to Player dataclass. Updated setup.py with seeded RNG assignment. Updated all backend prompts (prompt_builder, context_manager, game_runner). Updated frontend Player type, WebSocket parser, gameStore, TownMap, ConversationPanel, PlayerDetailDrawer, VotingOverlay. Model/provider shown as secondary text. All 40 tests pass. |
