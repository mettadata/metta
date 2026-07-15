# Finalize and Ship

## Requirement: Spec Delta Merge

The system MUST merge a change's `spec.md` delta file into the corresponding canonical capability spec when `SpecMerger.merge` is called.
The capability name MUST be derived from the delta's explicit merge-target selection (an existing capability slug, or an explicit new-capability confirmation) rather than solely by stripping the trailing ` (Delta)` suffix from the H1, lower-casing, and replacing whitespace runs with hyphens; the title-derived slug remains available as the capability name once a target has been confirmed by that selection.
For each delta, the merger MUST apply the following logic:
A conflict MUST be recorded as a `MergeConflict` with `capability`, `requirementId`, `reason`, `baseHash`, and `currentHash` fields when the base version hash supplied by the caller differs from the current spec lock hash AND the modified or removed requirement ID exists in the current lock. A merge that produces no conflicts MUST return `status: "clean"`; a merge with one or more conflicts MUST return `status: "conflict"` without writing files for the conflicting deltas. Dry-run mode MUST compute and return the merge result without writing or updating any files. When no `spec.md` exists in the change directory the merger MUST return `{ status: "clean", merged: [], conflicts: [] }` immediately.
Fulfills: US-5

### Scenario: New capability created from a confirmed ADDED delta
- GIVEN a change with a delta adding requirement "Multi-Factor Authentication" and an explicit new-capability confirmation for capability "auth"
- AND no existing spec for "auth"
- WHEN `merge` is called
- THEN `result.status` equals "clean", `result.merged` contains an entry, and the "auth" capability spec is created containing the requirement

### Scenario: Re-applying an ADDED delta does not duplicate an existing requirement
- GIVEN a capability "auth" whose spec already contains "## Requirement: Session Management"
- AND a delta that re-applies an ADDED operation for "Session Management"
- WHEN `merge` is called against that delta a second time
- THEN the "auth" capability spec contains exactly one "## Requirement: Session Management" section
- AND the second application is reported as a no-op or an explicit conflict, never a second append

### Scenario: ADDED idempotency holds without a base_versions entry
- GIVEN a capability that was created by this same change's own earlier ADDED delta, so no `base_versions` entry exists for it
- AND the change's finalize is retried
- WHEN the ADDED delta is re-applied via `merge`
- THEN the already-present requirement section is not duplicated despite the absence of a base_versions comparison

## Requirement: Finalizer Orchestration

The system MUST orchestrate the finalize lifecycle in this order when `Finalizer.finalize` is called:
Gate statuses of `"pass"`, `"skip"`, and `"warn"` MUST all be treated as non-blocking; only `"fail"` blocks finalization. When no `GateRegistry` is provided, or the registry has no registered gates, gate checking MUST be skipped and `gatesPassed` MUST be `true`. In dry-run mode the system MUST skip archiving, gate result writing, and actual file mutations; the returned `archiveName` MUST be `"(dry-run)"` and the change MUST remain in the active changes list.
A run that fails at the artifact-completeness check, the conflict-detection step, or the gate-execution step MUST leave the target capability's spec files unchanged on disk: no content from this change's delta is written before all three checks have passed. A retried `finalize` after such a failure MUST NOT compound or duplicate already-merged content.
Fulfills: US-3, US-6

### Scenario: Incomplete artifact blocks finalize before gates or merge run
- GIVEN an active change whose metadata marks a workflow-required artifact (for example, "verification") as not `complete`
- WHEN `finalize` is called for that change
- THEN the result reports an incomplete-artifacts failure listing that artifact by name
- AND no gates run, no spec-merge content is written, and the change is not archived

### Scenario: Gate failure leaves the target capability spec untouched
- GIVEN an active change with all required artifacts `complete`, a clean (non-conflicting) delta, and at least one configured gate that will fail
- WHEN `finalize` is called
- THEN the result reports the gate failure with a non-zero CLI exit
- AND a diff of the target capability's spec file taken before and after the run shows no changes

### Scenario: Retry after a fixed gate applies the merge exactly once
- GIVEN a prior `finalize` attempt failed at the gate-execution step for a change with an ADDED delta
- AND the gate issue has since been fixed
- WHEN `finalize` is called again for the same change
- THEN gates pass, the spec merge is written to disk, and the target capability's spec file contains exactly one section for the delta's requirement

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


