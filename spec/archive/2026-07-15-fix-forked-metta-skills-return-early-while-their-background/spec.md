# finalize-ship

<!--
US-1/US-2 (fork synchronous-completion contract, guard-bash background rejection) are covered by
stories acceptance criteria and tests; no capability spec currently owns the orchestration
contract — see issue
spec-delta-artifact-template-pre-fills-the-h1-with-the for the single-capability delta limitation.
-->

## ADDED: Requirement: Finalize Lock Contention Error Message

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

## ADDED: Requirement: Finalize Lock Staleness Fallback Via Mtime

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

## ADDED: Requirement: Stale Finalize Lock Surfaced In Status

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

## ADDED: Requirement: Stale Finalize Lock Surfaced In Next Routing

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
