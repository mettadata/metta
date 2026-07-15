# Finalize and Ship

## Requirement: Spec Delta Merge

The system MUST merge a change's `spec.md` delta file into the corresponding canonical capability spec when `SpecMerger.merge` is called.

The capability name MUST be derived from the delta spec title by stripping the trailing ` (Delta)` suffix, lower-casing, and replacing whitespace runs with hyphens.

For each delta, the merger MUST apply the following logic:

- `ADDED` delta targeting a capability with no existing `spec.md`: create the capability spec at `specs/<capability>/spec.md` and write a new lock.
- `ADDED` delta targeting an existing capability: append the new requirement section to the existing spec and update the lock.
- `MODIFIED` delta: remove the matching `## Requirement: <Name>` section and all content until the next `## Requirement:` heading or end of file, then append the replacement requirement; update the lock.
- `RENAMED` delta: extract the old requirement name from the `Renamed from: <old name>` line in the requirement text, remove the old `## Requirement: <OldName>` section, strip the `Renamed from:` line from the content, append the requirement under its new name, and update the lock.
- `REMOVED` delta: remove the matching `## Requirement: <Name>` section and all content until the next `## Requirement:` heading or end of file; update the lock.

A conflict MUST be recorded as a `MergeConflict` with `capability`, `requirementId`, `reason`, `baseHash`, and `currentHash` fields when:
- The base version hash supplied by the caller differs from the current spec lock hash, AND
- The modified or removed requirement ID exists in the current lock

A merge that produces no conflicts MUST return `status: "clean"`. A merge with one or more conflicts MUST return `status: "conflict"` without writing any files for conflicting deltas.

Dry-run mode MUST compute and return the merge result without writing or updating any files.

When no `spec.md` exists in the change directory the merger MUST return `{ status: "clean", merged: [], conflicts: [] }` immediately.

The `merged` array MUST use the format `<capability>/<requirementId>` for operations on existing capabilities, and `<capability>` when a new capability spec is created.

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

### Scenario: MODIFIED delta replaces requirement text
- GIVEN a capability "auth" with an existing requirement "User Login" at current lock hash H
- AND a delta that modifies "User Login" with new body text
- WHEN `merge` is called with `baseVersions["auth/spec.md"]` equal to H
- THEN `result.status` equals "clean"
- AND `result.merged` contains "auth/user-login"
- AND the updated spec contains the new requirement text
- AND the old scenario is no longer present

### Scenario: RENAMED delta replaces old requirement with new name
- GIVEN a capability "auth" with an existing requirement "User Login" at current lock hash H
- AND a delta that renames "User Login" to "User Authentication" with a "Renamed from: User Login" line
- WHEN `merge` is called with `baseVersions["auth/spec.md"]` equal to H
- THEN `result.status` equals "clean"
- AND `result.merged` contains "auth/user-authentication"
- AND the updated spec contains `## Requirement: User Authentication`
- AND `## Requirement: User Login` is no longer present

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
5. Write gate results to `archive/<archiveName>/gates.yaml` when at least one gate was executed
6. Return `FinalizeResult`

Gate statuses of `"pass"`, `"skip"`, and `"warn"` MUST all be treated as non-blocking. Only `"fail"` blocks finalization.

When no `GateRegistry` is provided, or when the registry contains no registered gates, gate checking MUST be skipped and `gatesPassed` MUST be `true`.

In dry-run mode the system MUST skip archiving, gate result writing, and actual file mutations. The returned `archiveName` MUST be the string `"(dry-run)"`. The change MUST remain in the active changes list.

The `gates.yaml` file written to the archive MUST include:
- `finalized_at`: ISO 8601 datetime
- `all_passed`: boolean
- `results`: array of `{ gate, status, duration_ms }` for each gate result

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

### Scenario: gates.yaml written to archive
- GIVEN an active change and a gate registry with at least one gate
- WHEN `finalize` is called and all gates pass
- THEN `archive/<archiveName>/gates.yaml` exists
- AND it contains `all_passed: true` and a `results` array with `gate`, `status`, and `duration_ms` fields

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

Successful completion MUST return `status: "success"` with `mergeCommit` (full SHA) and `snapshotTag` set to `metta/pre-merge/<sourceBranch>`.

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


## Requirement: Finalize Lock Contention Error Message

When `acquireFinalizeLock` fails to acquire a finalize lock currently held by another live
process, the system MUST throw a `FinalizeLockError` whose message recommends re-running
`metta finalize` to reclaim the lock, and the message MUST NOT instruct the caller to manually
delete the lock file. The existing dead-pid reclaim path (checking process liveness at
acquisition time) MUST remain intact and MUST be exercised automatically the next time
`metta finalize` runs against a lock whose recorded owner pid is dead.

