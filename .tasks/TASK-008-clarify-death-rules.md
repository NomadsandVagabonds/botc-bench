---
id: TASK-008
title: "Clarify Death Rules in Prompts"
status: review
priority: medium
assignee: "agent-6"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T13:30:00Z
blocked_by: []
blocks: []
tags: [backend, prompts, rules]
complexity: S
branch: ""
files_touched: ["backend/botc/llm/prompt_builder.py"]
---

## Objective

Add clear instructions in the system prompt that dead players' roles are NEVER revealed in Blood on the Clocktower. This is a critical rule difference from Mafia/Werewolf that LLMs often get wrong because they've been trained on Mafia rules.

## Context

In Mafia/Werewolf, when a player dies their role is revealed. In BotC, dead players' roles stay hidden. LLM agents frequently assume roles are revealed on death (because of Mafia training data) and make incorrect inferences. We need to explicitly state this rule.

## Acceptance Criteria

- [x] System prompt explicitly states: "When a player dies, their role is NOT revealed. Dead players' roles remain hidden."
- [x] The rule is stated near the top of the rules section, not buried
- [x] Include a note like: "Unlike Mafia or Werewolf, BotC keeps dead players' roles secret. Do not assume you know a dead player's role unless you have ability information."
- [x] Also clarify: dead players can still speak (briefly) and have one ghost vote
- [x] The ghost vote mechanic is clearly explained: each dead player gets exactly 1 ghost vote for the rest of the game, once used it's gone

## Implementation Notes

- Modify the rules/instructions section of `prompt_builder.py`
- Keep it concise but unambiguous
- Consider adding it to the "Key Rules" section if one exists, or create a prominent rules block

## Files to Reference

- `backend/botc/llm/prompt_builder.py` — system prompt construction

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T13:30:00Z | agent-6 | completed | Added KEY RULES section to system prompt in prompt_builder.py, placed before GAME PHASES. Explicitly states roles not revealed on death, Mafia/Werewolf distinction, dead player participation rules, ghost vote mechanic. Also updated VOTING phase description. |
