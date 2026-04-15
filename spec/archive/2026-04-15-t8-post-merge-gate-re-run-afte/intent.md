# Intent: T8 — Post-Merge Gate Re-Run After Ship

**Change:** `t8-post-merge-gate-re-run-afte`
**Branch:** `metta/t8-post-merge-gate-re-run-afte`
**Date:** 2026-04-14
**Status:** proposed

---

## Problem

`MergeSafetyPipeline.run()` in `src/ship/merge-safety.ts` ends step 9 with a hard-coded stub:

```typescript
// Step 9: Post-merge gates (simplified)
steps.push({ step: 'post-merge-gates', status: 'pass' })
```

No gate is executed. The unconditional pass is emitted immediately after `git merge --no-ff <sourceBranch>` lands on the target branch. This means the merged working tree is never validated before `ship` returns `success`.

This creates a specific class of silent failure that metta was designed to prevent:

- **Type drift from parallel changes.** Two simultaneous changes each modify a shared interface. Each passes `typecheck` independently on its own branch. After merge, the resolved tree has a type mismatch. The stub emits `pass` without running `tsc`.
- **Test regressions from interaction effects.** Change A adds a new behaviour; Change B modifies a module that Change A's tests rely on. Both test suites pass in isolation. Post-merge, A's tests fail. The stub never runs `vitest`.
- **Lint failures from unresolved conflicts or formatter drift.** Merge resolution occasionally introduces whitespace or import-order violations. The stub never runs `eslint`.

The `finalize` step (implemented by the sibling `finalize-check` change) validates the branch state _before_ merge. That is insufficient: it cannot see the merged tree. The post-merge step is the only point where the resolved, integrated state is observable. Leaving it as a stub means main can carry known-broken state with no automated detection.

All five gate definitions already exist in `src/templates/gates/` (`build.yaml`, `lint.yaml`, `stories-valid.yaml`, `tests.yaml`, `typecheck.yaml`). `GateRegistry` in `src/gates/gate-registry.ts` already provides `run(name, cwd)` and `runAll(names, cwd)`. `CliContext` in `src/cli/helpers.ts` already constructs and exposes a `gateRegistry` instance. The infrastructure is complete; the connection to `MergeSafetyPipeline` is missing.

---

## Proposal

### 1. `src/ship/merge-safety.ts` — replace the stub with real gate execution

Extend `MergeSafetyPipeline` to accept an optional `GateRegistry` via constructor injection:

```typescript
constructor(private cwd: string, private gateRegistry?: GateRegistry) {}
```

Backwards compatibility is preserved: existing call sites that omit `gateRegistry` continue to work.

Replace the step 9 stub with the following logic:

**No registry injected:**
Push `{ step: 'post-merge-gates', status: 'pass', detail: 'no gates configured' }` and return success. The pipeline remains usable in contexts (tests, library consumers) that have no registry.

**Registry present — all gates pass:**
Call `gateRegistry.runAll(['build', 'lint', 'tests', 'typecheck'], cwd)`. If every result has `status: 'pass'` or `status: 'skip'`, push `{ step: 'post-merge-gates', status: 'pass', detail: '<N> gates passed' }` and return success.

**Registry present — any gate fails:**
Capture the failing gate name and the `snapshotTag` established in step 6. Execute `git reset --hard <snapshotTag>` to return main to its pre-merge state. Then:

- If rollback succeeds: push `{ step: 'post-merge-gates', status: 'fail', detail: '<gate-name> failed; rolled back to <sha>' }` followed by `{ step: 'rollback', status: 'pass', detail: snapshotTag }`. Return `{ status: 'failure', steps, snapshotTag }`.
- If rollback also fails: push `{ step: 'post-merge-gates', status: 'fail', detail: '<gate-name> failed; rolled back to <sha>' }` (or the original failure detail) followed by `{ step: 'rollback', status: 'fail', detail: 'rollback also failed — manual intervention required' }`. Return `{ status: 'failure', steps, snapshotTag }`. The repo is left in whatever state the failed rollback produced; the caller MUST surface the `rollback-failed` condition loudly.

The `snapshotTag` (`metta/pre-merge/<sourceBranch>`) created in step 6 is left in place on both success and failure. It serves as a recovery handle.

