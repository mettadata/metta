# fix-metta-guard-edit-hook-blocks-edit-write-files-outside

## Problem
The `metta-guard-edit` PreToolUse hook blocks `Edit`/`Write`/`NotebookEdit`/`MultiEdit` calls when there is no active metta change, and it applies this block indiscriminately — including to file paths that resolve entirely outside the project repository. Its stated purpose (per its own header comment and its nudge message: "Start one with `/metta:quick`") is to keep repo source work under change control. A file outside the working tree can never be part of a metta change, so gating it adds friction with zero protective value.

Concretely: `.claude/hooks/metta-guard-edit.mjs:69` computes `relPath = relative(projectRoot, resolve(projectRoot, filePath))` and then only checks that value against two allow-lists (`spec/project.md`, `.metta/config.yaml`) and two directory prefixes (`spec/issues/`, `spec/backlog/`). Nothing checks whether `relPath` escapes the project root (i.e., starts with `..`) before falling through to the unconditional `process.exit(2)` block at the bottom of the file. The identical logic is duplicated in `src/templates/hooks/metta-guard-edit.mjs`, the template `metta install` copies into every new project, so the defect ships to all installs, not just this repo's checked-in hook.

Affected: any developer or AI orchestrator using metta-guarded Claude Code sessions who needs to edit or write a file outside the repo — personal notes under `~/.claude/`, session scratchpad files under `/tmp/`, or any other out-of-tree path — while no metta change is active. Reproduced twice on 2026-07-14: an Edit to `/home/utx0/.claude/projects/-home-utx0-Code-metta/memory/project_v02_subtractive_milestone.md` was rejected, and a Write to a session scratchpad under `/tmp/claude-1000/...` was rejected while logging this very issue. The only current workaround — writing via a Bash one-liner — trivially bypasses the hook's intended guarantee, which undermines confidence in the guard rather than reinforcing it.

## Proposal
Add an early "outside project root" allow check to the hook's path-scoping logic, in both the installed hook and its template source, so paths that do not resolve under `process.cwd()` are exempted from the no-active-change block.

Specifically:
- In `.claude/hooks/metta-guard-edit.mjs` and `src/templates/hooks/metta-guard-edit.mjs`, after computing `relPath` (line 69 in both files) and before the existing `ALLOW_LIST`/`ALLOW_PREFIXES` checks, add a check that exits 0 when `relPath` starts with `..` (i.e., `relPath.startsWith('..')`) or is itself absolute (covers platforms/edge cases where `relative()` cannot express the path as a relative traversal, e.g. a different drive on Windows) — indicating the target does not resolve under `projectRoot`.
- This applies only to the `filePath` truthy branch (line 66 onward); behavior for guarded tool calls with no `file_path`/`notebook_path` is unchanged.
- `projectRoot` continues to be derived from `process.cwd()`, matching the existing implementation; no change to how the project root is determined.
- Both copies of the hook (installed and template) must be updated identically so the fix applies to this repo immediately and to every project that installs metta hooks going forward (`metta install`).
- Add or update unit/integration test coverage for the hook (or its template) confirming: (a) an out-of-repo absolute path is allowed through with no active change, (b) in-repo unmatched paths are still blocked as before, (c) existing allow-list and allow-prefix behavior is unchanged.

## Impact
- `.claude/hooks/metta-guard-edit.mjs` — path-scoping logic gains an early-exit branch; no changes to the active-change check, the guarded tool set, or the block/error message.
- `src/templates/hooks/metta-guard-edit.mjs` — identical change, so newly installed/updated projects inherit the fix via `metta install`.
- Existing in-repo guard behavior is preserved: Edit/Write/NotebookEdit/MultiEdit calls targeting files under the project root, without an active change and not matching the existing allow-list/allow-prefixes, continue to be blocked exactly as today.
- The workaround of bypassing the hook via a Bash one-liner for out-of-repo files becomes unnecessary, reducing incentive to route legitimate out-of-tree work around the guard.
- No change to `metta status --json` usage, the active-change detection logic, or the emergency-bypass instructions in the block message.

## Out of Scope
- Hardening the project-root determination itself (e.g., resolving `projectRoot` via `git rev-parse --show-toplevel` instead of trusting `process.cwd()`). This intent fixes only the missing outside-root check; the candidate-solution tradeoff of a cwd-deeper-than-repo-root false "outside" classification is a separate, lower-severity concern not addressed here.
- Exempting gitignored files or scratch paths *inside* the repo (e.g., under `.metta/` or other gitignored in-tree directories) from the guard. That was evaluated as Candidate Solution 2 in the issue and rejected for this change due to the added git-subprocess cost and failure mode; it may be proposed separately if a concrete need arises.
- Inverting the guard to scope by git-tracked status (Candidate Solution 3). Rejected because it would weaken the guard's core protection against new, untracked repo source files being edited outside a metta change.
- Any change to the guarded tool set (`Edit`, `Write`, `NotebookEdit`, `MultiEdit`), the active-change detection via `metta status --json`, the existing `ALLOW_LIST`/`ALLOW_PREFIXES` contents, or the block/nudge message text.
- Changes to other metta-guard hooks, if any exist beyond `metta-guard-edit`.
