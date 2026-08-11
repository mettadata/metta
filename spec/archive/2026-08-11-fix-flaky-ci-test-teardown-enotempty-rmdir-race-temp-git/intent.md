# fix-flaky-ci-test-teardown-enotempty-rmdir-race-temp-git

## Problem

CI test runs intermittently fail during teardown with `ENOTEMPTY` when `afterEach` hooks recursively remove temp git repositories (observed in `tests/cli-complete.test.ts` on GitHub Actions run 31262392642: 2 of 1859 tests failed, green on rerun). The root cause is a race: tests create real git repositories under `os.tmpdir()`, and git may spawn background maintenance (`gc --auto`, which detaches by default) that recreates or holds entries inside `.git/objects` while `fs.rm(tempDir, { recursive: true, force: true })` is walking the tree. The removal then fails with `ENOTEMPTY`/`EBUSY` even though the test itself passed.

Anyone relying on CI signal is affected: a red build that greens on rerun erodes trust in the gate and wastes rerun cycles. The flake class applies to every test suite that creates temp git repos — ~70 test files share the identical `await rm(<dir>, { recursive: true, force: true })` teardown pattern.

## Proposal

Defense in depth, both candidate fixes from the issue:

1. **Kill the background writer at the source (CI):** extend the existing "Configure git identity" step in `.github/workflows/ci.yml` with `git config --global gc.auto 0` and `git config --global gc.autoDetach false`, so no detached git maintenance process ever runs in CI temp repos.
2. **Make teardown tolerant (tests):** add `maxRetries` / `retryDelay` to the `fs.rm` options in test teardown so transient `ENOTEMPTY`/`EBUSY` errors are retried by Node itself (documented `fs.rm` behavior: retryable errors are retried with backoff when `maxRetries > 0`). Apply the same options uniformly across all test-file teardowns that use the `{ recursive: true, force: true }` pattern, so the whole flake class is closed — not just the one suite where it was observed.

## Impact

- `.github/workflows/ci.yml` — one step gains two `git config` lines. No job/topology change.
- `tests/*.test.ts` teardown calls — the `rm` options object gains retry fields; test semantics are unchanged (retries only trigger on the failure class that is currently flaky).
- No production/source code (`src/`) is touched. Local dev runs behave identically except that teardown becomes resilient to the same race.

## Out of Scope

- Restructuring test temp-dir management (e.g. a shared fixture/helper abstraction or vitest global teardown).
- Suppressing git gc for local developer machines (local flake incidence is unobserved; the CI config change is CI-only by design).
- Any change to CLI/runtime behavior in `src/`.
- Retrying arbitrary teardown errors — only Node's documented retryable class (`ENOTEMPTY`, `EBUSY`, `EMFILE`, `ENFILE`, `EPERM`) via `fs.rm` options.
