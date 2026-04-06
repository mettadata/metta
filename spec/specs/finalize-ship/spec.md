# Finalize and Ship

## Requirement: Spec Delta Merge

The system MUST merge a change's `spec.md` delta file into the corresponding canonical capability spec when `SpecMerger.merge` is called.

The capability name MUST be derived from the delta spec title by stripping the trailing ` (Delta)` suffix, lower-casing, and replacing whitespace runs with hyphens.

For each delta, the merger MUST apply the following logic:

- `ADDED` delta targeting a capability with no existing `spec.md`: create the capability spec at `specs/<capability>/spec.md` and write a new lock.
- `ADDED` delta targeting an existing capability: append the new requirement section to the existing spec and update the lock.
- `REMOVED` delta: remove the matching `## Requirement: <Name>` section and all content until the next `## Requirement:` heading or end of file.
- `MODIFIED` delta: a conflict MUST be raised if the stored base version differs from the current lock hash and the requirement ID appears in the current lock; otherwise the operation MUST be treated as `ADDED`.

A conflict MUST be recorded as a `MergeConflict` with `capability`, `requirementId`, `reason`, `baseHash`, and `currentHash` fields when:
- The base version hash supplied by the caller differs from the current spec lock hash, AND
- The modified requirement ID exists in the current lock

A merge that produces no conflicts MUST return `status: "clean"`. A merge with one or more conflicts MUST return `status: "conflict"` without writing any files for conflicting deltas.

Dry-run mode MUST compute and return the merge result without writing or updating any files.

When no `spec.md` exists in the change directory the merger MUST return `{ status: "clean", merged: [], conflicts: [] }` immediately.

### Scenario: New capability created from ADDED delta
- GIVEN a change "add-mfa" with a delta spec adding requirement "Multi-Factor Authentication" to capability "auth"
- AND no existing spec at `specs/auth/spec.md`
- WHEN `merge("add-mfa", {})` is called
- THEN `result.status` equals "clean"
- AND `result.merged` contains at least one entry
- AND `specs/auth/spec.md` is created containing the requirement

### Scenario: Conflict detected on modified base
- GIVEN a capability "auth" with an existing spec and lock at hash H
- AND a change delta that modifies requirement "User Login"
- WHEN `merge` is called with `baseVersions["auth/spec.md"]` set to a hash different from H
- THEN `result.status` equals "conflict"
- AND `result.conflicts` contains an entry for requirement "user-login"

### Scenario: Clean merge when base hash matches
- GIVEN a capability "auth" with lock hash H
- AND a change delta that adds requirement "Session Management"
- WHEN `merge` is called with `baseVersions["auth/spec.md"]` equal to H
- THEN `result.status` equals "clean"

### Scenario: Dry-run does not write files
- GIVEN a change with an ADDED delta for a new capability
- WHEN `merge` is called with `dryRun = true`
- THEN `result.status` equals "clean"
- AND no capability spec file is created on disk

### Scenario: No spec.md returns clean immediately
- GIVEN a change directory with no `spec.md` file
- WHEN `merge` is called
- THEN `result.status` equals "clean" and `result.merged` is empty

## Requirement: Finalizer Orchestration

The system MUST orchestrate the finalize lifecycle in this order when `Finalizer.finalize` is called:

1. Load change metadata from `ArtifactStore`
2. Run `SpecMerger.merge` with the stored `base_versions`; abort and return early if status is `"conflict"`
3. Run all registered quality gates via `GateRegistry.runAll`; abort and return early if any gate returns status `"fail"` (when not dry-run)
4. Archive the change via `ArtifactStore.archive`
5. Write gate results to `archive/<archiveName>/gates.yaml`
6. Return `FinalizeResult`

Gate statuses of `"pass"`, `"skip"`, and `"warn"` MUST all be treated as non-blocking. Only `"fail"` blocks finalization.

