# claude-md-directive-via-metta

## Problem
Users working in Claude Code can edit the codebase directly (via Edit/Write tools) without ever touching the metta workflow. This bypasses intent/impl/review/verify, produces no spec artifacts, and leaves the project's history of decisions empty. We want `metta quick <description>` to be the default entry point for any code change, yet there's no mechanism that nudges (or forces) Claude down that path.

Two complementary guardrails are needed:
1. **Soft nudge** (instruction) — CLAUDE.md says "start with `metta quick` for code changes." Claude reads and usually obeys.
2. **Hard guard** (hook) — `PreToolUse` hook intercepts Edit/Write/NotebookEdit and blocks if no active metta change is in flight.

Both should be installed automatically — soft nudge via the refresh pipeline (picked up by `/metta:init` and every `metta refresh`); hard guard via `metta install` when the hooks infrastructure is written to `.claude/settings.json`.

## Proposal

### 1. CLAUDE.md directive (soft nudge)
Add a new section at the top of `buildWorkflowSection()` in `src/cli/commands/refresh.ts`:

```
## How to work

For any code change — bug fix, feature, refactor — start with `metta quick <description>` (or `metta propose` for anything non-trivial) before editing files. The framework will scaffold a change branch, track intent, and run review/verification. Doc-only fixes and this workflow itself are the exceptions.
```

This section appears in every generated CLAUDE.md. Existing projects pick it up on next `metta refresh` or `/metta:init`.

### 2. PreToolUse hook (hard guard)
Add a hook script and wire it into `.claude/settings.json` via `metta install`.

- Script: `.claude/hooks/metta-guard-edit.sh` (or `.mjs`). Reads `CLAUDE_TOOL_NAME` and `CLAUDE_TOOL_ARGS` env / stdin JSON; if tool is Edit/Write/NotebookEdit, runs `metta status --json` and:
  - If there's an active change → exit 0 (allow)
  - If no active change → exit with a non-zero code and a stderr message pointing to `/metta:quick <desc>`
  - If `metta` is not installed / not in PATH → exit 0 (don't block bootstrap)
- `settings.json` addition via `metta install`: register the script under `hooks.PreToolUse` for matchers `Edit`, `Write`, `NotebookEdit`.

Install should be idempotent — if the hook is already registered, don't duplicate. Uninstall is out of scope.

### Scope of enforcement
Hook blocks Edit/Write/NotebookEdit outside an active metta change. Allowed paths when no active change exists: none — user must start a change or bypass manually by creating one. The hook is documented as bypassable: users can disable in their local `.claude/settings.local.json` if they need to make a one-off emergency fix.

## Impact
- **CLAUDE.md**: gains a new top-of-workflow "How to work" paragraph on next `metta refresh` / `/metta:init`. Human-visible.
- **Claude Code behavior**: on freshly-installed or re-installed projects, Edit/Write/NotebookEdit outside a metta change hit the PreToolUse hook and fail with a clear message.
- **Existing projects**: picking up the hook requires re-running `metta install` (idempotent) or manual settings.json edit.
- **`refresh.ts` tests**: new section adds assertion targets; update `tests/refresh.test.ts` to include "How to work".
- **New tests**: static test that `metta install` writes the hook script + settings.json entry; unit test for the hook script itself (active-change allow, no-change block, metta-missing allow).
- **`.claude/settings.json` in this repo**: must be updated in the same commit so Claude in this repo experiences the guard end-to-end.

## Out of Scope
- An `uninstall` path for the hook.
- A `--no-guard` metta install flag.
- Wrapping other tools (Bash, Read, etc.) — only Edit/Write/NotebookEdit are in scope.
- Allowing a bypass via env var or CLI flag.
- Teaching the hook about doc-only changes (e.g. auto-allow `*.md` edits) — too easy to misuse. Users can start a metta quick for docs.
- Enforcing this on non-Claude-Code adapters (v0.1 is Claude-only anyway).
- Migrating existing projects' `.claude/settings.json` beyond the `metta install` re-run path.
