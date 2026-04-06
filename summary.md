## Implementation Summary: artifact-store-spec-model-finalize-ship gap fixes

### Completed (4 of 9 sub-issues)

**GAP-001 + GAP-002: MODIFIED and RENAMED delta operations (spec-merger.ts)**
- Added `MODIFIED` branch in `applyDelta` that removes the old requirement section by regex and appends the replacement text, then updates the spec lock.
- Added `RENAMED` branch that extracts the old name from a `Renamed from: <name>` line in the delta text, removes the old section, and appends the requirement under its new name.
- Added two integration tests validating both operations end-to-end.

**GAP-004: SpecLock.status and source fields (spec-lock-manager.ts)**
- `createFromParsed` now accepts an optional `source` parameter (default `"change"`) and sets `status` to `"draft"` by default.
- Backward-compatible: all existing callers use defaults.

**GAP-008: SpecLockManager.update version increment test (spec-lock-manager.test.ts)**
- New test file with 3 tests: version increment (1 to 2), default status/source fields, and custom source parameter.

### Skipped (by instruction)
- GAP-003: Multi-capability delta support (larger scope)
- GAP-005/006: Merge pipeline gate stubs (larger scope)
- GAP-007: Doc gen placeholder (larger scope)
- GAP-009: Lock race condition (larger scope)

### Test Results
- 24 test files, 292 tests, all passing
- 3 new tests added in `tests/spec-lock-manager.test.ts`
- 2 new tests added in `tests/spec-merger.test.ts`

### Files Modified
- `src/finalize/spec-merger.ts` -- MODIFIED and RENAMED branches in applyDelta
- `src/specs/spec-lock-manager.ts` -- status/source defaults in createFromParsed
- `tests/spec-merger.test.ts` -- MODIFIED and RENAMED integration tests
- `tests/spec-lock-manager.test.ts` -- new file, version increment and field tests
