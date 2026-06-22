# Implementation: split tests/cli.test.ts per-command files

Resolves issue `metta-finalize-test-gate-cannot-pass-tests-cli-test-ts-is-a`.

## Problem

`tests/cli.test.ts` was a single 2573-line file holding 140 `it()` tests across
44 `describe()` blocks. Vitest parallelizes by file, so every one of those tests
ran sequentially on a single worker. Each test spawns a cold
`npx tsx src/cli/index.ts` subprocess (~2-9s), so the one file dominated suite
wall-clock and pushed the finalize 5-minute test gate over budget.

## Change

Pure mechanical file split — no test was renamed, reworded, weakened, skipped,
or dropped. The shared `runCli` helper was extracted into a module so the new
files import it instead of redefining it. CLI invocation semantics are
unchanged: still `npx tsx src/cli/index.ts <args>` with a 10s per-call timeout
and the identical try/catch result shape.

## Shared helper module

`tests/helpers/cli.ts` (new) exports:

- `execAsync` — `promisify(execFile)`
- `CLI_PATH` — `<repo>/src/cli/index.ts` (resolved from the helper's own
  `import.meta.dirname` via `../..`, so it points at the same file the original
  used)
- `runCli(args, cwd)` — byte-identical behavior to the original helper

Each new test file replicates the original per-suite `tempDir` lifecycle inline
(`let tempDir`, `beforeEach` → `mkdtemp(... 'metta-cli-')`, `afterEach` →
`rm(recursive, force)`) so the moved `describe` blocks see the same `tempDir`
variable they always did. In-body dynamic imports (`import('node:fs')`,
`import('node:fs/promises')`, `import('yaml')`, command modules) and the
`import.meta.dirname` template-path lookups were left verbatim — the new files
sit at the same `tests/` depth, so those paths resolve identically.

## New files and test counts

| File | Tests | Command groups |
|------|------:|----------------|
| `tests/cli-install.test.ts` | 28 | install, init, install guard hook, install stack detection |
| `tests/cli-skills.test.ts` | 14 | `--version`, metta-init/next/issue/backlog/fix-issues skill templates, constitution-checker agent + check-constitution skill byte-identity, init-flow CLAUDE.md |
| `tests/cli-status.test.ts` | 26 | status, next, status-after-propose, doctor, doctor --fix, corrupt-config boundary, changes list/abandon, gate list, validate-stories, status --change complexity |
| `tests/cli-issue-backlog.test.ts` | 25 | issue, fix-issue, branch-safety guard, backlog add --description, backlog done, check-constitution |
| `tests/cli-propose.test.ts` | 17 | propose, quick, propose/quick --auto, complete pre-complete validation |
| `tests/cli-complete.test.ts` | 25 | instructions advisory banner, instructions verification context, complete intent-time downscale, complete intent-time upscale, complete post-implementation upscale |
| `tests/cli-tasks.test.ts` | 5 | tasks plan |
| **Total** | **140** | |

Largest new file is 28 tests (was 140 in one file).

### Filename collision check

Pre-existing `tests/cli-*.test.ts` files were left untouched and do not collide
with the new names:
`cli-helpers.test.ts`, `cli-metta-guard-bash-integration.test.ts`,
`cli-propose-stop-after.test.ts`, `cli-tasks-plan.test.ts`.
(`cli-propose` ≠ `cli-propose-stop-after`; `cli-tasks` ≠ `cli-tasks-plan`.)

The original `tests/cli.test.ts` was deleted.

## Parity verification

- Original `tests/cli.test.ts`: **140** `it()`/`test()` (`grep -cE '^\s*(it|test)\('`).
- Sum across the 7 new files: 28 + 14 + 26 + 25 + 17 + 25 + 5 = **140**.
- **before == after: 140 == 140.**
- `expect(` call count: **499** in original == **499** across the new files.
- Sorted list of all 140 `it()`/`test()` description strings is **identical**
  between the original and the union of the new files (`diff` clean).

## Build / type-check / sample run

- `npx tsc --noEmit` (project config) — PASS.
- Explicit `tsc --noEmit --strict --module nodenext --moduleResolution nodenext
  --target ES2022 --skipLibCheck` over `tests/helpers/cli.ts` + all 7 new files —
  PASS (exit 0). Confirms the helper extraction did not break any import.
  (The project tsconfig excludes `tests/`, so this explicit pass is what
  actually type-checks the new files.)
- `npm run build` — PASS (exit 0).
- Sample run `npx vitest run tests/cli-tasks.test.ts` — 5/5 PASS in **12.12s**
  (wall ~13.7s), confirming the shared helper import resolves and the relocated
  tests execute unchanged.

The full CLI suite and `metta complete`/`finalize`/`verify` were intentionally
not run (per task constraints).
