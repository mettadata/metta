# Intent: fix-issue-metta-ship-merged-fi

## Problem

`metta ship`'s `MergeSafetyPipeline` (`src/ship/merge-safety.ts`) has no awareness of
whether the change being merged was successfully finalized. The pipeline enforces a
clean working tree, conflict-free merge, ancestry verification, and snapshot rollback —
but it has no notion of "did this change pass all finalize gates?"

This allows the following sequence, which metta exists to prevent:

1. Developer runs `metta finalize`. The `stories-valid` gate fails. Finalize aborts with
   "Quality gates failed". No archive directory is created.
2. Developer runs `metta ship` on the same branch. `MergeSafetyPipeline.run()` proceeds
   through all existing steps — none of which check finalize state. The merge succeeds.
3. The branch lands on main carrying spec violations that finalize explicitly blocked.

This is not a theoretical risk. It happened during the T5 shipment: `stories-valid`
failed during finalize, finalize aborted, and ship merged the branch anyway. The
violation was only caught by manual inspection of the finalize log after the merge.

The root cause is `gate-verification` in the pipeline (`src/ship/merge-safety.ts`,
line 110): it unconditionally emits `{ step: 'gate-verification', status: 'pass' }` with
no actual check. There is no guard at pipeline entry either. Any state the finalize
command wrote (or failed to write) is invisible to ship.

The detection signal already exists: `metta finalize` only creates
`spec/archive/<date>-<change>/` when all gates pass. The directory's existence is the
proof of finalization. Ship has never read it.

## Proposal

Add a `finalize-check` preflight step to `MergeSafetyPipeline.run()` in
`src/ship/merge-safety.ts`. This step MUST execute FIRST — before the existing
`preflight` step and before any git operations.

### Step logic

1. Derive the change name from `sourceBranch` by stripping the `metta/` prefix.
   Example: `metta/fix-issue-metta-ship-merged-fi` → `fix-issue-metta-ship-merged-fi`.
2. Glob `spec/archive/*-<change-name>/` within `this.cwd`. The date prefix is variable;
   only the suffix (the change name slug) is stable.
3. If zero matches are found: push
   `{ step: 'finalize-check', status: 'fail', detail: 'change not finalized — run metta finalize --change <name> first' }`
   and return `{ status: 'failure', steps }` immediately. No git operations run.
4. If one or more matches are found: push
   `{ step: 'finalize-check', status: 'pass', detail: '<matched-archive-path>' }`
   and continue to the existing `preflight` step.

### Source branch naming scope

The step applies only when `sourceBranch` starts with `metta/`. For branches that do
not follow this convention the step MUST be skipped with
`{ step: 'finalize-check', status: 'skip', detail: 'non-metta branch — skipping finalize check' }`
and pipeline execution continues normally.

### Failure surface

When `finalize-check` fails, `metta ship` output MUST display:

```
✗ finalize-check (change not finalized — run metta finalize --change <name> first)
```

No merge commit, no snapshot tag, no git mutations of any kind occur.

### Tests — `tests/merge-safety.test.ts`

Two new test cases:

1. **Unfinalized branch is blocked.** Set up a `metta/` prefixed source branch. Do not
   create an archive directory. Call `pipeline.run()`. Assert `result.status === 'failure'`,
   assert `result.steps[0]` is `{ step: 'finalize-check', status: 'fail', ... }`, assert
   the target branch HEAD is unchanged (no merge happened).

2. **Finalized branch passes check.** Same setup, but create
   `spec/archive/2026-04-15-<change-name>/` inside `tempDir` before calling `run()`.
   Assert the pipeline reaches at least the `preflight` step (does not abort at
   `finalize-check`).

Existing tests use bare branch names (`feature`, `dry-feature`, `drift-feature`,
`conflict-feature`) — none start with `metta/`. The new step MUST skip for these
branches so no existing test is broken. Confirm this is true by running the full
`merge-safety.test.ts` suite after implementation.

## Impact

- `metta ship` now refuses to merge any `metta/`-prefixed branch that was not
  successfully finalized. Users who follow the documented `finalize → ship` order
  observe no change in behavior.
- The `gate-verification` step (`src/ship/merge-safety.ts`, line 110) that currently
  emits an unconditional pass remains in place for post-merge gate logic but is no
  longer the sole guard against unfinalized merges.
- The T5 merge (already on main) is unaffected. This fix prevents recurrence; it does
  not revert history.
- Existing `tests/merge-safety.test.ts` fixtures use non-`metta/` branch names and
  require no archive directory setup — they continue to pass as-is.
- Developers who run `metta ship` on an unfinalized change receive a clear, actionable
  error message naming the exact command to run (`metta finalize --change <name>`).

## Out of Scope

- **Auto-running finalize from ship.** Ship and finalize are strictly separated commands.
  Ship MUST NOT invoke finalize internally, even as a convenience. Rejected during
  discovery.
- **Reverting the T5 merge.** The branch is on main and working in production. The
  stories-valid gate failure in T5 was resolved in a follow-up commit. No rollback.
- **A `--force-unfinalized` flag.** There is no override. If a user needs to bypass the
  check they must create the archive directory manually, which is intentionally
  inconvenient.
- **Validating which specific gates passed during finalize.** Archive directory existence
  IS the proof. Parsing `spec/archive/<change>/gates.yaml` for individual gate results
  is not required and would couple ship to the finalize output schema.
- **Checking finalize state for non-`metta/` branches.** External branches, hotfixes,
  and backport branches follow different conventions. The step skips for all branches
  without the `metta/` prefix.
- **Modifying `metta finalize` itself.** The archive creation contract is already
  correct. This change is entirely within `src/ship/merge-safety.ts` and its test file.
