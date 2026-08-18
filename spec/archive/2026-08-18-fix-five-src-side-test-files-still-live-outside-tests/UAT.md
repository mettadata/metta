# UAT: fix-five-src-side-test-files-still-live-outside-tests

- **Change**: fix-five-src-side-test-files-still-live-outside-tests
- **Generated**: 2026-08-18
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Keep the tsconfig `"src/**/*.test.ts"` exclusion added by PR #86. After the move it becomes a no-op, but it is a zero-cost regression guard: if a test file ever lands under `src/` again, the build stays clean instead of shipping compiled tests into `dist/`. Removing it would re-open the exact failure mode PR #86 fixed.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Keep the vitest `'src/**/*.test.ts'` include pattern. Same rationale from the other direction: a stray future src-side test would still be discovered and run rather than silently skipped. The existing `'tests/**/*.test.ts'` pattern already covers the relocated files, so no vitest change is needed for them to run.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Mechanical relocation of the five remaining src-side test files to tests/ (repo convention), restoring convention consistency after PR #86 removed dist pollution but left the files in place. Commit `bf6f9ac3eb13a8f87e028bba4e96c2289a2a267e`.

#### Step 2.1
- **Do**: Confirm: src/config/build-stamp.test.ts → tests/build-stamp.test.ts
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: src/config/config-writer.test.ts → tests/config-writer.test.ts
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: src/config/repair-config.test.ts → tests/repair-config.test.ts
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: src/config/version-drift.test.ts → tests/version-drift.test.ts
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: src/finalize/finalize-lock.test.ts → tests/finalize-lock.test.ts
- **Observe**: behaves as described
- [ ] Pass