### Scenario: Lock held by a live process recommends a retry, not manual deletion
- GIVEN a finalize lock file for a change, held by a process pid that is confirmed live
- WHEN `acquireFinalizeLock` is called for the same change by a second process
- THEN a `FinalizeLockError` is thrown
- AND its message recommends re-running `metta finalize`
- AND its message does not instruct manual deletion of the lock file

### Scenario: Re-running finalize reclaims a dead-pid lock without manual cleanup
- GIVEN a finalize lock file for a change whose recorded owner pid is dead
- WHEN `metta finalize` is re-run for that change
- THEN `acquireFinalizeLock` reclaims the lock via the existing dead-pid check
- AND finalize proceeds without any manual lock file deletion


## Requirement: Finalize Lock Staleness Fallback Via Mtime

When `acquireFinalizeLock` cannot determine liveness of a lock's recorded owner pid from the
pid-liveness check alone — because the pid has been recycled by an unrelated live process, or
the liveness probe fails with `EPERM` — the system MUST additionally check the lock file's mtime
against a 60-second staleness threshold, consistent with the state store's existing stale-lock
convention, and MUST reclaim the lock when the mtime exceeds that threshold. This mtime-based
fallback MUST NOT alter or replace the existing direct dead-pid reclaim path; it applies only
when pid liveness is ambiguous.

### Scenario: Ambiguous pid liveness with an expired mtime is reclaimed
- GIVEN a finalize lock file whose mtime is older than 60 seconds
- AND the recorded owner pid currently belongs to an unrelated live process (recycled), or the
liveness probe raises `EPERM` when checking it
- WHEN `acquireFinalizeLock` runs for that change
- THEN the lock is treated as stale
- AND the lock is reclaimed without throwing `FinalizeLockError`

### Scenario: Fresh lock with a confirmed live owner is respected
- GIVEN a finalize lock file whose mtime is within the 60-second staleness threshold
- AND the recorded owner pid is confirmed live and matches the original owner
- WHEN `acquireFinalizeLock` runs for that change
- THEN the lock is respected
- AND `FinalizeLockError` is thrown

### Scenario: Dead-pid reclaim path is preserved alongside the mtime fallback
- GIVEN a finalize lock file with a dead owner pid, regardless of the lock file's mtime age
- WHEN `acquireFinalizeLock` runs for that change
- THEN the existing dead-pid reclaim path acquires the lock
- AND the mtime fallback is not required to determine reclaim eligibility


## Requirement: Stale Finalize Lock Surfaced In Status

When a finalize lock exists for the active change and is stale (its recorded owner pid is dead,
or it is mtime-expired under the Finalize Lock Staleness Fallback Via Mtime requirement),
`metta status` MUST include a line in its output indicating that a stale finalize lock was
detected and that it is safe to retry finalize. `metta status` output for a change with no
finalize lock, or with a fresh lock held by a live process, MUST be unchanged by this behavior.

### Scenario: Status reports a detected stale lock
- GIVEN the active change has a finalize lock that is stale (dead-pid or mtime-expired)
- WHEN `metta status` is run
- THEN the output includes a line indicating a stale finalize lock was detected
- AND the line indicates it is safe to retry finalize

### Scenario: Status is unchanged when no stale lock is present
- GIVEN the active change has no finalize lock, or has a fresh lock held by a live process
- WHEN `metta status` is run
- THEN the output contains no stale-lock detection line
- AND all other existing status output is unaffected


## Requirement: Stale Finalize Lock Surfaced In Next Routing

When a finalize lock exists for the active change and is stale (its recorded owner pid is dead,
or it is mtime-expired under the Finalize Lock Staleness Fallback Via Mtime requirement),
`metta next` MUST surface the stale-lock detection in its routing output instead of routing the
orchestrator directly into a finalize invocation that would fail with `FinalizeLockError`.
`metta next` output for a change with no finalize lock, or with a fresh lock held by a live
process, MUST be unchanged by this behavior.

### Scenario: Next surfaces the stale lock instead of routing into a failing finalize
- GIVEN the active change has a finalize lock that is stale (dead-pid or mtime-expired)
- AND the next logical routing step would otherwise be to run finalize
- WHEN `metta next` is run
- THEN the output surfaces the stale-lock detection with a safe-to-retry indication
- AND the output does not route the orchestrator into a finalize call that would throw
`FinalizeLockError`

### Scenario: Next routing is unchanged when no stale lock is present
- GIVEN the active change has no finalize lock, or has a fresh lock held by a live process
- WHEN `metta next` is run
- THEN routing output is unchanged from existing behavior
- AND no stale-lock warning appears
