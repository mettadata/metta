# metta-guard-edit.mjs blocks Edit/Write for all subagents working in .metta/worktrees/ worktrees — the hook resolves the active change from the session cwd instead of the file's worktree path, so every legitimate worktree edit is denied and subagents fall back to Bash/python3 writes, bypassing the guard entirely. Observed across 15+ subagents during the template-version-drift change on 2026-07-26.

**Captured**: 2026-07-26
**Status**: logged
**Severity**: major

## Symptom
During the template-version-drift change on 2026-07-26, 15+ subagents working inside the `.metta/worktrees/template-version-drift-detection-consumer-projects-stamp` worktree had every `Edit`/`Write` call denied by the `metta-guard-edit.mjs` PreToolUse hook with "no active metta change" — despite a change being active in that worktree. Subagents then fell back to writing files via `Bash` (python3/heredoc), which the edit guard does not cover, bypassing the guard entirely for the exact edits it was supposed to supervise.

## Root Cause Analysis
The hook resolves the active change from the hook process's cwd (the session/project root), never from the path of the file being edited. It runs `metta status --json` with `cwd: process.cwd()`, and `metta status` lists changes from `spec/changes/` at that root. But metta change dirs live on the change branch, which is checked out only inside `.metta/worktrees/<change>/` — the main checkout's `spec/changes/` is empty while the work is in flight (confirmed: `spec/changes/` on main has no entries while the worktree exists). So `metta status` at the session root reports no active changes, and the hook falls through to its block path. The outside-root early allow does not rescue worktree files either, because `.metta/worktrees/` is inside the project root, so the relative path never starts with `..`. Net effect: every legitimate worktree edit is blocked, and the block message trains subagents to route writes through unguarded Bash instead.

### Evidence
- `.claude/hooks/metta-guard-edit.mjs:30` — `execAsync('metta', ['status', '--json'], { cwd: process.cwd() })` queries change state at the session root, ignoring the target file's worktree.
- `.claude/hooks/metta-guard-edit.mjs:74` — the only path-based escape is `relPath.startsWith('..') || isAbsolute(relPath)`; worktree files resolve to `.metta/worktrees/...` inside the root, so they fall through to the exit-2 block.
- `src/util/git-worktree.ts:10` — `DEFAULT_WORKTREE_DIR = '.metta/worktrees'` places change worktrees inside the project root, guaranteeing the inside-root block path for all worktree edits.

## Candidate Solutions
1. **Resolve status from the edited file's worktree** — before querying, map `file_path` to its containing root: if it falls under `<root>/.metta/worktrees/<name>/`, run `metta status --json` with cwd set to that worktree directory (which has the change branch checked out and `spec/changes/<name>/` present). Tradeoff: the hook grows path-mapping logic that duplicates knowledge of the worktree layout, and breaks silently if `git.worktree.dir` is configured away from the default.
2. **Early-allow files under `.metta/worktrees/`** — treat any file inside a metta-managed worktree as guard-exempt, on the grounds that a worktree only exists because metta created it for an active change. Tradeoff: weakest enforcement — stale or hand-made directories under `.metta/worktrees/` get unguarded edits, and the guard no longer distinguishes in-change from out-of-change edits within a worktree.
3. **Record active changes in root-level state** — have the CLI maintain an active-change registry in the main checkout's `.metta/` (written at propose/quick time, cleared at ship/abandon), so `metta status` at the session root reports worktree-hosted changes and the hook needs no change. Tradeoff: largest blast radius — touches state-store, status, and lifecycle commands, and introduces a second source of truth that can drift from the worktree's `spec/changes/`.
