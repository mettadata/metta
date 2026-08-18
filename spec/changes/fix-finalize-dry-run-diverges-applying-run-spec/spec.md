# finalize-ship

## MODIFIED: Requirement: Spec Delta Merge

The system MUST merge a change's `spec.md` delta file into the corresponding canonical capability spec when `SpecMerger.merge` is called.
The capability name MUST be derived from the delta's explicit merge-target selection (an existing capability slug, or an explicit new-capability confirmation) rather than solely by stripping the trailing ` (Delta)` suffix from the H1, lower-casing, and replacing whitespace runs with hyphens; the title-derived slug remains available as the capability name once a target has been confirmed by that selection.
The merger MUST evaluate the full conflict-detection set for every delta in both dry-run and applying mode:
- **capability-not-found** — a non-ADDED delta (or an ADDED delta without new-capability standing) targeting a capability with no spec on disk MUST produce a conflict;
- **base-version conflict** — when the base version hash supplied by the caller differs from the current spec lock hash AND the modified or removed requirement ID exists in the current lock, a conflict MUST be recorded;
- **requirement-not-found** — a MODIFIED, RENAMED, or REMOVED delta targeting a requirement absent from the current (or staged) capability content MUST produce a conflict with reason `requirement not found`.
Each conflict MUST be recorded as a `MergeConflict` with `capability`, `requirementId`, `reason`, `baseHash`, and `currentHash` fields. A merge that produces no conflicts MUST return `status: "clean"`; a merge with one or more conflicts MUST return `status: "conflict"` and MUST NOT write any spec file or lock entry, including for non-conflicting deltas in the same run. An ADDED delta whose requirement name already exists in the target capability MUST be classified as a no-op in `noops` in both dry-run and applying mode; the previous caveat that dry-run may report such an entry under `merged` no longer holds. Dry-run mode MUST compute and return the merge result without writing or updating any files. When no `spec.md` exists in the change directory the merger MUST return `{ status: "clean", merged: [], conflicts: [] }` immediately.
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

### Scenario: Dry-run reports requirement not found for a MODIFIED delta against an absent requirement
- GIVEN a capability spec that does not contain requirement "Ghost Requirement"
- AND a change delta with a MODIFIED operation targeting "Ghost Requirement"
- WHEN `merge` is called with `dryRun: true`
- THEN `result.status` equals "conflict"
- AND `result.conflicts` contains an entry for that requirement with reason "requirement not found"
- AND the entry does not appear in `result.merged`

### Scenario: Dry-run classifies an ADDED duplicate as a noop, matching apply
- GIVEN a capability spec that already contains the requirement named by an ADDED delta
- WHEN `merge` is called once with `dryRun: true` and once with `dryRun: false` against the same spec-store state
- THEN both results list `${capability}/${requirementId}` under `noops`
- AND neither result lists it under `merged`

## ADDED: Requirement: Dry-Run And Apply Merge Result Parity

For identical inputs — the same change delta spec, the same `baseVersions` map, and the same spec-store state on disk — `SpecMerger.merge` in dry-run mode MUST return the same `status` and the same `merged`, `conflicts`, and `noops` classifications as an applying merge. No conflict class MAY be reachable only in applying mode: every check that can produce a `MergeConflict` during apply MUST also run during dry-run. This guarantee exists so the finalizer's preflight dry-run gate structurally catches every conflict the later applying merge would catch; an applying-merge conflict after a clean dry-run within the same finalize can only indicate spec-store drift between the two calls, not a known dry-run blind spot. Traces to the intent problem statement: dry-run previously validated only capability existence and base-version hashes, so MODIFIED/RENAMED/REMOVED deltas against absent requirements passed dry-run as clean and then conflicted at apply time.

### Scenario: Dry-run and apply return identical results for the same fixture set
- GIVEN a change delta spec containing a mix of ADDED, MODIFIED, RENAMED, and REMOVED deltas, including at least one that conflicts and at least one ADDED duplicate
- WHEN `merge` is called with `dryRun: true`, and then `merge` is called with `dryRun: false` against an identical pre-merge spec-store state
- THEN both calls return the same `status`
- AND the `merged`, `conflicts`, and `noops` arrays of both results contain the same entries

### Scenario: Preflight dry-run catches an apply-time-only conflict class
- GIVEN a change whose delta spec contains a REMOVED operation targeting a requirement absent from the capability spec
- WHEN the finalizer runs its conflict-detection step using a dry-run merge
- THEN the finalize aborts at the conflict-detection step with that conflict reported
- AND the applying merge step is never reached

## ADDED: Requirement: All-Or-Nothing Spec Merge Apply

An applying `SpecMerger.merge` MUST be all-or-nothing at the delta-reconciliation level: it MUST first reconcile every delta against in-memory content (the compute phase) and MUST perform disk writes (the commit phase) only when the compute phase produced zero conflicts. If any delta in the run produces a `MergeConflict`, the merger MUST return `status: "conflict"` having written zero capability spec files and zero spec-lock entries — the spec store MUST be byte-identical to its pre-merge state, regardless of how many earlier deltas in the run reconciled cleanly. Traces to the intent problem statement: the per-delta write loop previously committed deltas 1..N−1 before delta N's conflict was detected, leaving the living spec store half-merged with no rollback.

### Scenario: Conflicting delta N leaves the spec store byte-identical
- GIVEN a change delta spec where the first two deltas reconcile cleanly and the third produces a "requirement not found" conflict
- WHEN `merge` is called with `dryRun: false`
- THEN `result.status` equals "conflict"
- AND every file under `spec/specs/` and every spec-lock entry is byte-identical to its pre-merge state
- AND the two clean deltas were not written

### Scenario: Zero-conflict multi-delta merge commits every staged result
- GIVEN a change delta spec with multiple deltas across one or more capabilities, none of which conflict
- WHEN `merge` is called with `dryRun: false`
- THEN `result.status` equals "clean"
- AND each affected capability spec file on disk contains the merged content for all of its deltas
- AND each affected capability's spec lock is updated to match the written content

## ADDED: Requirement: Staged Composition Of Same-Capability Deltas

When multiple deltas in a single merge target the same capability, the compute phase MUST thread staged content forward: each subsequent delta MUST reconcile against the in-memory content produced by the prior deltas in the same run, not against the stale on-disk file, and the committed file (in applying mode) MUST reflect the composition of all of that capability's deltas applied in order. Staged composition MUST hold identically for dry-run classification, so a later delta that depends on an earlier delta in the same change (for example, MODIFIED of a requirement the same change ADDED) is classified as clean in both modes. Traces to the intent proposal: capability content is loaded once per capability and staged results carry final merged file content plus a pending lock update.

### Scenario: A later delta composes with an earlier delta against the same capability
- GIVEN a change delta spec that first ADDs requirement "Rate Limiting" to capability "auth" and then MODIFIEDs "Rate Limiting" in a subsequent delta
- WHEN `merge` is called with `dryRun: false`
- THEN `result.status` equals "clean"
- AND the "auth" spec file contains exactly one "## Requirement: Rate Limiting" section carrying the MODIFIED text
- AND no "requirement not found" conflict is reported for the MODIFIED delta

### Scenario: Dry-run classifies composed same-capability deltas identically
- GIVEN the same ADDED-then-MODIFIED delta pair targeting one capability
- WHEN `merge` is called with `dryRun: true`
- THEN `result.status` equals "clean"
- AND both deltas appear under `merged`, matching the applying-mode classification
