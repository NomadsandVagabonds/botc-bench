---
id: TASK-009
title: "reveal_models Flag"
status: review
priority: medium
assignee: "agent-6"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T13:30:00Z
blocked_by: []
blocks: []
tags: [backend, config, benchmark]
complexity: S
branch: ""
files_touched: ["backend/botc/engine/types.py", "backend/botc/comms/context_manager.py", "backend/botc/api/routes.py", "backend/botc/orchestrator/game_runner.py"]
---

## Objective

Add a `reveal_models` boolean to GameConfig. When False, agents don't see which LLM provider/model other players are using in their prompts. When True, they do. This enables controlled A/B benchmark comparison — does knowing you're playing against GPT vs Claude change behavior?

## Context

Currently agents can see model information about other players in their prompts. For benchmark purposes, we want to be able to run games where agents don't know what models other players are running. This is important for studying whether model-awareness affects social behavior.

## Acceptance Criteria

- [x] `reveal_models` boolean field added to `GameConfig` in `types.py` (default: True for backward compatibility)
- [x] When `reveal_models=False`, agent prompts do NOT include model/provider info for other players
- [x] When `reveal_models=True`, behavior is unchanged (agents see model info as they do now)
- [x] The flag is exposed in the API — `CreateGameRequest` and quick game endpoint
- [x] Player lists in prompts show only character name + seat when models are hidden
- [x] The agent can still see its OWN model info (it knows what it is)

## Implementation Notes

- Modify `GameConfig` in `types.py`
- Modify `prompt_builder.py` to conditionally include/exclude model info based on the flag
- May need to adjust `context_manager.py` if it includes model info in context
- Update `routes.py` request models to accept the flag
- This pairs well with TASK-002 (medieval names) — when names are used and models hidden, agents only see character names

## Files to Reference

- `backend/botc/engine/types.py` — GameConfig
- `backend/botc/llm/prompt_builder.py` — prompt construction
- `backend/botc/comms/context_manager.py` — context building
- `backend/botc/api/routes.py` — API request models

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T13:30:00Z | agent-6 | completed | Added reveal_models to GameConfig (default True), Player.model_name field, game_runner sets model_name during setup, context_manager conditionally shows model tags (always for self, others only when reveal=True), routes.py accepts flag in CreateGameRequest and quick_game |
