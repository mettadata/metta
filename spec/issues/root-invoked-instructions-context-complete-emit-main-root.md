# Root-invoked instructions/context/complete emit main-root artifact paths for worktree-hosted changes

**Captured**: 2026-08-08
**Status**: logged
**Severity**: major

## Symptom
When `metta instructions`, `metta context`, or `metta complete` is invoked from the main checkout root for a change that is hosted in a per-change worktree (`.metta/worktrees/<name>/`), the commands resolve the change correctly but emit artifact paths built from the main checkout root (`<root>/spec/changes/<name>/...`) instead of the hosting worktree (`<root>/.metta/worktrees/<name>/spec/changes/<name>/...`). The wrong paths are emitted silently — no error or warning — so an orchestrator following the instructions writes artifacts to a location the worktree-hosted change never sees. Found by review during fix-metta-guard-edit-worktree-blind (PR #57), which fixed status aggregation but not path emission.

## Root Cause Analysis
PR #57 made change *discovery* worktree-aware: `createCliContext` passes `worktreesDir` into `ArtifactStore`, and the store reports each change's hosting `worktree` in its metadata. But the lifecycle commands never consume that host path. `instructions.ts`, `context.ts`, and `complete.ts` all construct `changePath`/`specDir` with an unconditional `join(ctx.projectRoot, 'spec', 'changes', changeName)`. `resolveProjectRoot()` only normalizes upward from `cwd` — it roots at the nearest ancestor with `spec/changes/`, so when invoked from the repo root it correctly returns the main checkout, and nothing downstream re-roots the path at the change's worktree. Discovery finds the worktree-hosted change (so the commands succeed), while every emitted path and git `cwd` stays anchored to the main checkout. The current workaround (cd into the worktree before running lifecycle commands) works because `resolveProjectRoot` then roots at the worktree checkout itself.

### Evidence
- `src/cli/commands/instructions.ts:65` — `changePath = join(ctx.projectRoot, 'spec', 'changes', changeName)` with no consultation of the change's hosting worktree; same pattern at `context.ts:52` and `complete.ts:157-186`.
- `src/cli/helpers.ts:70-79` — `worktreesDir` is wired into `ArtifactStore` for discovery only ("status/list/resolution stay truthful"), confirming path emission was out of scope for the PR #57 fix.
- `src/artifacts/artifact-store.ts:139-146` — the store already surfaces the hosting `worktree` path in change metadata for consumers, so the host information exists but is unused by instructions/context/complete when building paths.

## Candidate Solutions
1. **Worktree-aware change-root resolution helper** — Add a shared helper (e.g. `resolveChangeRoot(ctx, changeName)`) that reads the change's discovery metadata and returns the worktree checkout root when the change is worktree-hosted, else `ctx.projectRoot`; use it for every `changePath`/`specDir` build and for the git `cwd` in auto-commit paths in `instructions.ts`, `context.ts`, and `complete.ts`. Tradeoff: touches many `join()` call sites across three commands and the git side-effect paths, so it needs careful test coverage to avoid re-rooting paths that genuinely belong to the main checkout (e.g. `spec/specs/` capability targets in `complete`).
2. **Refuse root invocation for worktree-hosted changes** — Make the three commands detect a worktree-hosted change resolved from the main root and exit with an actionable error ("change is hosted in .metta/worktrees/<name>; run from that checkout"), converting silent wrongness into a loud failure. Tradeoff: does not deliver the capability — orchestrators and humans must still cd manually, and it adds a failure mode to flows that previously (accidentally) appeared to work.
3. **Codify the cd-into-worktree workaround at the skill layer** — Keep the CLI as-is and enforce the current orchestrator practice in the metta skills/guard hook so lifecycle commands are always dispatched from the hosting worktree. Tradeoff: leaves the CLI itself silently wrong for direct human use and any tooling outside the skill layer, and the invariant lives in instructions rather than code.
