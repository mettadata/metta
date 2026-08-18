# UAT: fix-finalize-dry-run-diverges-applying-run-spec

- **Change**: fix-finalize-dry-run-diverges-applying-run-spec
- **Generated**: 2026-08-18
- **Source**: spec scenarios (spec.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### Spec Delta Merge

#### Step 1.1: New capability created from a confirmed ADDED delta
- **Setup**: a change with a delta adding requirement "Multi-Factor Authentication" and an explicit new-capability confirmation for capability "auth"; no existing spec for "auth"
- **Do**: `merge` is called
- **Observe**: `result.status` equals "clean", `result.merged` contains an entry, and the "auth" capability spec is created containing the requirement
- **Machine-verified** — summary.md references "Spec Delta Merge"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.2: Re-applying an ADDED delta does not duplicate an existing requirement
- **Setup**: a capability "auth" whose spec already contains "## Requirement: Session Management"; a delta that re-applies an ADDED operation for "Session Management"
- **Do**: `merge` is called against that delta a second time
- **Observe**: the "auth" capability spec contains exactly one "## Requirement: Session Management" section; the second application is reported as a no-op or an explicit conflict, never a second append
- **Machine-verified** — summary.md references "Spec Delta Merge"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.3: ADDED idempotency holds without a base_versions entry
- **Setup**: a capability that was created by this same change's own earlier ADDED delta, so no `base_versions` entry exists for it; the change's finalize is retried
- **Do**: the ADDED delta is re-applied via `merge`
- **Observe**: the already-present requirement section is not duplicated despite the absence of a base_versions comparison
- **Machine-verified** — summary.md references "Spec Delta Merge"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.4: Dry-run reports requirement not found for a MODIFIED delta against an absent requirement
- **Setup**: a capability spec that does not contain requirement "Ghost Requirement"; a change delta with a MODIFIED operation targeting "Ghost Requirement"
- **Do**: `merge` is called with `dryRun: true`
- **Observe**: `result.status` equals "conflict"; `result.conflicts` contains an entry for that requirement with reason "requirement not found"; the entry does not appear in `result.merged`
- **Machine-verified** — summary.md references "Spec Delta Merge"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 1.5: Dry-run classifies an ADDED duplicate as a noop, matching apply
- **Setup**: a capability spec that already contains the requirement named by an ADDED delta
- **Do**: `merge` is called once with `dryRun: true` and once with `dryRun: false` against the same spec-store state
- **Observe**: both results list `${capability}/${requirementId}` under `noops`; neither result lists it under `merged`
- **Machine-verified** — summary.md references "Spec Delta Merge"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

### Dry-Run And Apply Merge Result Parity

#### Step 2.1: Dry-run and apply return identical results for the same fixture set
- **Setup**: a change delta spec containing a mix of ADDED, MODIFIED, RENAMED, and REMOVED deltas, including at least one that conflicts and at least one ADDED duplicate
- **Do**: `merge` is called with `dryRun: true`, and then `merge` is called with `dryRun: false` against an identical pre-merge spec-store state
- **Observe**: both calls return the same `status`; the `merged`, `conflicts`, and `noops` arrays of both results contain the same entries
- **Machine-verified** — summary.md references "Dry-Run And Apply Merge Result Parity"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 2.2: Preflight dry-run catches an apply-time-only conflict class
- **Setup**: a change whose delta spec contains a REMOVED operation targeting a requirement absent from the capability spec
- **Do**: the finalizer runs its conflict-detection step using a dry-run merge
- **Observe**: the finalize aborts at the conflict-detection step with that conflict reported; the applying merge step is never reached
- **Machine-verified** — summary.md references "Dry-Run And Apply Merge Result Parity"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

### All-Or-Nothing Spec Merge Apply

#### Step 3.1: Conflicting delta N leaves the spec store byte-identical
- **Setup**: a change delta spec where the first two deltas reconcile cleanly and the third produces a "requirement not found" conflict
- **Do**: `merge` is called with `dryRun: false`
- **Observe**: `result.status` equals "conflict"; every file under `spec/specs/` and every spec-lock entry is byte-identical to its pre-merge state; the two clean deltas were not written
- **Machine-verified** — summary.md references "All-Or-Nothing Spec Merge Apply"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 3.2: Zero-conflict multi-delta merge commits every staged result
- **Setup**: a change delta spec with multiple deltas across one or more capabilities, none of which conflict
- **Do**: `merge` is called with `dryRun: false`
- **Observe**: `result.status` equals "clean"; each affected capability spec file on disk contains the merged content for all of its deltas; each affected capability's spec lock is updated to match the written content
- **Machine-verified** — summary.md references "All-Or-Nothing Spec Merge Apply"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

### Staged Composition Of Same-Capability Deltas

#### Step 4.1: A later delta composes with an earlier delta against the same capability
- **Setup**: a change delta spec that first ADDs requirement "Rate Limiting" to capability "auth" and then MODIFIEDs "Rate Limiting" in a subsequent delta
- **Do**: `merge` is called with `dryRun: false`
- **Observe**: `result.status` equals "clean"; the "auth" spec file contains exactly one "## Requirement: Rate Limiting" section carrying the MODIFIED text; no "requirement not found" conflict is reported for the MODIFIED delta
- **Machine-verified** — summary.md references "Staged Composition Of Same-Capability Deltas"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.2: Dry-run classifies composed same-capability deltas identically
- **Setup**: the same ADDED-then-MODIFIED delta pair targeting one capability
- **Do**: `merge` is called with `dryRun: true`
- **Observe**: `result.status` equals "clean"; both deltas appear under `merged`, matching the applying-mode classification
- **Machine-verified** — summary.md references "Staged Composition Of Same-Capability Deltas"; gates all passed (tests, lint, typecheck, build)
- [ ] Pass
