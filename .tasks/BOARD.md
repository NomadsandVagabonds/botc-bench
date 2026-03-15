# Task Board: BotC Bench Roadmap

> 11-task roadmap for game feel, frontend polish, prompt quality, and observer mode improvements.

## Overview

- **Total tasks**: 11
- **Status**: In Progress
- **Base branch**: main
- **Created**: 2026-03-14T12:00:00Z

## Legend

| Symbol | Status |
|--------|--------|
| . | pending |
| ~ | blocked |
| → | claimed |
| ▶ | in_progress |
| ⏸ | changes_requested |
| ✓ | review |
| ✔ | done |
| ✗ | cancelled |

## Tasks

| ID | Title | Status | Priority | Assignee | Blocked By |
|----|-------|--------|----------|----------|------------|
| TASK-001 | Post-Game Debrief System | . | high | | |
| TASK-002 | Medieval Name Bank | ✓ | high | agent-2 | |
| TASK-003 | Accusation & Defense Speeches | ✓ | high | agent-3 | |
| TASK-004 | Accordion Conversation Timeline | ✓ | medium | agent-4 | |
| TASK-005 | Late WebSocket Connect History | ✓ | medium | agent-5 | |
| TASK-006 | Fix Private Reasoning Accumulation | ✓ | medium | agent-4 | |
| TASK-007 | Clearer Game State Format | ✓ | medium | agent-6 | |
| TASK-008 | Clarify Death Rules in Prompts | ✓ | medium | agent-6 | |
| TASK-009 | reveal_models Flag | ✓ | medium | agent-6 | |
| TASK-010 | Night Action Log (Observer) | ✓ | low | agent-7 | |
| TASK-011 | Death Details in Player Drawer | ✓ | low | agent-7 | |

## Agent Assignments

| Agent | Tasks | Focus Area |
|-------|-------|------------|
| agent-1 | TASK-001 | Post-game debrief (backend + frontend) |
| agent-2 | TASK-002 | Medieval name bank (backend + frontend) |
| agent-3 | TASK-003 | Accusation & defense speeches (backend + frontend) |
| agent-4 | TASK-004, TASK-006 | Frontend polish (conversation panel + reasoning fix) |
| agent-5 | TASK-005 | Late WebSocket connect (backend + frontend) |
| agent-6 | TASK-007, TASK-008, TASK-009 | Prompt quality (all prompt_builder.py changes) |
| agent-7 | TASK-010, TASK-011 | Observer mode depth (night log + death details) |

## Notes

- Tasks are grouped by file overlap to minimize merge conflicts
- Each agent works in an isolated worktree
- All agents use Opus model
- prompt_builder.py tasks (7, 8, 9) are grouped under one agent to avoid conflicts
