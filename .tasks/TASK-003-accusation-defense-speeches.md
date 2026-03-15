---
id: TASK-003
title: "Accusation & Defense Speeches"
status: review
priority: high
assignee: "agent-3"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T15:00:00Z
blocked_by: []
blocks: []
tags: [backend, frontend, game-feel, llm]
complexity: M
branch: "main"
files_touched:
  - backend/botc/engine/types.py
  - backend/botc/llm/prompt_builder.py
  - backend/botc/orchestrator/game_runner.py
  - backend/botc/comms/context_manager.py
  - frontend/src/types/game.ts
  - frontend/src/components/game/ConversationPanel.tsx
---

## Objective

Add accusation and defense speeches to the nomination flow. When a player nominates someone, the nominator gives an accusation speech and the nominee gives a defense speech before voting begins. This is a core BotC mechanic that's currently missing.

## Context

The current nomination flow in `game_runner.py` is: nominate → immediate vote → resolve. In real BotC, nominations include speeches: the nominator makes their case ("I think Seat 3 is the Imp because...") and the nominee defends themselves ("I'm the Empath and here's what I've seen..."). This is crucial for the social deduction aspect.

## Acceptance Criteria

- [x] After a nomination is made, the nominator is prompted to give an accusation speech (LLM call)
- [x] After the accusation, the nominee is prompted to give a defense speech (LLM call)
- [x] Both speeches are broadcast as public messages visible to all players
- [x] Speeches have a dedicated message type (e.g., `accusation` and `defense`) so the frontend can style them distinctly
- [x] The accusation prompt includes context: who they nominated, why they might be suspicious
- [x] The defense prompt includes context: who accused them, what the accusation said
- [x] Speeches appear in the conversation panel with distinct styling (maybe a gavel icon for accusation, shield for defense)
- [x] Other agents receive these speeches before they vote (they're included in the voting prompt context)
- [x] Speech length is reasonable (maybe 100-150 max tokens)

## Implementation Notes

- Add to the nomination flow in `game_runner.py` between nomination and voting
- New message types in `types.py`: `MessageType.ACCUSATION` and `MessageType.DEFENSE`
- New prompt functions in `prompt_builder.py`: `build_accusation_prompt()` and `build_defense_prompt()`
- The accusation should run first, then defense gets the accusation content as context
- These are sequential (not parallel) — accusation must complete before defense starts
- Include speech content in the voting prompt so other agents can factor it in
- Frontend: style these messages distinctly in ConversationPanel — they're dramatic moments

## Files to Reference

- `backend/botc/orchestrator/game_runner.py` — nomination flow (search for nomination handling)
- `backend/botc/engine/day.py` — nomination/voting logic
- `backend/botc/engine/types.py` — MessageType enum, Message dataclass
- `backend/botc/llm/prompt_builder.py` — prompt patterns
- `frontend/src/stores/gameStore.ts` — message handling
- `frontend/src/components/game/ConversationPanel.tsx` — message display
- `frontend/src/types/game.ts` — message types

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T15:00:00Z | agent-3 | claimed | Claimed task, read all source files |
| 2026-03-14T15:00:00Z | agent-3 | completed | All acceptance criteria met. Backend: added ACCUSATION/DEFENSE MessageTypes, build_accusation_prompt/build_defense_prompt in prompt_builder, _get_speech method in game_runner inserted between nomination and voting. Frontend: updated MessageType const, added distinct styling with colored left borders, gavel/shield icons, and background highlights. All 40 backend tests pass, TypeScript compiles clean. |
