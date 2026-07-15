# fix-finalize-spec-merge-pipeline-hardening

## Problem

The finalize/spec-merge pipeline (`src/finalize/finalizer.ts`, `src/finalize/spec-merger.ts`, `src/cli/commands/complete.ts`, and the spec artifact template that feeds it) trusts inputs it should validate and performs irreversible writes before its own checks pass. Three related defects, all logged as issues against this pipeline, compound into a system that silently corrupts `spec/specs/` and ships unverified work:

1. **Capability targeting is implicit and defaults to wrong.** `metta instructions spec` renders the spec delta template with its H1 pre-filled to the change's own slug (`InstructionGenerator.generate` sets `capability_name: params.changeName`, consumed by `src/templates/artifacts/spec.md:1`). `metta complete` then derives the merge target capability by slugifying that H1 (`src/cli/commands/complete.ts:162`). Unless an author manually overwrites the H1 with an existing capability name, every change either mints a junk capability folder (ADDED-only deltas, silently) or hard-fails at `metta complete` (MODIFIED/REMOVED/RENAMED deltas, loudly but late). As of 2026-07-13, 14+ of 39 folders under `spec/specs/` are one-shot debris with truncated/leaked slugs, and these leak into the generated CLAUDE.md capability table. Authors adopting metta on their own projects are affected every time they touch an existing capability.

2. **Finalize does not enforce the artifact completeness contract it is built on top of.** `Finalizer.finalize()` loads change metadata only to scope gates by `metadata.workflow`; it never checks `metadata.artifacts` before archiving. Observed 2026-07-14: `metta complete verification` failed ("summary.md not found") and verification stayed `ready`, but the very next `metta finalize` ran gates, archived, and reported success — shipping a change whose verification was never formally accepted. The artifact state machine enforced by `metta complete` (file existence, stub-marker detection, minimum content length) is purely advisory at finalize time. A contributing trigger: the trivial workflow (`src/templates/workflows/trivial.yaml:25`) declares verification `generates: summary.md`, but nothing in the trivial-tier flow instructs any agent to write that file, so `metta complete verification` predictably fails on trivial changes and finalize silently ignores the resulting incomplete state.

3. **The spec merger's ADDED path is not idempotent, and finalize writes merge output before its own gates run.** `SpecMerger.applyDelta()`'s ADDED branch (`src/finalize/spec-merger.ts:147`) blindly appends a requirement with no check for whether a section of that name already exists, despite the function's docstring claiming idempotency. `Finalizer.finalize()` writes the spec merge to disk before running quality gates and, on gate failure, returns early with no rollback — so every retried finalize re-appends the same delta. The base-version conflict guard that would otherwise catch a re-merge is skipped when the change itself created the capability (no `base_versions` entry exists to compare against). This combination quadruplicated every requirement in `spec/specs/adaptive-workflow-tier-selection/spec.md` (13 requirements → 52 headings, inflating the capability's reported requirement count) across four retried finalize attempts on 2026-07-14. That file has since been hand-deduplicated (2026-07-14), but the underlying non-idempotent merge + write-before-gate ordering remains and will reproduce the corruption on the next finalize retry against any capability.

All three defects share a root pattern: the pipeline performs a write (creating a capability folder, archiving a change, appending merge content) before it has confirmed the write is valid or safe to retry. Authors and reviewers relying on `spec/specs/` as an accurate, deduplicated record of project capabilities — and relying on `metta finalize` succeeding only when a change's own artifact contract was satisfied — are the ones affected.

## Proposal

Harden the finalize/spec-merge pipeline in three coordinated fixes, scoped to the code paths identified in the three source issues:

1. **Make capability targeting explicit.**
   - Change the spec artifact template flow (`InstructionGenerator.generate`, `src/templates/artifacts/spec.md`) so the delta spec's merge target is no longer silently defaulted to the change slug. The instructions flow MUST surface the set of existing capabilities under `spec/specs/` and require the author (or orchestrating agent) to either select an existing one or explicitly confirm a net-new capability, before the spec artifact is generated.
   - `metta complete` (`src/cli/commands/complete.ts:162`) MUST validate the derived merge target against this explicit selection rather than trusting an unedited H1: if the resolved capability slug matches the change's own slug and no such capability already exists, `metta complete` MUST refuse (or require explicit confirmation) instead of silently minting a new folder.
   - The H1 remains a human-readable title; the merge target becomes an explicit, separately-authored decision (not solely inferred from title text).

