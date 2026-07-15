# finalize-ship

## ADDED: Requirement: Explicit Capability Target Selection In Spec Authoring

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

## ADDED: Requirement: Merge Target Confirmation At Completion

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

## MODIFIED: Requirement: Spec Delta Merge

The system MUST merge a change's `spec.md` delta file into the corresponding canonical capability spec when `SpecMerger.merge` is called.

The capability name MUST be derived from the delta's explicit merge-target selection (an existing capability slug, or an explicit new-capability confirmation) rather than solely by stripping the trailing ` (Delta)` suffix from the H1, lower-casing, and replacing whitespace runs with hyphens; the title-derived slug remains available as the capability name once a target has been confirmed by that selection.

For each delta, the merger MUST apply the following logic:

- `ADDED` delta targeting a capability with no existing spec: create the capability spec and write a new lock.
- `ADDED` delta targeting an existing capability: check whether a `## Requirement: <Name>` section with the same requirement name already exists in the target spec, using the same lookup the MODIFIED/RENAMED/REMOVED branches use. If no matching section exists, append the new requirement section and update the lock. If a matching section already exists, the merge MUST NOT append a duplicate: it MUST treat the requirement as a no-op (excluded from `merged`) or surface it as an explicit conflict, and this idempotency check MUST apply even when no `base_versions` entry exists for the target capability (for example, because the change itself created that capability).
- `MODIFIED` delta: remove the matching `## Requirement: <Name>` section and all content until the next `## Requirement:` heading or end of file, then append the replacement requirement; update the lock.
- `RENAMED` delta: extract the old requirement name from the `Renamed from: <old name>` line, remove the old section, strip the `Renamed from:` line, append the requirement under its new name, and update the lock.
- `REMOVED` delta: remove the matching section and all content until the next `## Requirement:` heading or end of file; update the lock.

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

## MODIFIED: Requirement: Finalizer Orchestration

The system MUST orchestrate the finalize lifecycle in this order when `Finalizer.finalize` is called:

1. Load change metadata from `ArtifactStore`.
2. Check the completion state of every workflow-required artifact recorded in the change's metadata. If any required artifact is not `complete`, abort immediately and return a distinct, clearly labeled failure (for example, an `incompleteArtifacts` result field mapped to a non-zero CLI exit) listing each incomplete artifact by name. No spec-merge computation, gate execution, disk write, or archiving occurs when this check fails.
3. Run `SpecMerger.merge` with the stored `base_versions` in dry-run mode to detect conflicts without writing any file; abort and return early if status is `"conflict"`.
4. Run all registered quality gates via `GateRegistry.runAll`; abort and return early if any gate returns status `"fail"` (when not dry-run). No spec-merge content produced by this run has been written to disk at this point.
5. Only once gates have passed (or been skipped/warned), write the spec merge to disk for real.
6. Archive the change via `ArtifactStore.archive`.
7. Write gate results to `archive/<archiveName>/gates.yaml` when at least one gate was executed.
8. Return `FinalizeResult`.

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

## ADDED: Requirement: Trivial Workflow Verification Artifact Contract Agreement

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
