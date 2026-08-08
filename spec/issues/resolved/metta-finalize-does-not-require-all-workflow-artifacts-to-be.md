# metta finalize does not require all workflow artifacts to be complete — it ran successfully with the verification artifact still in 'ready' state. Observed 2026-07-14 on change fix-metta-guard-edit-hook-blocks-edit-write-files-outside (trivial workflow): `metta complete verification` failed with "Artifact file 'summary.md' not found" (so verification stayed incomplete in .metta.yaml), but an immediately-following `metta finalize --change ...` ran all gates, archived the change, and reported success anyway. The archived .metta.yaml presumably still shows verification: ready. Two aspects: (1) finalize should refuse (or at least loudly warn) when any workflow artifact is not complete — otherwise the artifact state machine is advisory and a change can ship without its verification being formally accepted (same defect family as spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md); (2) secondary: the trivial workflow's verification artifact requires a summary.md that nothing in the trivial flow instructs anyone to write — either the requirement should be dropped for trivial tier or the verification instructions should mention it (the workaround was having the verifier write summary.md alongside verification.md).

**Captured**: 2026-07-14
**Status**: resolved
**Severity**: major

## Symptom
On 2026-07-14, for change `fix-metta-guard-edit-hook-blocks-edit-write-files-outside` (trivial workflow), `metta complete verification` failed with "Artifact file 'summary.md' not found", leaving the verification artifact in `ready` state in `.metta.yaml`. An immediately-following `metta finalize --change ...` nevertheless ran all gates, archived the change, and reported success — so the change shipped without its verification ever being formally accepted, and the archived `.metta.yaml` presumably still records `verification: ready`.

## Root Cause Analysis
`Finalizer.finalize()` never consults artifact states. It loads the change metadata solely to resolve `metadata.workflow` for gate scoping, then proceeds directly to spec merge, quality gates, and archive. No code path iterates `metadata.artifacts` (a `Record<string, ArtifactStatus>` per the schema) to require every artifact be `complete` before archiving. The result is that the artifact state machine enforced by `metta complete` — file existence, stub-marker detection, minimum content length — is purely advisory at finalize time: any completion failure can be bypassed simply by running `metta finalize` next. This is the same defect family as `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md` (enforcement gaps that let a change ship past the artifact contract).

A secondary contributing cause explains the trigger: the trivial workflow's verification stage declares `generates: summary.md`, but the trivial-tier flow never otherwise instructs anyone to write `summary.md` for verification. The verifier persona template was pinned to the workflow's `generates` filename on 2026-06-19 (commit 545acafc9), yet the observed 2026-07-14 run still produced `verification.md` instead — suggesting either a stale installed agent copy or an instruction path that omits the filename. So `metta complete verification` predictably fails on trivial changes, and finalize then silently ignores the resulting incomplete state.

### Evidence
- `src/finalize/finalizer.ts:32` — `getChange()` metadata is used only for `metadata.workflow` (gate scoping at line 40); archive happens at line 101 with no check that artifact statuses are `complete`.
- `src/cli/commands/complete.ts:99` — `metta complete` refuses to complete an artifact whose `generates` file is missing, which is exactly the state finalize later ignores.
- `src/templates/workflows/trivial.yaml:25` — the verification artifact declares `generates: summary.md`, a filename the trivial-tier flow does not otherwise instruct any agent to produce.

## Candidate Solutions
1. **Hard completeness gate in Finalizer** — At the top of `Finalizer.finalize()`, iterate `metadata.artifacts` and refuse (new result field, e.g. `incompleteArtifacts`, mapped to a distinct non-zero exit in `finalize.ts`) when any artifact is not `complete`, with an explicit `--force` flag that prints a loud warning and records the override in the archived metadata. Tradeoff: breaking change for any flow relying on current leniency (auto/ship loops, dry-run) — those paths need auditing so the block is surfaced and recoverable rather than fatal mid-loop.
2. **Warn-and-record (soft enforcement)** — Keep finalize permissive but print a prominent warning listing incomplete artifacts and stamp them into the archived `gates.yaml` / `.metta.yaml` so the gap is auditable. Tradeoff: the state machine remains advisory; a change can still ship unverified, so the defect family is documented rather than closed.
3. **Fix the trivial verification contract** — Either drop the `summary.md` requirement from `trivial.yaml`'s verification artifact or make the trivial-tier verify instructions explicitly direct writing `summary.md`. Tradeoff: removes only this trigger; the finalize enforcement hole remains exploitable by every other artifact and workflow tier, so this is complementary rather than sufficient.

## Resolution

**Resolved**: 2026-08-08 (stale-issue sweep)

Fixed: finalizer.ts completeness gate aborts unless every workflow-required artifact is 'complete' (incompleteArtifacts result); quick/trivial verification now emits summary.md via instruction contract.
