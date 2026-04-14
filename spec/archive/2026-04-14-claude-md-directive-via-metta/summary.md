# Summary: claude-md-directive-via-metta

Two guardrails now steer Claude Code users toward `metta quick <description>` as the default entry for any code change:

## 1. CLAUDE.md directive (soft nudge)
`src/cli/commands/refresh.ts` `buildWorkflowSection()` now emits a `### How to work` subsection:

> For any code change — bug fix, feature, refactor — start with `metta quick <description>` (or `metta propose` for anything non-trivial) before editing files. The framework scaffolds a change branch, tracks intent, and runs review/verification. Doc-only fixes and this workflow itself are the exceptions.

Picked up on next `metta refresh` or `/metta:init`.

## 2. PreToolUse hook (hard guard)
`src/templates/hooks/metta-guard-edit.mjs` — Node script that:
- Reads Claude Code hook JSON from stdin
- If `tool_name` is Edit/Write/NotebookEdit/MultiEdit and no active metta change exists, blocks (exit 2) with a message pointing to `/metta:quick` and naming `.claude/settings.local.json` as the emergency bypass
- Tolerates missing metta / parse failures / non-metta projects — exits 0 so bootstrap still works

`metta install` now:
- Copies the template hook to `.claude/hooks/metta-guard-edit.mjs` (0755)
- Merges a `PreToolUse` entry into `.claude/settings.json` with matcher `Edit|Write|NotebookEdit|MultiEdit`
- Array.isArray guards for malformed existing settings
- Throws a clear error if settings.json is invalid JSON (refuses to overwrite user content)
- Logs the hook install in both human and JSON output (`guard_hook_installed: bool`)
- Surfaces install failures via stderr rather than silently swallowing

## Files changed
- `src/cli/commands/refresh.ts` (+ test)
- `src/templates/hooks/metta-guard-edit.mjs` (new)
- `src/cli/commands/install.ts` (helper + wiring)
- `package.json` (copy-templates covers hooks)
- `tests/cli.test.ts` (+ 2 tests)

## Review (3 reviewers, parallel)
All PASS_WITH_WARNINGS → all 5 consolidated fixes applied (Array.isArray guards, throw on malformed JSON, log install, stderr on failure, escape-hatch hint). See `review.md`.

## Verification (3 verifiers, parallel)
- `npx vitest run`: 331/331 PASS (was 329, +2 guard tests)
- `npx tsc --noEmit` + `npm run lint`: PASS
- Goal-vs-intent: 7/7 goals cited with file:line evidence

Change ready to finalize and ship.