2. **Add a hard artifact-completeness gate to `Finalizer.finalize()`.**
   - Before gates run, `Finalizer.finalize()` MUST iterate `metadata.artifacts` and refuse to proceed (returning a distinct, clearly labeled failure — e.g. an `incompleteArtifacts` result field mapped to a non-zero exit in the CLI) when any workflow-required artifact is not `complete`.
   - Fix the trivial workflow's artifact contract: `src/templates/workflows/trivial.yaml`'s verification stage either drops the `generates: summary.md` requirement or the trivial-tier verification instructions are updated to explicitly direct writing `summary.md`, so the declared contract and the actual instructed behavior agree.

3. **Make the spec merge idempotent and gate-ordered.**
   - `SpecMerger.applyDelta()`'s ADDED branch (`src/finalize/spec-merger.ts`) MUST check for an existing section with the same requirement name (via `splitRequirements()`, consistent with the MODIFIED/RENAMED/REMOVED branches) before appending, and MUST no-op or surface a conflict rather than duplicate content when re-applied.
   - `Finalizer.finalize()` MUST NOT leave partially-applied spec merge output on disk after a failed run that a retry can compound. This is satisfied either by running the merge in dry-run mode for conflict detection and only writing to disk after gates pass, or by rolling back the merge write on gate failure — either approach is acceptable as long as a retried `metta finalize` after a gate failure cannot re-append already-merged content.

## Impact

- `src/context/instruction-generator.ts` — spec template parameter generation changes to require/surface explicit capability targeting instead of defaulting `capability_name` to `params.changeName`.
- `src/templates/artifacts/spec.md` — template and/or its consuming instructions change to make capability selection an explicit authored step.
- `src/cli/commands/complete.ts` — merge-target resolution and validation logic changes; existing MODIFIED/REMOVED/RENAMED hard-fail behavior is preserved but the ADDED silent-landfill path is closed.
- `src/finalize/finalizer.ts` — gains a new pre-gate artifact-completeness check; finalize ordering relative to spec-merge writes changes (dry-run-then-write or write-then-rollback).
- `src/finalize/spec-merger.ts` — ADDED branch behavior changes from unconditional append to existence-checked append/no-op/conflict.
- `src/templates/workflows/trivial.yaml` — verification stage's `generates` contract is corrected to match actual instructed behavior.
- Any existing change in flight that has already authored a spec delta relying on the old implicit-H1 targeting behavior may need its delta spec adjusted to the new explicit-targeting flow before it can complete.
- Downstream tooling that reads `spec/specs/` capability counts (e.g. the CLAUDE.md generation step referenced in `/metta-refresh`) benefits indirectly from fewer landfill folders and accurate requirement counts going forward, but this change does not itself modify that generation step.

## Out of Scope

- No changes to workflow tier definitions or tier-selection logic itself (`adaptive-workflow-tier-selection` capability) beyond the trivial workflow's `verification` artifact `generates` contract fix in Issue 2.
- No redesign of the delta spec document format beyond adding explicit capability targeting to the authoring flow — ADDED/MODIFIED/REMOVED/RENAMED operation semantics and `## Requirement:` section structure are unchanged.
- No retroactive cleanup of the 14+ existing landfill capability folders already present in `spec/specs/` — that is a separate, follow-up cleanup effort, not a code change.
- No further changes to `spec/specs/adaptive-workflow-tier-selection/spec.md` content — it was already hand-deduplicated on 2026-07-14; this change only fixes the merger/finalizer logic that produced the duplication so it cannot recur.
- No `--force`-style override flag for the new artifact-completeness gate is being designed here as a first-class feature; if a bypass mechanism proves necessary during implementation it must be an explicit, loudly-logged opt-in, not a default behavior.
- No changes to gate infrastructure, gate scoping by workflow tier, or the gates themselves — only the ordering of finalize's internal steps relative to gate execution and spec-merge disk writes.
