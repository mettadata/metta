# UAT: fix-flaky-ci-test-teardown-enotempty-rmdir-race-temp-git

- **Change**: fix-flaky-ci-test-teardown-enotempty-rmdir-race-temp-git
- **Generated**: 2026-08-11
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
- **Do**: Confirm: Kill the background writer at the source (CI): extend the existing "Configure git identity" step in `.github/workflows/ci.yml` with `git config --global gc.auto 0` and `git config --global gc.autoDetach false`, so no detached git maintenance process ever runs in CI temp repos.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Make teardown tolerant (tests): add `maxRetries` / `retryDelay` to the `fs.rm` options in test teardown so transient `ENOTEMPTY`/`EBUSY` errors are retried by Node itself (documented `fs.rm` behavior: retryable errors are retried with backoff when `maxRetries > 0`). Apply the same options uniformly across all test-file teardowns that use the `{ recursive: true, force: true }` pattern, so the whole flake class is closed — not just the one suite where it was observed.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Non-recursive single-file `rm` calls and production code (`src/release/release-pipeline.ts`) were intentionally left untouched — they are not exposed to the directory-walk race.

#### Step 2.1
- **Do**: Confirm: `.github/workflows/ci.yml` — the "Configure git identity" step now also sets `git config --global gc.auto 0` and `git config --global gc.autoDetach false`, with a comment explaining why: detached git auto-gc in temp test repos races the tests' recursive `rm` teardown and produces `ENOTEMPTY` flakes (observed on GitHub Actions run 31262392642, 2/1859 failures, green on rerun).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: Test teardown hardening (81 test files, `tests/**` and `src/**/*.test.ts`) — every recursive temp-dir removal option object `{ recursive: true, force: true }` (both `fs.rm` and `fs.rmSync`) now reads `{ recursive: true, force: true, maxRetries: 5, retryDelay: 100 }`. Node retries the documented retryable error class (`ENOTEMPTY`, `EBUSY`, `EMFILE`, `ENFILE`, `EPERM`) with backoff, closing the whole flake class — not just `cli-complete.test.ts` where it was observed.
- **Observe**: behaves as described
- [ ] Pass
