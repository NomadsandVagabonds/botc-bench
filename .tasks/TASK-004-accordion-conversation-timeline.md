---
id: TASK-004
title: "Accordion Conversation Timeline"
status: review
priority: medium
assignee: "agent-4"
created: 2026-03-14T12:00:00Z
updated: 2026-03-14T14:00:00Z
blocked_by: []
blocks: []
tags: [frontend, ux, conversation]
complexity: M
branch: ""
files_touched:
  - frontend/src/components/game/ConversationPanel.tsx
  - frontend/src/stores/gameStore.ts
  - frontend/src/types/game.ts
  - frontend/src/hooks/useWebSocket.ts
---

## Objective

Refactor the ConversationPanel to organize messages into collapsible accordion sections by phase. Instead of one long scrolling list, messages are grouped under headers like "Day 1 — Discussion", "Day 1 — Breakout Round 1", "Day 1 — Nominations", "Night 1", etc.

## Context

As games progress, the conversation panel becomes a very long scroll of messages with no structure. It's hard to find specific moments or understand the flow. Accordion sections with phase headers would make the timeline navigable and give a sense of game progression.

## Acceptance Criteria

- [x] Messages in the Public tab are grouped by phase sections (day + phase combination)
- [x] Each section has a collapsible header showing: phase name, day number, message count
- [x] Section headers are styled distinctly (e.g., slightly different background, bold text)
- [x] The most recent (current) phase section is expanded by default
- [x] Previous phase sections are collapsed by default but can be expanded by clicking
- [x] Breakout group tabs still work — but within each tab, messages are also grouped by round
- [x] Smooth expand/collapse animation (use framer-motion, already installed)
- [x] Auto-scroll still works — scrolls to bottom of the latest expanded section
- [x] Phase section headers show the phase type with appropriate icons or colors
- [x] Night sections have a darker background tint to match the night theme

## Implementation Notes

- Group messages by `(dayNumber, phase)` tuples from the message metadata
- The gameStore already tracks phase changes via `phase.change` events — use this to create section boundaries
- Consider adding a `phase` and `dayNumber` field to messages in the store if not already present
- Use framer-motion `AnimatePresence` + `motion.div` for accordion animation
- Keep the "Scroll to bottom" button functional
- Section order should be chronological (oldest at top)

## Files to Reference

- `frontend/src/components/game/ConversationPanel.tsx` — current implementation
- `frontend/src/stores/gameStore.ts` — message storage, phase tracking
- `frontend/src/types/game.ts` — Message type definition

## Status Log

| Timestamp | Agent | Action | Notes |
|-----------|-------|--------|-------|
| 2026-03-14T12:00:00Z | orchestrator | created | Initial task creation |
| 2026-03-14T14:00:00Z | agent-4 | completed | Added phase/dayNumber to Message type, stamped all messages in store, refactored ConversationPanel with accordion sections using framer-motion AnimatePresence, phase icons, night tint, auto-expand latest section |
