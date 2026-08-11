# Release pipeline mid-cut failure restore path has no failure-injection test

**Captured**: 2026-08-11
**Status**: logged
**Severity**: minor

## Symptom
Verification of `fix-automatic-versioning-release-capability-metta` (PR #66) marked the "Mid-cut failure is reported with the failing step" scenario PARTIAL. The mutation-group restore path in `ReleasePipeline.cut()` — which records a named step failure, restores the version file, releases record, and changelog to their pre-cut contents, and returns before `commit`/`annotated-tag` — is verified only by code inspection. No test induces a failure between the version-file write and tagging, so regressions in the restore logic (e.g. a file silently left mutated, or the failing step not named) would not be caught by the suite.

## Root Cause Analysis
The restore path is structurally hard to reach from a test. The mutation group at `src/release/release-pipeline.ts:391-458` snapshots three files, then runs `write-version-file`, `write-releases-record`, and `regen-changelog` sequentially, calling `restoreFiles()` on any throw. But the collaborators that could throw are instantiated or invoked directly inside `cut()` — notably `new DocGenerator(...)` at line 451 — leaving no constructor seam or hook through which a test can inject a mid-mutation failure. The existing suite (`tests/release-pipeline.test.ts`) exercises only the pre-mutation abort paths (dirty tree, pre-existing tag, user decline) and the post-commit `annotated-tag` failure; the window between first file write and commit was never made fault-injectable, so the scenario shipped test-free rather than failing — a verification gap, not a runtime bug.

### Evidence
- `src/release/release-pipeline.ts:449-458` — the `regen-changelog` catch block calls `restoreFiles()`, records `{ step: 'regen-changelog', status: 'fail' }`, and returns failure before commit; this is the untested path.
- `src/release/release-pipeline.ts:451` — `DocGenerator` is constructed inline inside `cut()`, so tests cannot substitute a throwing generator without a seam or module mock.
- `tests/release-pipeline.test.ts:262-322` — the "abort paths (nothing written)" describe block covers only pre-mutation failures; no test triggers a failure after the version file has been written.

## Candidate Solutions
1. **Environmental fault injection** — In a test, arrange the changelog target so regeneration fails naturally (e.g. create the changelog output path as a directory, or make `docs.output` unwritable via `chmod`), then run `cut()` and assert: all three files match their pre-cut contents, `git log`/`git tag` show no new commit or tag, and the failing step is named `regen-changelog` in the result steps. No production code changes. Tradeoff: relies on filesystem behavior (chmod is ineffective when running as root and differs on Windows), so the test can be platform-brittle and needs careful setup/teardown.
2. **Inject a seam for the doc generator** — Add an optional constructor/option parameter (e.g. `docGeneratorFactory`) to `ReleasePipeline`, defaulting to the real `DocGenerator`, and have the test pass a factory whose `generate()` throws. This makes the restore path deterministically reachable on all platforms. Tradeoff: production API changes solely for testability, and the seam covers only the changelog step — failures in `write-releases-record` or `writeProductVersion` would still need their own seams or mocks.
3. **Vitest module mock** — Use `vi.mock('../src/docs/doc-generator.js')` (or `vi.spyOn` on the prototype) in a dedicated test file so `generate()` throws during the mutation group, then assert restoration, absence of commit/tag, and the named failing step. Tradeoff: module-level mocking couples the test to the import path and cannot live comfortably in the existing `release-pipeline.test.ts`, which imports the real `DocGenerator` for regeneration assertions — a separate test file is required.