When no `GateRegistry` is provided, or when the registry contains no registered gates, gate checking MUST be skipped and `gatesPassed` MUST be `true`.

In dry-run mode the system MUST skip archiving, gate result writing, and actual file mutations. The returned `archiveName` MUST be the string `"(dry-run)"`. The change MUST remain in the active changes list.

### Scenario: Successful finalize archives the change
- GIVEN an active change "test-feature"
- AND no spec conflicts
- AND no gate failures
- WHEN `finalize("test-feature")` is called
- THEN `result.archiveName` matches `YYYY-MM-DD-test-feature`
- AND "test-feature" no longer appears in `listChanges`
- AND `result.specMerge.status` equals "clean"

### Scenario: Finalize aborts on spec conflict
- GIVEN a change whose delta produces a merge conflict
- WHEN `finalize` is called
- THEN `result.archiveName` is an empty string
- AND `result.specMerge.status` equals "conflict"
- AND the change remains active

### Scenario: Dry-run leaves change active
- GIVEN an active change "dry-run-test"
- WHEN `finalize("dry-run-test", true)` is called
- THEN `result.archiveName` equals "(dry-run)"
- AND "dry-run-test" still appears in `listChanges`

## Requirement: Merge Safety Pipeline

The system MUST execute a 7-step safety pipeline when `MergeSafetyPipeline.run(sourceBranch, targetBranch)` is called. Each step MUST be recorded as a `MergeSafetyStep` with fields `step`, `status` (`"pass"` | `"fail"` | `"skip"`), and optional `detail`.

The steps MUST execute in this order:

1. **base-drift-check** — resolve `targetBranch` rev; fail and return immediately on git error
2. **dry-run-merge** — attempt `git merge --no-commit --no-ff <sourceBranch>` then abort; if conflicts are detected return `status: "conflict"` immediately
3. **scope-check** — count files changed between branches via `git diff --name-only`; skip on error
4. **gate-verification** — assert that gates passed on the source branch (currently always passes)
5. **snapshot** — create or force-update tag `metta/pre-merge/<sourceBranch>` on `targetBranch`; skip in dry-run
6. **merge** — execute `git merge --no-ff <sourceBranch> -m "chore: merge <sourceBranch>"`; on failure reset hard to snapshot tag; skip in dry-run
7. **post-merge-gates** — verify system integrity after merge; skip in dry-run

In dry-run mode steps 5, 6, and 7 MUST be recorded with status `"skip"` and the pipeline MUST return `status: "success"` without modifying any git state.

On merge failure (step 6), the system MUST attempt `git reset --hard <snapshotTag>` to roll back. The returned status MUST be `"failure"`.

On conflict (step 2), the system MUST call `git merge --abort` before returning.

Successful completion MUST return `status: "success"` with `mergeCommit` (7-char abbreviated SHA) and `snapshotTag`.

### Scenario: Successful merge
- GIVEN a feature branch with one commit ahead of main
- WHEN `run("feature", "main")` is called
- THEN `result.status` equals "success"
- AND all steps have status "pass"
- AND `result.mergeCommit` is defined
- AND `result.snapshotTag` equals "metta/pre-merge/feature"

### Scenario: Dry-run skips git writes
- GIVEN a feature branch ahead of main
- WHEN `run("dry-feature", "main", true)` is called
- THEN `result.status` equals "success"
- AND the step named "merge" has status "skip"
- AND no merge commit is created

### Scenario: Conflict detected
- GIVEN the same file has been modified on both source and target with conflicting content
- WHEN `run("conflict-feature", "main")` is called
- THEN `result.status` equals "conflict"
- AND the "dry-run-merge" step has status "fail"

### Scenario: Base drift does not block merge
- GIVEN the target branch has advanced since the source branch diverged
- WHEN `run("drift-feature", "main")` is called without file conflicts
- THEN `result.status` equals "success"
- AND the "base-drift-check" step has status "pass"
