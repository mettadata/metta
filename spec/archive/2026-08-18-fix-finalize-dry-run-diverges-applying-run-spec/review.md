# Review: fix-finalize-dry-run-diverges-applying-run-spec

Three parallel reviews (correctness, security, quality) — round 1 on the full diff (main...HEAD).

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS |
| Quality | PASS_WITH_WARNINGS |

No critical or major findings. Loop exited after 1 iteration; all warnings resolved in follow-up commit 5453a802a.

## Independently verified by reviewers

- Parity is structural: the only `dryRun` branch is the commit gate; conflicts can only originate in the shared compute phase — no apply-only conflict class remains.
- All-or-nothing holds: conflicts never write (pinned by byte-identical spec-store assertions); the residual crash window (exception mid-commit) is strictly narrower than main and further narrowed by stage-time parse validation (see below).
- Staged composition: MODIFIED-after-same-run-ADDED works in both modes (`getBaseVersion` returns null for not-yet-locked capabilities); a latent apply-mode bug where per-delta lock updates could make delta 2's base-version check compare against mid-run hashes is silently fixed.
- Clean-path outputs byte-identical to the old implementation; 12 pre-existing tests unchanged; dead code (`applyDelta`, `createCapabilitySpec`) fully removed; `reconcileDelta`/`renderNewCapabilitySpec` genuinely pure.
- Path safety: capability slugs pass through `toSlug` (no traversal); dry-run strictly read-only; MergeConflict messages leak nothing new.
- MODIFIED target `Spec Delta Merge` exists in the living finalize-ship spec; finalizer step-5 comment now accurate.

## Warnings and resolutions (commit 5453a802a)

- **Correctness/Quality W1** — parity test fixture weaker than its spec scenario (clean-only; wrong "not representable" comment). → Fixture now mixes ADDED-duplicate noop, clean MODIFIED, and MODIFIED/RENAMED/REMOVED-against-absent conflicts in one run, with deep result equality and zero-write assertions.
- **Correctness W2** — spec.md over-claimed a conflict class (ADDED without new-capability standing) the merger does not implement. → Reworded; standing enforcement attributed upstream to `SpecTargetError`.
- **Quality W2** — finalizer-level scenario (requirement-not-found caught at step 3) untested. → New finalizer test: aborts at step-3 gate, applying merge never invoked (spy call-count 1), spec store untouched.
- **3x suggestion (all reviewers)** — `parseSpec` inside the commit write loop. → Hoisted to a pre-write validation pass; parse failure now aborts with zero writes.

## Follow-ups logged

- Issue `spec-merger-renamed-delta-re-key-silently-loses-a` (minor/medium): pre-existing RENAMED-collision silent data loss, carried unchanged through the refactor (security reviewer finding).

## Accepted residuals

- Process crash mid-commit (kill during the write burst after full reconciliation) can still leave partial files — intent's stated out-of-scope; git is the recovery mechanism.
- Cross-process TOCTOU between finalizer step 3 and step 5 — unchanged from main, out of scope; a drift-induced step-5 conflict aborts with zero writes.
- `changeName` joined unsanitized into a read path (pre-existing, read-only exposure).
