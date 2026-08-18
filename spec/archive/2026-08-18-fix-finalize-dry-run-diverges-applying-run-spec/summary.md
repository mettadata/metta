# Summary: fix-finalize-dry-run-diverges-applying-run-spec

## What was implemented

Refactored `SpecMerger.merge()` (`src/finalize/spec-merger.ts`) into a two-phase stage-then-commit merge, eliminating both defects from the source issue:

1. **Dry-run/apply parity by construction.** A shared pure compute phase — module-level `reconcileDelta()` and `renderNewCapabilitySpec()`, no I/O — runs the full conflict-detection set (capability-not-found, base-version/lock, requirement-not-found for MODIFIED/RENAMED/REMOVED) identically in both modes, and classifies merged/conflicts/noops identically, including ADDED-duplicate noop detection in dry-run. The `MergeResult.noops` doc-comment caveat about dry-run divergence is removed. The finalizer's step-3 dry-run gate now catches every conflict class step-5 would.
2. **All-or-nothing apply.** The commit phase runs only when the compute phase produced zero conflicts; it iterates the staged `dirtyCapabilities` and performs `state.writeRaw` + `specLockManager.update` per capability. Any conflict → `status: 'conflict'` with zero files and zero locks written — the spec store is untouched.
3. **Composition.** Multiple deltas targeting the same capability compose through a `stagedContent` map threaded across the delta loop.
4. **Finalizer comment alignment** (`src/finalize/finalizer.ts` step 5): an apply-time conflict after a clean dry-run now indicates disk drift between the two calls, not a known blind spot; it still aborts with zero writes.

Delta spec (`spec.md`, merge target `finalize-ship`): MODIFIED `Spec Delta Merge` + ADDED `Dry-Run And Apply Merge Result Parity`, `All-Or-Nothing Spec Merge Apply`, `Staged Composition Of Same-Capability Deltas`.

## Tests

`tests/spec-merger.test.ts`: 20/20 (12 existing unchanged + 8 new — dry-run requirement-not-found for MODIFIED/RENAMED/REMOVED, dry-run/apply parity, conflict-writes-nothing atomicity with byte-identical store assertion, staged composition in both modes, ADDED-duplicate noop parity). Full suite 128 files / 2431 tests green; tsc and build clean.

Commits: `73ad3200a` (spec delta), `9a23c806a` (refactor), `9f90e75d5` (tests).

## Workflow note

The CLI auto-downscaled this change standard → quick at intent completion (complexity score 1, file_count 3) — another occurrence of open issue `intent-time-workflow-auto-downscale-misfires-on-file-count-0`. The quick routing was kept (no state hand-edits); the spec delta the intent commits to was authored anyway (SpecMerger merges `spec.md` independent of the artifact graph), and full 3-reviewer / 3-verifier fan-outs run regardless of tier.

## Verification

### Spec Scenarios

All delta requirements/scenarios verified with cited test evidence (`tests/spec-merger.test.ts` 20/20, `tests/finalizer.test.ts` 33/33):

- [x] MODIFIED `Spec Delta Merge` — merge-target name exists verbatim in the living spec; dry-run requirement-not-found for MODIFIED (501) / RENAMED (538) / REMOVED (576); apply-mode conflict + no-write (456); ADDED idempotency/noop scenarios (382, 426)
- [x] `Dry-Run And Apply Merge Result Parity` — deep result equality on a fixture mixing noop + clean + three conflict classes (607, `toEqual` at 693) with zero-write assertion; finalizer step-3 gate catches requirement-not-found, applying merge never invoked (finalizer.test.ts:302, merge spy called once with dryRun)
- [x] `All-Or-Nothing Spec Merge Apply` — conflicting delta N leaves spec.md, spec.lock, and specs/ tree byte-identical (702); zero-conflict multi-delta commits all staged results (783, 320)
- [x] `Staged Composition Of Same-Capability Deltas` — ADDED-then-MODIFIED composes in apply (783) and classifies identically in dry-run (821)

Non-blocking notes: finalizer-layer scenario uses MODIFIED where the spec text names REMOVED (same conflict class, covered at merger layer); multi-capability lock-hash assertion is composed from two tests rather than one verbatim scenario test.

### Gate Results

| Gate | Result |
|------|--------|
| tests (`npm test`) | PASS — 128 files, 2432/2432 |
| typecheck / lint | PASS |
| build | PASS |

Review: 3 reviewers, 1 iteration — security PASS, correctness/quality PASS_WITH_WARNINGS; all warnings fixed in 5453a802a; pre-existing RENAMED-collision data loss logged as issue `spec-merger-renamed-delta-re-key-silently-loses-a`.
