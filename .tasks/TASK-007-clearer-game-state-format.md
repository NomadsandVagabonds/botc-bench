---
id: TASK-007
title: "Clearer Game State Format in Prompts"
status: review
priority: medium
assignee: "agent-6"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T13:30:00Z
blocked_by: []
blocks: []
tags: [backend, prompts, quality]
complexity: S
branch: ""
files_touched: ["backend/botc/comms/context_manager.py"]
---

## Objective

Improve the game state section of agent prompts to have separate alive/dead player lists, clearer formatting, and better information hierarchy.

## Context

Currently the game state in prompts may list all players in one block without clearly separating alive from dead, making it harder for agents to quickly assess the game situation. A clearer format helps agents make better decisions.

## Acceptance Criteria

- [x] Game state section clearly separates alive players and dead players into two distinct lists
- [x] Each player entry shows: seat number, name, alive/dead status
- [x] For the agent's own view: show known information (role claims, suspicious behavior, etc.)
- [x] Dead players show how many ghost votes they have remaining (0 or 1)
- [x] Current day number and phase are prominently shown
- [x] Recent executions and deaths are summarized
- [x] The format is clean and scannable — not a wall of text

## Implementation Notes

- Modify `prompt_builder.py` game state section
- May also need to adjust `context_manager.py` if it builds part of the state view
- Test with a sample game state to make sure it reads well
- Keep token count reasonable — clarity shouldn't come at the cost of 2x more tokens

## Files to Reference

- `backend/botc/llm/prompt_builder.py` — game state in prompts
- `backend/botc/comms/context_manager.py` — context building

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T13:30:00Z | agent-6 | completed | Restructured build_game_state_summary in context_manager.py: separate ALIVE/DEAD sections, prominent day/phase header, ghost vote status, recent execution/death summaries, alive/dead count |
