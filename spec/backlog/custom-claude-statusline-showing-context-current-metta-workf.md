---
slug: custom-claude-statusline-showing-context-current-metta-workf
title: Custom Claude statusline showing context % + current metta workflow step
priority: medium
added: 2026-04-16
---

Build a custom Claude Code statusline (via the `statusline-setup` mechanism) that displays:

1. **Context utilization %** — percentage of the model's context window currently in use (useful when running long nested sessions like the trello-clone dogfood).
2. **Current metta workflow step** — parsed from `metta status --json` on the active change: which artifact is in progress (intent / stories / spec / research / design / tasks / implementation / verification), or `idle` when no active change.

Should live in `src/templates/statusline/` and be copied to `.claude/statusline/` by `metta install`. Refresh cadence: every few seconds or on command completion.

Bonus: per-change color coding when a change branch is active.
