# StateStore — Specification Gaps

**Date:** 2026-04-06  
**Severity:** P1 = blocks correctness, P2 = blocks safety, P3 = quality/clarity

---

## GAP-SS-01 — Stale lock removal is untested [P1]

**Location:** `src/state/state-store.ts:acquireLock` (lines 105–112)

**Description:** The implementation removes lock files older than 60,000 ms and retries acquisition. No test in `tests/state-store.test.ts` covers this path. The 60-second threshold is a hardcoded magic number with no corresponding spec.

**Impact:** If the stale-lock branch has a bug (e.g., incorrectly computing `mtimeMs`), it will go undetected until a process crash leaves a stale lock in production.

**Recommendation:** Add a test that creates a lock file with a back-dated mtime and asserts that `acquireLock` removes it and succeeds. Expose the threshold (60 s) as a named constant or constructor option.

---

## GAP-SS-02 — `acquireLock` does not validate that the existing lock belongs to the current process [P2]

**Location:** `src/state/state-store.ts:acquireLock`

**Description:** The lock file contains `pid` and `acquired` fields, but `acquireLock` never reads these on contention. There is no mechanism to detect or recover a lock held by the current process (re-entrancy), nor does `acquireLock` verify that a non-stale lock belongs to a live PID.

**Impact:** If a process crashes and restarts within 60 seconds, the new instance will block behind its own previous lock until the stale threshold is reached.

**Recommendation:** Document the advisory-only nature of the lock explicitly in the spec (done). Consider adding an option to check whether the PID in the lock file is still alive (via `process.kill(pid, 0)`) to allow earlier stale detection.

---

## GAP-SS-03 — `delete` throws on missing file; no `deleteIfExists` variant [P3]

**Location:** `src/state/state-store.ts:delete`

**Description:** `delete` propagates `ENOENT` to the caller. There is no `deleteIfExists` convenience method. Tests do not cover the error case. Callers who need idempotent deletion must add their own try/catch.

**Recommendation:** Add a `deleteIfExists(filePath)` method that silently ignores `ENOENT`, or document the expected error behavior clearly in the spec and update callers.

---

## GAP-SS-04 — `readRaw` error behavior for missing file is unspecified and untested [P3]

**Location:** `src/state/state-store.ts:readRaw`

**Description:** `readRaw` propagates `ENOENT` from `readFile`, but there is no test covering this case. Callers may expect it to behave like `exists` (returning null) or like `read` (throwing).

**Recommendation:** Add a test asserting `readRaw` throws on a missing file, and document this in the spec.

---

## GAP-SS-05 — No concurrency test for concurrent writes to the same path [P2]

**Location:** `tests/state-store.test.ts`

**Description:** The lock tests verify contention across `acquireLock` calls, but there is no test demonstrating that concurrent `write` calls to the same file without a lock produce a deterministic or at least non-corrupt result. The spec does not address concurrent unguarded writes.

**Recommendation:** Add a test (or explicit spec note) clarifying that `write` without a lock provides no atomicity guarantees under concurrency.

---

## GAP-SS-06 — `acquireLock` creates parent dirs but the lock file path is relative [P3]

**Location:** `src/state/state-store.ts:acquireLock` (line 90)

**Description:** The lock file path is resolved relative to `basePath` the same way as data files. This is consistent, but the spec does not explicitly state the convention for where lock files should be placed (e.g., alongside the state file they guard, or in a dedicated `.metta/locks/` directory).

**Recommendation:** Document the expected lock file naming convention (e.g., `<state-file>.lock` alongside its target file).