Gates with `status: 'skip'` (not configured in the registry) do not constitute a failure.

### 2. `src/cli/commands/ship.ts` — pass `ctx.gateRegistry` to the pipeline

Change the pipeline construction from:

```typescript
const pipeline = new MergeSafetyPipeline(ctx.projectRoot)
```

to:

```typescript
const pipeline = new MergeSafetyPipeline(ctx.projectRoot, ctx.gateRegistry)
```

`ctx.gateRegistry` is already a fully constructed `GateRegistry` instance (see `src/cli/helpers.ts` line 43). The gates directory (`src/templates/gates/`) is loaded separately via `gateRegistry.loadFromDirectory()`; the ship command MUST call `loadFromDirectory` with the project's gates path before constructing the pipeline, or ensure `createCliContext` loads them.

### 3. `tests/merge-safety.test.ts` — add three new test cases using a mock `GateRegistry`

**Case A — all-pass registry:** Construct a `GateRegistry` mock whose `runAll` returns all `{ status: 'pass' }` results. Verify `result.status === 'success'`, the `post-merge-gates` step is `pass`, and the working tree is on the merged commit.

**Case B — failing registry:** Construct a mock whose `runAll` returns one `{ status: 'fail', gate: 'tests' }` result. Verify `result.status === 'failure'`, the `post-merge-gates` step is `fail`, the `rollback` step is `pass`, and the working tree HEAD equals the pre-merge snapshot SHA.

**Case C — no registry:** Construct `MergeSafetyPipeline` with no `gateRegistry` argument. Verify `result.status === 'success'` and `post-merge-gates` detail contains `no gates configured`.

Tests MUST NOT spin up real gate processes. Use a mock that satisfies the `GateRegistry` interface (`run`, `runAll`, `list`).

---

## Impact

**Correctness gain:**
Ship now validates the actual merged tree. Regressions from merge resolution — type drift, interaction-effect test failures, lint violations — are caught before `success` is returned. Main no longer silently carries known-broken state.

**User-observable change:**
- `metta ship` output gains a real `post-merge-gates` step result (pass or fail with gate name).
- A failing gate triggers a rollback: main is reset to its pre-merge state, and the ship command exits non-zero. The user must fix the regression on the source branch and re-ship.
- Ship duration increases by the time required to run build + lint + tests + typecheck (~3 min typical).

**Snapshot tag becomes load-bearing for post-merge rollback:**
The tag `metta/pre-merge/<sourceBranch>` was already created (step 6) and used for in-merge rollback. It now also covers post-merge rollback. Tags are left in place on both success and failure to serve as recovery handles.

**Backwards compatibility:**
- `MergeSafetyPipeline` constructed without a `gateRegistry` continues to work identically. Existing tests require no changes beyond the three additions.
- `ship.ts` change is minimal: one constructor argument added.

**Risk surface:**
- Rollback failure leaves main in an indeterminate state. This path MUST be surfaced loudly (non-zero exit, explicit step detail). Manual `git reset --hard <snapshotTag>` is the recovery.
- If `gateRegistry.loadFromDirectory()` is not called before pipeline construction, the registry will have no gates loaded and the step will pass with `no gates configured`. The wiring in `ship.ts` must load gates before constructing the pipeline.

---

## Out of Scope

- **`--skip-post-merge-gates` flag.** Rejected in discovery. Emergency overrides must go through a separate metta change.
- **Auto-deletion of snapshot tags after successful ship.** Tags are intentional recovery handles; cleanup is a separate concern.
- **Gate execution on the source branch before merge.** That is the responsibility of `metta finalize` (already implemented).
- **Configurable per-gate retry policy.** `GateRegistry.runWithRetry` exists but post-merge gates run once. Retry configuration is a separate capability.
- **Webhook or Slack notification on post-merge gate failure.** Notification integrations are out of scope for this change.
- **Running the `stories-valid` gate post-merge.** Stories validation is a spec-level check, not a build artifact check. Post-merge gate set is: `build`, `lint`, `tests`, `typecheck`.
- **Parallel gate execution.** `GateRegistry.runAll` runs gates sequentially. Parallelisation is a separate performance concern.
- **Changing the dry-run behaviour.** Dry-run continues to skip the `post-merge-gates` step (as it skips the real merge).
