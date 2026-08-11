# fix-finalize-resolves-specdir-session-cwd

## Problem

`metta finalize --change <name>` fails with exit 4 (`ENOENT` on `<main>/spec/archive/<archive-name>/gates.yaml`) whenever the change is worktree-hosted and the command runs from the main checkout cwd — the normal cwd for the orchestrator and the ship skill. The failure is non-atomic: by the time the gates.yaml write fails, `ArtifactStore.archive()` (src/artifacts/artifact-store.ts:315) has already moved `spec/changes/<name>/` into `spec/archive/` inside the worktree (with UAT.md and TOKENS.md swept in), leaving the change half-archived with no active `.metta.yaml`. A retry then fails on the missing metadata file, and recovery requires a manual `git restore` of the change dir plus deletion of the orphan archive dir. Observed live twice on 2026-08-11 while finalizing `fix-hooks-statusline-execute-stale-main-checkout-dist-via`.

Root cause: `src/cli/commands/finalize.ts:43-51` constructs the `Finalizer` with `join(ctx.projectRoot, 'spec')`, where `ctx.projectRoot` derives from the session cwd. But `ctx.artifactStore` resolves the change's host spec dir per-change and is worktree-aware (`specDirFor()` at artifact-store.ts:310). The two roots disagree exactly when the change lives in a worktree and cwd does not. Every `this.specDir` join in `src/finalize/finalizer.ts` then targets the wrong checkout: the gates.yaml write (line 244), the `changeDir` passed to `generateUat` (line 190), the UAT/TOKENS best-effort cleanup `rm` paths (lines 203, 231), and the `uatPath`/`tokensPath` values in the result (lines 237–238). This is the same worktree-blind class as the prior stale-dist issue.

Affected: anyone finalizing a worktree-hosted change from outside its worktree — in practice every AI-orchestrated finalize/ship run, since the orchestrator sits at the repo root.

## Proposal

Make the finalizer's spec-dir resolution agree with the artifact store's per-change, worktree-aware resolution, so finalize produces identical results regardless of cwd:

1. **Resolve specDir from the change's host checkout** (candidate solution 1 — the primary fix). Have `finalize.ts` derive the `Finalizer`'s specDir from the artifact store's per-change base dir for the named change (or pass the change's host root through), instead of `join(ctx.projectRoot, 'spec')` from the session cwd. All finalizer path joins — gates.yaml, `generateUat`'s `changeDir`, cleanup `rm` paths, reported `uatPath`/`tokensPath` — must then land in the same checkout the archive move operates on. This touches the `Finalizer` constructor contract; call sites and tests are updated accordingly.
2. **Order writes so a failure cannot strand a half-archived change.** Post-archive artifacts that can fail (gates.yaml) are written before the archive move or staged inside the change dir so the move sweeps them in — the same pattern UAT.md and TOKENS.md already use — so no code path can leave the change dir gone while a required archive artifact is missing.
3. **Regression coverage:** a test that hosts a change in a worktree, runs finalize with cwd at the main checkout root, and asserts (a) finalize succeeds, (b) gates.yaml lands in the worktree's archive dir, (c) the main checkout's `spec/archive/` is untouched, and (d) the reported `uatPath`/`tokensPath` point into the worktree.

Scope: `src/cli/commands/finalize.ts`, `src/finalize/finalizer.ts` (path derivations only), possibly a small accessor on `ArtifactStore` to expose the per-change spec dir, plus their tests.

## Impact

- **Finalize for worktree-hosted changes from main cwd** goes from a stateful two-attempt failure with manual recovery to a single successful run — the primary behavior fix.
- **Finalize for non-worktree changes, or when cwd is already the worktree,** is unchanged: the per-change resolution returns the same dir the current code computes, so existing passing paths keep their behavior.
- **`Finalizer` constructor contract changes** (specDir sourced per-change rather than from session cwd); any direct constructors in tests or other commands must be updated.
- **Result payload paths** (`uatPath`, `tokensPath`, archive path in CLI output and JSON) now correctly point into the worktree for worktree-hosted changes — consumers that assumed main-checkout paths were already broken for this case.
- **Downstream ship/ auto-commit step** in `finalize.ts` (git add/commit scoped to `spec/archive/...` under `ctx.projectRoot`) must be checked so the commit runs against the checkout that actually received the archive.
- The `finalize-ship` capability spec gains requirements for cwd-independent path resolution and non-stranding write ordering.

## Out of Scope

- A general audit or fix of other worktree-blind commands (status, complete, refresh, etc.) — this change fixes finalize only; the class-level pattern belongs to a separate change.
- A crash-recovery / resume mechanism for finalize runs interrupted for other reasons (power loss, mid-gate kill); we only ensure this specific failure mode cannot strand a change.
- The pre-flight guard-rail-only option (candidate 3): aborting on root mismatch without fixing resolution still forces a rerun from the right cwd and is superseded by the real fix.
- Changing how `ctx.projectRoot` itself is derived for the CLI globally, or how worktrees are created/located.
- Automated cleanup tooling for archives already stranded by past failures — the one known instance was recovered manually.
