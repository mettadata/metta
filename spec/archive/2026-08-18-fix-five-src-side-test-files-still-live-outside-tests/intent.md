# fix-five-src-side-test-files-still-live-outside-tests

## Problem

The repo convention keeps unit tests under `tests/` with a near 1:1 test-to-source ratio, but five test files still live next to their sources under `src/`:

- `src/config/build-stamp.test.ts`
- `src/config/config-writer.test.ts`
- `src/config/repair-config.test.ts`
- `src/config/version-drift.test.ts`
- `src/finalize/finalize-lock.test.ts`

PR #86 stopped these files from polluting `dist/` by adding `"src/**/*.test.ts"` to the tsconfig `exclude` array, so the build is already clean — but the layout inconsistency remains: 123 test files sit in `tests/` while these five are the only outliers. Contributors looking for a module's test now have two places to check, and new tests risk copying the outlier pattern.

Each of the five files has exactly one relative import — the module under test (e.g. `from './build-stamp.js'`, `from './finalize-lock.js'`) — and no `__dirname`-relative fixture paths. The only filesystem-path reference is `build-stamp.test.ts:211`, which resolves `scripts/emit-build-stamp.mjs` via `join(process.cwd(), 'scripts', ...)`; since vitest runs from the repo root, that resolution is independent of the test file's location and survives relocation unchanged.

## Proposal

Mechanically relocate the five test files to `tests/` and rewrite their single relative import each:

| From | To | Import rewrite |
|------|----|----------------|
| `src/config/build-stamp.test.ts` | `tests/build-stamp.test.ts` | `./build-stamp.js` → `../src/config/build-stamp.js` |
| `src/config/config-writer.test.ts` | `tests/config-writer.test.ts` | `./config-writer.js` → `../src/config/config-writer.js` |
| `src/config/repair-config.test.ts` | `tests/repair-config.test.ts` | `./repair-config.js` → `../src/config/repair-config.js` |
| `src/config/version-drift.test.ts` | `tests/version-drift.test.ts` | `./version-drift.js` → `../src/config/version-drift.js` |
| `src/finalize/finalize-lock.test.ts` | `tests/finalize-lock.test.ts` | `./finalize-lock.js` → `../src/finalize/finalize-lock.js` |

This matches the established `tests/` import style (e.g. `tests/artifact-store.test.ts` imports `../src/artifacts/artifact-store.js`). Moves use `git mv` to preserve history. No test logic, assertions, or setup/teardown code changes.

**Config decisions (explicit scope calls):**

1. **Keep the tsconfig `"src/**/*.test.ts"` exclusion** added by PR #86. After the move it becomes a no-op, but it is a zero-cost regression guard: if a test file ever lands under `src/` again, the build stays clean instead of shipping compiled tests into `dist/`. Removing it would re-open the exact failure mode PR #86 fixed.
2. **Keep the vitest `'src/**/*.test.ts'` include pattern.** Same rationale from the other direction: a stray future src-side test would still be discovered and run rather than silently skipped. The existing `'tests/**/*.test.ts'` pattern already covers the relocated files, so no vitest change is needed for them to run.

No target-name collisions exist: none of the five basenames currently appear in `tests/`.

## Impact

- **Files moved:** 5 (`git mv`, history preserved)
- **Lines edited:** 5 import specifiers (one per file), nothing else
- **Config:** no changes — tsconfig exclusion and vitest include patterns retained as regression guards
- **Build:** unaffected; the files were already excluded from `tsc` output
- **Test suite:** identical test count and behavior; vitest discovers the moved files via the existing `tests/**/*.test.ts` include; `build-stamp.test.ts`'s `process.cwd()`-based script path still resolves because vitest's cwd is the repo root regardless of test file location
- **Risk:** low — mechanical relocation verified against each file's full relative-import list; failure is loud (module-not-found at test startup), not silent

## Out of Scope

- Any change to test logic, assertions, fixtures, mocks, or setup/teardown code
- Removing the tsconfig `"src/**/*.test.ts"` exclusion (retained deliberately as a dist-pollution guard)
- Removing the vitest `'src/**/*.test.ts'` include pattern (retained deliberately so stray src tests still run)
- Renaming test files or reorganizing `tests/` into subdirectories to mirror `src/` structure
- Adding lint/CI enforcement that forbids future `src/**/*.test.ts` files (worth a separate backlog item if recurrence becomes a problem)
- Touching `scripts/emit-build-stamp.mjs` or the build pipeline
