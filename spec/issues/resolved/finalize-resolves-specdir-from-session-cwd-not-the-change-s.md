# Finalize resolves specDir from session cwd, not the change's worktree — gates.yaml write and archive paths break for worktree-hosted changes when finalize runs from the main checkout.

## Symptom
Running 'metta finalize --change <name>' from the MAIN checkout cwd for a worktree-hosted change fails with exit 4: ENOENT opening '<main>/spec/archive/<archive-name>/gates.yaml'. Worse, the failure is non-atomic: the artifact store had already moved spec/changes/<name>/ into spec/archive/ inside the WORKTREE (with UAT.md and TOKENS.md generated), leaving the change half-archived with no active state — a retry then fails with ENOENT on the now-missing .metta.yaml and requires manual 'git restore' of the change dir plus deletion of the orphan archive dir. Re-running finalize with cwd inside the worktree succeeds fully. Observed live on 2026-08-11 while finalizing fix-hooks-statusline-execute-stale-main-checkout-dist-via (two failed attempts, manual recovery each time).

## Root Cause Analysis
src/cli/commands/finalize.ts constructs the Finalizer with 'join(ctx.projectRoot, "spec")' where ctx.projectRoot derives from the session cwd — the main checkout when the orchestrator runs finalize from the repo root. But ctx.artifactStore resolves the change's base dir per-change and is worktree-aware, so archive/writeArtifact operate in the worktree while every 'this.specDir' join in src/finalize/finalizer.ts (gates.yaml write at line 244, changeDir passed to generateUat at line 190, the UAT/TOKENS cleanup rm paths, uatPath/tokensPath in the result) targets the main checkout. The two roots disagree exactly when the change is worktree-hosted and cwd is not the worktree — the same worktree-blind class as the stale-dist issue. The mid-archive failure point (archive move committed to disk before the gates.yaml write) makes the failure stateful, not just erroneous.

### Evidence
- src/cli/commands/finalize.ts:44 — Finalizer constructed with join(ctx.projectRoot, 'spec') from session-cwd-derived projectRoot.
- src/finalize/finalizer.ts:244 — gateResultsPath joined from this.specDir; ENOENT reproduced twice from main cwd on 2026-08-11, succeeded from worktree cwd.
- src/artifacts/artifact-store.ts:315 — archive() uses the per-change worktree-aware baseDir, diverging from this.specDir.

## Candidate Solutions
1. Resolve specDir from the change's host checkout: have finalize.ts derive the Finalizer's specDir from the artifact store's per-change base dir (or pass the change_root through), so all finalizer paths and the archive move agree regardless of cwd. Tradeoff: touches the Finalizer constructor contract; needs a regression test running finalize from outside the worktree.
2. Make finalize atomic/recoverable: write gates.yaml and all post-archive artifacts before or during the archive move (or stage in the change dir and let the move sweep them, as UAT/TOKENS already do), so a path failure cannot strand a half-archived change. Tradeoff: does not fix the wrong-root reads (generateUat changeDir), only the stranding.
3. Guard rail: finalize detects that the change is worktree-hosted and its resolved specDir is not under the change root, and aborts up front with a clear error before mutating anything. Tradeoff: turns silent corruption into a loud pre-flight failure but still requires the user to rerun from the right cwd.

**Captured**: 2026-08-11
**Status**: resolved
**Severity**: major

Finalize resolves specDir from session cwd, not the change's worktree — gates.yaml write and archive paths break for worktree-hosted changes when finalize runs from the main checkout.

## Symptom
Running 'metta finalize --change <name>' from the MAIN checkout cwd for a worktree-hosted change fails with exit 4: ENOENT opening '<main>/spec/archive/<archive-name>/gates.yaml'. Worse, the failure is non-atomic: the artifact store had already moved spec/changes/<name>/ into spec/archive/ inside the WORKTREE (with UAT.md and TOKENS.md generated), leaving the change half-archived with no active state — a retry then fails with ENOENT on the now-missing .metta.yaml and requires manual 'git restore' of the change dir plus deletion of the orphan archive dir. Re-running finalize with cwd inside the worktree succeeds fully. Observed live on 2026-08-11 while finalizing fix-hooks-statusline-execute-stale-main-checkout-dist-via (two failed attempts, manual recovery each time).

## Root Cause Analysis
src/cli/commands/finalize.ts constructs the Finalizer with 'join(ctx.projectRoot, "spec")' where ctx.projectRoot derives from the session cwd — the main checkout when the orchestrator runs finalize from the repo root. But ctx.artifactStore resolves the change's base dir per-change and is worktree-aware, so archive/writeArtifact operate in the worktree while every 'this.specDir' join in src/finalize/finalizer.ts (gates.yaml write at line 244, changeDir passed to generateUat at line 190, the UAT/TOKENS cleanup rm paths, uatPath/tokensPath in the result) targets the main checkout. The two roots disagree exactly when the change is worktree-hosted and cwd is not the worktree — the same worktree-blind class as the stale-dist issue. The mid-archive failure point (archive move committed to disk before the gates.yaml write) makes the failure stateful, not just erroneous.

### Evidence
- src/cli/commands/finalize.ts:44 — Finalizer constructed with join(ctx.projectRoot, 'spec') from session-cwd-derived projectRoot.
- src/finalize/finalizer.ts:244 — gateResultsPath joined from this.specDir; ENOENT reproduced twice from main cwd on 2026-08-11, succeeded from worktree cwd.
- src/artifacts/artifact-store.ts:315 — archive() uses the per-change worktree-aware baseDir, diverging from this.specDir.

## Candidate Solutions
1. Resolve specDir from the change's host checkout: have finalize.ts derive the Finalizer's specDir from the artifact store's per-change base dir (or pass the change_root through), so all finalizer paths and the archive move agree regardless of cwd. Tradeoff: touches the Finalizer constructor contract; needs a regression test running finalize from outside the worktree.
2. Make finalize atomic/recoverable: write gates.yaml and all post-archive artifacts before or during the archive move (or stage in the change dir and let the move sweep them, as UAT/TOKENS already do), so a path failure cannot strand a half-archived change. Tradeoff: does not fix the wrong-root reads (generateUat changeDir), only the stranding.
3. Guard rail: finalize detects that the change is worktree-hosted and its resolved specDir is not under the change root, and aborts up front with a clear error before mutating anything. Tradeoff: turns silent corruption into a loud pre-flight failure but still requires the user to rerun from the right cwd.

## Resolution

**Resolved**: 2026-08-11 — shipped as PR #79 (change fix-finalize-resolves-specdir-session-cwd, archived): Finalizer specDir/SpecLockManager resolve via worktree-aware ArtifactStore.specDirFor; gates.yaml staged pre-archive; e2e finalize-from-main-cwd regression tests. Merge was delayed behind the CI setup fix (PR #80).