## Requirement: Explicit Capability Target Selection In Spec Authoring

When generating spec-authoring instructions for an active change, the system MUST enumerate the existing capability slugs present in the spec store and present that list to the author as candidate merge targets before the spec delta artifact is authored. The generated spec artifact scaffold MUST require the author to record an explicit merge-target decision — either the slug of one of the listed existing capabilities, or an explicit new-capability confirmation marker (`<!-- new-capability -->` placed immediately under the H1) declaring intent to create a capability that does not yet exist. The scaffold's H1 title text alone MUST NOT be treated as an implicit merge-target default equal to the change's own slug.
Fulfills: US-1

### Scenario: Instructions surface existing capabilities before authoring
- GIVEN a project with existing capabilities in the spec store
- WHEN the author runs the spec-authoring instructions flow for an active change
- THEN the generated instructions list the existing capability slugs and direct the author to select one, or add the new-capability marker, before writing delta content

### Scenario: Generated scaffold carries an explicit target field, not an implicit slug default
- GIVEN the spec artifact scaffold is rendered for a change named "my-change-slug"
- WHEN the author inspects the generated scaffold
- THEN it contains an explicit merge-target selection point (an existing capability slug or the new-capability marker) rather than the H1 silently defaulting to "my-change-slug" as the merge target


## Requirement: Merge Target Confirmation At Completion

`metta complete spec` MUST resolve the delta's merge-target capability from the explicit selection recorded per the Explicit Capability Target Selection In Spec Authoring requirement, not from the H1 text alone. When the resolved target equals the change's own slug, no capability of that slug currently exists in the spec store, and the delta does not carry the new-capability confirmation marker, `metta complete spec` MUST refuse to complete the artifact: it MUST exit non-zero, name the unrecognized/unconfirmed target capability, and MUST NOT create any file or folder under the spec store. When the new-capability marker is present, completion MUST succeed and the confirmed capability MUST be recorded as the merge target. This validation MUST NOT change the existing hard-fail behavior for MODIFIED, REMOVED, or RENAMED delta operations that target a capability with no existing spec: those continue to fail non-zero with no writes.
Fulfills: US-2

### Scenario: Unconfirmed self-slug target is refused
- GIVEN an ADDED-only delta whose resolved capability slug equals the change's own slug, no capability folder of that slug exists, and no new-capability marker is present
- WHEN `metta complete spec` runs
- THEN it exits non-zero, names the unrecognized/unconfirmed target capability, and no folder is created under the spec store

### Scenario: Explicit new-capability marker allows completion
- GIVEN the same delta but with the new-capability confirmation marker present
- WHEN `metta complete spec` runs
- THEN completion succeeds and the confirmed capability is recorded as the merge target

### Scenario: Non-ADDED operations against a nonexistent capability still hard-fail
- GIVEN a delta containing MODIFIED, REMOVED, or RENAMED operations that target a capability with no existing spec
- WHEN `metta complete spec` runs
- THEN it exits non-zero and no writes occur, unchanged from prior behavior


## Requirement: Trivial Workflow Verification Artifact Contract Agreement

The trivial workflow's verification stage `generates` declaration and the instructions actually presented to whichever agent performs trivial-tier verification MUST agree on the artifact filename produced. Following the trivial-tier verification instructions exactly as authored MUST result in a file being written at the path the `generates` declaration names, so that `metta complete verification` can succeed without any file having been produced through an undocumented, out-of-band convention.
Fulfills: US-4

### Scenario: Declared contract and instructed behavior agree
- GIVEN the trivial workflow template as shipped
- WHEN the verification stage's `generates` declaration is compared against what the trivial-tier verification instructions direct an agent to write
- THEN the two agree exactly: the file the instructions direct the agent to produce is the same file the `generates` declaration names

### Scenario: Following instructions lets completion succeed
- GIVEN a trivial-tier change whose verification stage was executed exactly per the instructions
- WHEN the author runs `metta complete verification`
- THEN the command exits zero and the verification artifact transitions to `complete`

### Scenario: Finalize completeness gate passes without manual patching
- GIVEN a fully-executed trivial-tier change whose verification artifact is `complete` per the corrected contract
- WHEN `metta finalize` runs
- THEN the artifact-completeness check passes without any manual creation or renaming of files by the author
