# fix-guard-hook-allow-init-phas

## Problem

The `metta-guard-edit.mjs` PreToolUse hook blocks `Edit`/`Write`/`MultiEdit`/`NotebookEdit` when no active metta change exists. This creates a chicken-and-egg problem during `/metta-init`: the `metta-discovery` agent needs to write `spec/project.md` and `.metta/config.yaml` **before** any change exists (by definition, init sets up the project).

Currently metta-discovery works around the block by shelling out via Bash heredoc. That bypasses the guard on one specific invocation but establishes a bad pattern: if bypass is trivial, the guard's value erodes. Logged as issue `metta-discovery-agent-cannot-write-outside-an-active-change-` (minor).

## Proposal

Add a narrow path allow-list to `.claude/hooks/metta-guard-edit.mjs` AND its source at `src/templates/hooks/metta-guard-edit.mjs`. When no active change exists AND the tool input's target file path matches one of the init-phase allow-listed paths, exit 0 (pass through). Otherwise block as today.

Allow-listed paths (relative to project root):
- `spec/project.md` — the constitution
- `.metta/config.yaml` — project config

Both are the only files `metta-discovery` is legitimately expected to write during init. If an agent tries to write anywhere else without an active change, the guard still fires.

## Impact

- `src/templates/hooks/metta-guard-edit.mjs` — ~15-line addition that resolves the tool-input file path, relativizes it, and exits 0 if it matches the allow-list
- `.claude/hooks/metta-guard-edit.mjs` — byte-identical copy (deployed mirror; the template engine guarantees this)
- No schema changes, no CLI changes
- Existing behavior unchanged for all non-init writes

## Out of Scope

- Broader allow-list covering `CLAUDE.md`, `.claude/**`, arbitrary install-phase paths. Keep the list tight.
- Environment-variable-based bypass (e.g. `METTA_GUARD_BYPASS=1`) — introduces a new escape hatch; skip.
- Updating `metta-discovery.md` to stop using Bash heredoc — follow-up if the agent's prose still references the bypass.
