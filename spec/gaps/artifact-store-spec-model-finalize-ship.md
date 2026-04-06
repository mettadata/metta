# Gaps: artifact-store, spec-model, finalize-ship

Identified during spec extraction on 2026-04-06.

---

## GAP-001: `MODIFIED` delta does not rewrite requirement text

**Area:** spec-model / SpecMerger

**Observed behavior:** `SpecMerger.applyDelta` handles `ADDED` (append section) and `REMOVED` (regex-delete section) but has no code path for `MODIFIED`. When a `MODIFIED` delta passes the conflict check it falls through to `applyDelta` which performs no operation on the existing requirement text.

**Impact:** A `MODIFIED` delta that clears the conflict check silently becomes a no-op — the canonical spec is not updated.

**Recommendation:** Add a `MODIFIED` branch in `applyDelta` that removes the old requirement section by name and appends the replacement, then re-runs `SpecLockManager.update`.

---

## GAP-002: `RENAMED` delta operation is parsed but never applied

**Area:** spec-model / SpecMerger

**Observed behavior:** `DeltaOperation` includes `"RENAMED"` and `parseDeltaSpec` recognises it, but `SpecMerger.applyDelta` has no handling for `RENAMED`. Any `RENAMED` delta silently passes through without renaming the requirement ID in the canonical spec or the lock.

**Impact:** Rename operations expressed in a delta spec are silently dropped.

**Recommendation:** Implement a `RENAMED` branch that updates the requirement heading and re-slugifies the ID, then updates the lock.

---

## GAP-003: Capability name is derived from delta title only

**Area:** spec-model / SpecMerger

**Observed behavior:** The target capability is inferred by stripping `(Delta)` from the `parseDeltaSpec` title. There is no explicit `capability` field in the delta format. A delta affecting multiple capabilities cannot be expressed.

**Impact:** A single change can only carry spec deltas for one capability. Cross-capability changes require multiple delta files, but `SpecMerger.merge` only reads a single `changes/<name>/spec.md`.

**Recommendation:** Either (a) support multiple delta files per change (e.g. `spec-<capability>.md`), or (b) add an explicit `target:` front-matter field to the delta format, and update the spec format accordingly.

---

## GAP-004: `SpecLock.status` and `source` fields are not populated by `SpecLockManager`

**Area:** spec-model / SpecLockManager

**Observed behavior:** `SpecLockSchema` defines optional fields `status` (`draft | reviewed | approved`) and `source` (`scan | manual | change`), but `SpecLockManager.createFromParsed` never sets them. Locks written by the merge pipeline always have these fields absent.

**Impact:** Downstream tooling (e.g. `metta reconcile`) that queries lock status or provenance receives `undefined` for these fields.

**Recommendation:** `createFromParsed` should accept an optional `source` parameter (default `"change"`) and set `status` to `"draft"` by default.

---

## GAP-005: Gate-verification step in MergeSafetyPipeline is a stub

**Area:** finalize-ship / MergeSafetyPipeline

**Observed behavior:** Step 4 (`gate-verification`) unconditionally pushes `{ step: "gate-verification", status: "pass" }` without querying any gate registry or reading gate results from the source branch's archive.

**Impact:** The merge safety pipeline does not actually verify that gates passed. A branch with failing gates can be merged without warning.

**Recommendation:** Accept an optional `GateRegistry` (or a gate-results path) and read the most recent `gates.yaml` from the source branch's archived change. Fail the step if any gate recorded a `"fail"` status.

---

## GAP-006: post-merge-gates step is a stub

**Area:** finalize-ship / MergeSafetyPipeline

**Observed behavior:** Step 7 (`post-merge-gates`) unconditionally pushes `{ step: "post-merge-gates", status: "pass" }` after a successful merge without running any checks.

**Impact:** Regressions introduced by the merge are not caught before the commit is finalised.

**Recommendation:** After the merge commit, run the registered gate suite (at minimum `typecheck` and `test`) and set the step status to `"fail"` (with rollback) if any gate fails.

---

## GAP-007: Finalizer docs and context-refresh steps are placeholders

**Area:** finalize-ship / Finalizer

**Observed behavior:** `Finalizer.finalize` has comment placeholders `// Step 4: Generate docs (placeholder for v0.1)` and `// Step 5: Refresh context files (placeholder for v0.1)`. Both return empty/false without doing any work.

**Impact:** Documentation generation and context-file refresh are not implemented. Any workflow step that depends on updated docs or context after finalization will receive stale data.

**Recommendation:** Define the doc-generation and context-refresh interfaces and either implement or skip with explicit feature flags so callers can detect the capability gap.

---

## GAP-008: No test coverage for `SpecLockManager.update` version increment

**Area:** spec-model / SpecLockManager (test coverage)

**Observed behavior:** The test suite (`tests/spec-merger.test.ts`) creates locks directly via `createFromParsed` and `write`, but no test invokes `SpecLockManager.update` twice to assert that `version` increments from 1 to 2.

**Impact:** The increment logic (`version = existing.version + 1`) has no regression protection.

**Recommendation:** Add a test in a new `tests/spec-lock-manager.test.ts` file that calls `update` twice on the same capability and asserts `version` goes from 1 to 2.

---

## GAP-009: `ArtifactStore.archive` does not create `archive/` directory reliably under all race conditions

**Area:** artifact-store

**Observed behavior:** `archive` calls `mkdir(join(specDir, "archive"), { recursive: true })` before `move`. However `abandon` also calls `mkdir` separately. If two operations run concurrently there is no locking. `StateStore.acquireLock` exists but is not used in archive/abandon paths.

**Impact:** Low-probability TOCTOU race on first archive operation. In CI with parallel finalization this could produce an ENOENT or EEXIST error.

**Recommendation:** Use `StateStore.acquireLock` around the mkdir+move sequence in both `archive` and `abandon`, or guarantee single-writer semantics at the process level.
