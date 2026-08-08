# metta-guard-edit hook is worktree-blind — blocks all subagent Write/Edit inside .metta/worktrees/ checkouts

**Captured**: 2026-08-08
**Status**: logged
**Severity**: major

## Symptom
The metta-guard-edit PreToolUse hook blocks every subagent Write/Edit whose target lives inside a `.metta/worktrees/<change>/` checkout with "no active metta change", even though that worktree's own `spec/changes/` contains an active change. Observed in both recent fork-run changes (2026-07-26 uat-runner, 2026-08-08 token-tracking): every artifact-writing subagent was blocked and fell back to bash heredocs throughout. A related gap: `metta status` / `metta instructions` invoked from the repo root cannot resolve changes living in `.metta/worktrees/`, and since the worktree-per-change feature (PR #52) made worktrees the default layout, both gaps now hit every standard change.

## Root Cause Analysis
The hook is worktree-blind in two independent places. First, its active-change probe shells out to `metta status --json` with `cwd: process.cwd()` — the hook process cwd is the main checkout root, so the probe inspects the main checkout's `spec/changes/`, which is empty when the change branch is checked out only inside `.metta/worktrees/<change>/`. The probe returns "no active changes" and the guard proceeds to block. Second, the path allowlist computes `relative(projectRoot, target)` against that same main-root cwd, so a target like `.metta/worktrees/<name>/spec/changes/<name>/spec.md` yields relPath `.metta/worktrees/...` — inside the root (so the 2026-07-18 outside-root early-allow does not fire) yet matching neither `ALLOW_LIST` nor the `spec/issues/`/`spec/backlog/` prefixes. The CLI shares the same blindness: `createCliContext` roots at `process.cwd()` and the artifact store only reads `<root>/spec/changes`, which is why `metta status`/`instructions` from the repo root cannot see worktree-resident changes — and why the hook's status probe fails even though the change is real.

### Evidence
- `.claude/hooks/metta-guard-edit.mjs:30` — the active-change probe runs `metta status --json` with `cwd: process.cwd()` (the main checkout), so a change active only inside a `.metta/worktrees/<change>` checkout is invisible to it.
- `.claude/hooks/metta-guard-edit.mjs:66` — allowlist relPaths are computed against the main-root cwd; worktree-internal targets resolve to `.metta/worktrees/...`, which neither triggers the outside-root early allow (commit 5deaab7e2) nor matches any allow prefix.
- `src/cli/helpers.ts:40` and `src/artifacts/artifact-store.ts:103` — `createCliContext` defaults `projectRoot` to `process.cwd()` and `listChanges` reads only `<root>/spec/changes`; with `.metta/worktrees` the default layout (`src/util/git-worktree.ts:10`, commit e2e4f8ab5), repo-root invocations cannot resolve worktree-resident changes.

## Candidate Solutions
1. **Worktree-aware probe in the hook** — before probing, resolve the git worktree root containing the edit target (e.g. `git -C <nearest-existing-ancestor-of-target> rev-parse --show-toplevel`) and run `metta status --json` with cwd set to that root; compute allowlist relPaths against the same root. Add tests exercising a real `git worktree add` fixture. Tradeoff: one extra git subprocess per guarded edit adds latency, and the hook must handle not-yet-existing targets by walking up to an existing ancestor.
2. **Make CLI change-resolution worktree-aware** — teach `createCliContext`/the artifact store to resolve the containing worktree root from cwd (and optionally aggregate `.metta/worktrees/*/spec/changes` when run from the main root), so `metta status` and `metta instructions` report worktree-resident changes; the hook, which just shells out to status, is fixed for free once its cwd is the worktree root. Tradeoff: broadens status semantics across checkouts and touches every command sharing the CLI context, with ambiguity risk when a change directory exists both on main and in a worktree.
3. **Filesystem-structural allow in the hook** — detect worktree-internal targets by matching the `.metta/worktrees/<name>/` path shape (or walking up from the target for a `spec/changes/*/.metta.yaml`) and early-allow when the containing worktree has an active change, without shelling out to metta. Tradeoff: duplicates active-change semantics inside the hook, which can silently drift from CLI behavior.

