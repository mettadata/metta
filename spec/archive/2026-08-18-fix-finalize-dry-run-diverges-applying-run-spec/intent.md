# fix-finalize-dry-run-diverges-applying-run-spec

## Problem

`metta finalize --dry-run` can report a clean spec merge while the real finalize then conflicts — and when that late conflict fires, the applying run has already written some deltas into `spec/specs/`, leaving the living spec store half-merged with no rollback and no marker of the partial state. Two consumer-facing failures on separate changes (zeus session, 2026-08-18) and metta's own PR #85 finalize hit this class.

Both defects trace to one structural flaw in `SpecMerger.merge()` (`src/finalize/spec-merger.ts`):

1. **Dry-run/apply parity gap.** All per-requirement work is gated behind `if (!dryRun)` (line 122). The requirement-existence checks that produce `'requirement not found'` conflicts for MODIFIED/RENAMED/REMOVED deltas live only inside `applyDelta()` (lines 195–202, 214–221, 246–253), which never runs on the dry-run path. Dry-run validates only capability existence and base-version lock hashes, so a MODIFIED delta targeting an absent requirement passes dry-run as clean — and is even counted under `merged`. The `Finalizer` step-3 conflict gate (`src/finalize/finalizer.ts:108`) runs exactly this weaker dry-run, so it structurally cannot catch this conflict class; the step-5 comment (`finalizer.ts:169`) admits apply-time-only conflicts exist.

2. **Non-atomic apply.** The applying run writes per delta inside the loop: `applyDelta()` ends with `state.writeRaw(specPath, content)` plus `specLockManager.update()` (lines 259–261), and `createCapabilitySpec()` does the same (lines 155–157). When delta N returns a conflict, deltas 1..N−1 are already committed to living specs with updated locks. The finalizer's step-5 conflict return aborts the archive but performs no rollback, silently corrupting the framework's source of truth.

Affected: every metta consumer running finalize/ship on any change whose delta spec contains MODIFIED/RENAMED/REMOVED operations — the dry-run preflight gives false confidence, and a real conflict leaves the spec store requiring manual forensic repair (as PR #85 required hand-reclassifying MODIFIED→ADDED).

## Proposal

Refactor `SpecMerger.merge()` into a two-phase stage-then-commit merge (candidate solution 1) so parity is guaranteed by construction and the write phase is all-or-nothing at the delta-reconciliation level:

1. **Compute phase (shared by dry-run and apply).** Convert `applyDelta()` and `createCapabilitySpec()` into pure computation over in-memory content: for every delta, resolve the target capability, load current spec content (once per capability, threading staged content forward so multiple deltas against the same capability compose), and produce either a staged result (final merged file content + pending lock update per affected capability) or a `MergeConflict` / noop. All existing conflict classes run in this phase for both modes: capability-not-found, base-version/requirement lock conflicts, and the requirement-not-found checks currently reachable only at apply time.
2. **Commit phase (apply mode only, all-or-nothing on reconciliation).** Only when the compute phase produced zero conflicts, iterate the staged results and perform the writes: `state.writeRaw()` per capability spec followed by `specLockManager.update()`. If any conflict was found, return `status: 'conflict'` without writing a single file or lock — the spec store is untouched.
3. **Result parity.** Dry-run and apply return the same `merged` / `conflicts` / `noops` classification for the same inputs, including ADDED-duplicate noop detection (currently apply-only, per the `MergeResult.noops` doc comment at `spec-merger.ts:33-40` — that caveat is removed). The finalizer's step-3 dry-run gate therefore catches every conflict the step-5 apply would catch, and step 5's apply either fully merges or leaves specs untouched.
4. **Finalizer alignment.** Update the step-5 comment/handling in `src/finalize/finalizer.ts` to reflect the new guarantee (an apply-time conflict after a clean step-3 dry-run now indicates spec-store drift between the two calls, not a known blind spot — and even then aborts with zero writes).
5. **Tests.** Extend `spec-merger` unit tests to cover: (a) dry-run reports `'requirement not found'` for MODIFIED/RENAMED/REMOVED against an absent requirement; (b) dry-run and apply return identical results for the same fixture set; (c) a multi-delta merge where delta N conflicts writes nothing — spec files and spec-locks byte-identical to their pre-merge state; (d) multiple deltas targeting the same capability compose correctly through staging; (e) ADDED-duplicate noop parity between dry-run and apply.

## Impact

- `src/finalize/spec-merger.ts` — core refactor: `merge()`, `applyDelta()`, `createCapabilitySpec()` restructured into compute + commit phases. External `MergeResult` shape unchanged; the `noops` doc-comment caveat about dry-run divergence is removed because it no longer holds.
- `src/finalize/finalizer.ts` — no structural change required (it already calls `merger.merge(..., true)` then `merger.merge(..., false)`); the step-5 comment and any messaging that assumes apply-time-only conflicts are updated. Behavior change: step-3 now rejects conflicts it previously missed (strictly earlier, safer failure), and step-5 conflicts no longer mutate `spec/specs/`.
- `metta finalize --dry-run` / `metta ship` preflight — dry-run output becomes trustworthy for MODIFIED/RENAMED/REMOVED deltas; some changes that previously "passed" dry-run will now correctly report conflicts before gates run.
- `finalize-ship` living spec (181 requirements) — the delta spec for this change modifies the merge-behavior requirements to state dry-run/apply parity and all-or-nothing apply semantics.
- Test suite — `spec-merger` tests gain the parity and atomicity cases above; existing merge tests continue to pass since clean-path outputs are byte-identical.

Risk noted: a process crash mid-commit-phase can still leave partial files (writes are not journaled). This narrows the partial-state window from "any conflict" to "process death during a burst of local file writes after full reconciliation" — accepted as out of scope below.

## Out of Scope

- **Crash-safe journaled/temp-file-swap writes** in the commit phase. A kill mid-write can still leave partial files; git remains the recovery mechanism. Snapshot-and-rollback machinery (candidate solution 3) is explicitly rejected as more failure-prone than the staging approach.
- **Guarding drift between finalizer step 3 and step 5** (specs changing on disk between the dry-run call and the applying call within one finalize). Both calls recompute from disk; a drift-induced step-5 conflict now aborts with zero writes, which is sufficient.
- **Auto-reclassifying deltas** (e.g. MODIFIED→ADDED when the target requirement is absent, as done by hand in PR #85). The merge reports the conflict; resolution stays with the author.
- **Changing the `MergeResult` public shape**, the finalizer step ordering, gate execution, UAT/TOKENS generation, archiving, or any `metta ship` behavior beyond the merge semantics above.
- **`SpecTargetError` / merge-target resolution** (`metta complete spec` path) — untouched.
- **Concurrent-finalize locking** across multiple worktrees or sessions.
