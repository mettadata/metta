# archive-resolved-task-checkbox

## Problem
Two things observed during an archive attempt:

1. The resolved issue at `spec/issues/tasks-in-tasks-md-arent-getting-checked-off-as-they-are-buil.md` was still mingled with open issues, with no indication it had been fixed by `executor-agent-must-check-off` (commit `f8edccc`). Resolved issues need a place to live so they don't clutter the active issue list.

2. **Guard hook bug found in flight**: `src/templates/hooks/metta-guard-edit.mjs` (from the just-shipped `claude-md-directive-via-metta` change) called `metta status --json` and checked `status?.changes` — but `metta status` actually returns `{change: "..."}` (singular) when a change is active and `{changes: []}` only when there is none. The hook therefore blocked every Edit/Write even inside an active change. Chicken-and-egg — could not fix via Edit without bypass.

## Proposal
Two coupled edits:

1. **Establish `spec/issues/resolved/` convention** — move the resolved task-checkbox issue file there and enrich it with `Status: resolved`, `Resolved: <date>`, and `Fixed by: <change>, <commit>` frontmatter, plus a Resolution section.

2. **Fix the guard hook shape check** — update both `src/templates/hooks/metta-guard-edit.mjs` and `.claude/hooks/metta-guard-edit.mjs` to treat EITHER `typeof status.change === 'string'` OR `status.changes.length > 0` as "active change exists." Keeps backwards-compat for the zero-changes list response while correctly handling single-change repos.

## Impact
- **Issues dir**: new `spec/issues/resolved/` subdir for archived issues. `metta issue` CLI still writes to `spec/issues/` for new issues; resolved-migration stays manual until `/metta-fix-issues` lands.
- **Guard hook**: no longer blocks legitimate edits inside an active metta change. The hook's intended behavior (block when no change) is preserved.
- **Tests**: existing `tests/cli.test.ts` guard-hook tests assert install/wiring, not runtime behavior — unaffected. Consider an integration test that exercises the hook against real `metta status` output; deferred unless reviewers push.

## Out of Scope
- Automated archival of resolved issues (blocked on `/metta-fix-issues` backlog item).
- Adding a `metta issue resolve <slug>` CLI command.
- Per-issue change-linkage schema (frontmatter stays freeform).
- Renaming `spec/issues/` or changing its shape.
