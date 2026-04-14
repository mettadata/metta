# Summary: claude-md-directive-via-metta

Two guardrails added to steer Claude Code users toward `metta quick <description>` as the default path for any code change:

## 1. CLAUDE.md directive (soft nudge)
`src/cli/commands/refresh.ts` `buildWorkflowSection()` now emits a `### How to work` subsection at the top of the workflow block. Every fresh / refreshed CLAUDE.md includes:

> For any code change — bug fix, feature, refactor — start with `metta quick <description>` (or `metta propose` for anything non-trivial) before editing files. The framework scaffolds a change branch, tracks intent, and runs review/verification. Doc-only fixes and this workflow itself are the exceptions.

Existing projects pick it up on next `metta refresh` or `/metta:init` discovery.

## 2. PreToolUse hook (hard guard)
`src/templates/hooks/metta-guard-edit.mjs` — a small Node script that:
- Reads Claude Code hook JSON from stdin
- If `tool_name` is Edit/Write/NotebookEdit/MultiEdit and no active metta change exists, blocks with exit 2 and a message pointing to `/metta:quick`
- Tolerates missing metta or non-metta projects (exits 0 so bootstrap still works)

`src/cli/commands/install.ts` gained `installMettaGuardHook()`: copies the template hook to `.claude/hooks/`, marks executable, merges a `PreToolUse` entry into `.claude/settings.json` if not already present (idempotent).

## Files changed
- `src/cli/commands/refresh.ts` (workflow section directive)
- `tests/refresh.test.ts` (assertion for new section)
- `src/templates/hooks/metta-guard-edit.mjs` (new)
- `src/cli/commands/install.ts` (hook install step)
- `package.json` (copy-templates covers hooks dir)
- `tests/cli.test.ts` (2 new tests)

## Gates
- `npm run build` — PASS
- `npx vitest run` — 331/331 PASS (was 329, +2 guard tests)

## Behavior verified
- Guard script writes to tmp project's `.claude/hooks/metta-guard-edit.mjs` with `0755` perms.
- Settings.json gets a `PreToolUse` entry matching `Edit|Write|NotebookEdit|MultiEdit`.
- Second `metta install` does not duplicate the entry.
