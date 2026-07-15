# Implementation Summary: fix-finalize-spec-merge-pipeline-hardening

## What changed

The finalize/spec-merge pipeline no longer performs irreversible writes before validating them. Three logged issues resolved in one change.

- **Idempotent ADDED merges** (`src/finalize/spec-merger.ts`): the ADDED branch now checks `sections.has(name)` and returns a no-op instead of blindly appending; `MergeResult` gained a `noops` field. Re-running a finalize can no longer duplicate requirements (the defect that quadruplicated the adaptive-workflow-tier-selection spec).
- **Completeness gate + gates-before-write ordering** (`src/finalize/finalizer.ts`, `src/cli/commands/finalize.ts`): finalize now (1) refuses to proceed when any workflow-required artifact isn't `complete`, returning `incompleteArtifacts`; (2) dry-runs the merge for conflict detection, runs gates, and only writes merged specs to disk after gates pass — invariant: a failed finalize leaves `spec/specs/` byte-identical. The CLI reports in pipeline order (incomplete → conflict → gates), fixing the latent bug where conflicts were misreported as empty gate failures.
- **Explicit capability targeting** (`src/cli/commands/complete.ts`, `src/finalize/spec-merger.ts`, `src/context/instruction-generator.ts`, `src/templates/artifacts/spec.md`): a delta spec whose H1 resolves to the change's own slug with no existing capability is rejected with a typed `SpecTargetError` unless the author explicitly opts in with a `<!-- new-capability -->` marker under the H1. Spec-authoring instructions now include `existing_specs` (the list of capabilities) and guidance under the H1. This closes the capability-landfill mechanism (13+ junk folders minted by unedited titles).
- **Verify template contract** (`src/templates/artifacts/verify.md`): the shared template now instructs saving as `summary.md`, matching every tier's `generates:` — fixing the trivial-workflow mismatch where `metta complete verification` demanded a file nothing instructed anyone to write.

## Requirement coverage

All 5 finalize-ship delta requirements: Explicit Capability Target Selection In Spec Authoring (US-1), Merge Target Confirmation At Completion (US-2), Spec Delta Merge MODIFIED (US-5), Finalizer Orchestration MODIFIED (US-3, US-6), Trivial Workflow Verification Artifact Contract Agreement (US-4).

## Verification

Full suite 1096/1096 (82 files, +19 new tests); tsc, build clean; dist template propagation verified. Advisory constitution check: one major finding (bare-string throw) fixed in planning via typed SpecTargetError before execution.

## Implementation commits

- `14f66b6fb` fix: idempotent ADDED merges in spec-merger
- `a515fcd93` test: ADDED idempotency coverage
- `df26c20ea` fix: completeness gate and gates-before-write ordering in finalizer
- `033554430` test: finalizer ordering and CLI exit-order coverage
- `55d024052` feat: explicit capability targeting in spec authoring instructions
- `a51d09e67` feat: capability-target refusal gate in metta complete
- `0248f4f92` test: capability targeting coverage
- `a6f8d691c` fix: verify template instructs saving as summary.md
- `d7831bba4` test: verify template contract coverage

## Issues resolved

- spec-delta-artifact-template-pre-fills-the-h1-with-the (major)
- metta-finalize-does-not-require-all-workflow-artifacts-to-be (major)
- spec-specs-adaptive-workflow-tier-selection-spec-md-contains (minor; file deduped 2026-07-14, mechanism fixed here)
