# Verification: split tests/cli.test.ts per-command files

Resolves issue `metta-finalize-test-gate-cannot-pass-tests-cli-test-ts-is-a`.

**Result: PASS** — pure relocation verified, 140-test parity confirmed, all gates green.

## Verification strategy

No `verification_strategy` was supplied in the invocation context for this metta
quick change. This is a test-suite restructuring with no `src/` behavior change,
so verification was driven by the existing test/typecheck/build gates plus a
targeted two-file end-to-end run. No project-specific strategy (tmux/playwright/
cli_exit_codes) is applicable to a test-file split.

## Check 1 — Parity (CRITICAL): PASS

`tests/cli.test.ts` no longer exists — `git status` shows ` D tests/cli.test.ts`
(deletion staged in working tree).

Per-file `it`/`test` counts (`grep -cE '^\s*(it|test)\('`):

| File | Tests |
|------|------:|
| `tests/cli-install.test.ts` | 28 |
| `tests/cli-skills.test.ts` | 14 |
| `tests/cli-status.test.ts` | 26 |
| `tests/cli-issue-backlog.test.ts` | 25 |
| `tests/cli-propose.test.ts` | 17 |
| `tests/cli-complete.test.ts` | 25 |
| `tests/cli-tasks.test.ts` | 5 |
| **TOTAL** | **140** |

`28 + 14 + 26 + 25 + 17 + 25 + 5 = 140`. Matches the documented original count of
140 and the implementation.md table exactly.

## Check 2 — No collisions: PASS

Pre-existing CLI test files are untouched — `git status --porcelain` reports no
modification for any of:

- `tests/cli-metta-guard-bash-integration.test.ts`
- `tests/cli-propose-stop-after.test.ts`
- `tests/cli-tasks-plan.test.ts`
- `tests/cli-helpers.test.ts`

The 7 new files appear only as `??` (untracked/new); the only deletion is the
original `tests/cli.test.ts`. New names do not collide:
`cli-propose` ≠ `cli-propose-stop-after`, `cli-tasks` ≠ `cli-tasks-plan`.

## Check 3 — Helper integrity: PASS

`tests/helpers/cli.ts:5,12,14` exports `execAsync`, `CLI_PATH`, and `runCli`.
`runCli` invokes `npx tsx src/cli/index.ts` (`tests/helpers/cli.ts:19-23`) with a
10s timeout and the same try/catch result shape — semantics unchanged, NOT
switched to dist (`CLI_PATH` resolves to `src/cli/index.ts` via
`import.meta.dirname/../..`).

All 7 new files import the helper:
`import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'`.

Each new file replicates the tempDir lifecycle inline — every file has a
`beforeEach`/`afterEach` pair driving `mkdtemp(... 'metta-cli-')` and
`rm(tempDir, { recursive, force })` (verified per-file: `beforeEach=2`,
`afterEach=2`, `mkdtemp` and `rm(tempDir` present in all 7).

## Check 4 — File size: PASS

Largest new file is `tests/cli-install.test.ts` at 28 tests — at the ~30-test
target ceiling and far below the old single-file 140. File-level parallelism can
now spread the CLI tests across workers; the slowest CLI file is ~1/5 of the
old monolith.

## Gates

| Gate | Command | Result |
|------|---------|--------|
| Typecheck (project) | `npx tsc --noEmit` | PASS (exit 0) |
| Typecheck (explicit, new files) | `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target ES2022 --skipLibCheck tests/helpers/cli.ts tests/cli-*.test.ts` | PASS (exit 0) |
| Lint | `npm run lint` (= `tsc --noEmit`) | PASS (exit 0) |
| Build | `npm run build` | PASS (exit 0) |

The explicit typecheck is required because the project tsconfig excludes
`tests/`; it confirms the helper extraction broke no import in any new file.

## Two-file end-to-end run

`npx vitest run tests/cli-tasks.test.ts tests/cli-skills.test.ts`:

```
✓ tests/cli-skills.test.ts (14 tests) 2675ms
✓ tests/cli-tasks.test.ts  (5 tests) 11211ms
Test Files  2 passed (2)
     Tests  19 passed (19)
  Duration  12.21s
```

19/19 pass — confirms the shared helper import resolves and the relocated tests
execute unchanged end-to-end.

## Notes

- The full CLI suite and the `metta finalize` test-gate timing were intentionally
  NOT run here (per task constraints); the under-5-minute gate timing is validated
  separately via a real finalize.
- Residual `cli.test.ts` string matches in `tests/helpers/cli.ts`,
  `tests/complete-marks-tasks.test.ts`, and `tests/complexity-tracking.test.ts`
  are provenance comments ("mirroring the pattern used in tests/cli.test.ts"),
  not live code dependencies — harmless and out of scope for this split.
- No `src/` changes; behavior under test is unchanged.
