# Implementation Summary — fix-flaky-ci-test-teardown-enotempty-rmdir-race-temp-git

## What changed

1. **`.github/workflows/ci.yml`** — the "Configure git identity" step now also sets
   `git config --global gc.auto 0` and `git config --global gc.autoDetach false`,
   with a comment explaining why: detached git auto-gc in temp test repos races
   the tests' recursive `rm` teardown and produces `ENOTEMPTY` flakes
   (observed on GitHub Actions run 31262392642, 2/1859 failures, green on rerun).

2. **Test teardown hardening (81 test files, `tests/**` and `src/**/*.test.ts`)** —
   every recursive temp-dir removal option object
   `{ recursive: true, force: true }` (both `fs.rm` and `fs.rmSync`) now reads
   `{ recursive: true, force: true, maxRetries: 5, retryDelay: 100 }`.
   Node retries the documented retryable error class (`ENOTEMPTY`, `EBUSY`,
   `EMFILE`, `ENFILE`, `EPERM`) with backoff, closing the whole flake class —
   not just `cli-complete.test.ts` where it was observed.

Non-recursive single-file `rm` calls and production code (`src/release/release-pipeline.ts`)
were intentionally left untouched — they are not exposed to the directory-walk race.

## Verification evidence

- `npm test` — 116 files, **2053/2053 passed**
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — succeeds

## Commit

- `3c98965c0` `fix: harden CI/test teardown against git auto-gc ENOTEMPTY rmdir race`
