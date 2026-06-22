# split-tests-cli-test-ts-per-command-files-so-finalize-test

## Problem
`metta finalize` always fails its `tests` gate with a Timeout at the 5-minute cap (validated live: gate fail at 300178ms), so finalize can never archive and every change must be finalized manually. The failure presents misleadingly as "load near 0, no progress" rather than an obvious hang.

The root cause is structural, not a hung test. `tests/cli.test.ts` is a single ~2573-line file containing ~157 `it()` tests across ~44 `describe()` blocks. Each test invokes the shared `runCli` helper (`tests/cli.test.ts:13`), which spawns a cold CLI subprocess via `execFile` (`npx tsx src/cli/index.ts`). On this host each spawn costs ~2-9s (node startup + full module load), averaging ~4-5s, so the file totals roughly 10 minutes of wall-clock. Vitest parallelizes by FILE — a file is one worker's unit of work — so all ~157 tests run serially on a SINGLE worker and cannot be spread across cores. The file alone exceeds the 5-minute gate regardless of available parallelism. The other ~69 test files finish quickly on other workers; `cli.test.ts` is the long pole.

Everyone running `metta finalize` on this project is affected: the test gate can never pass, blocking automated archival for every change.

## Proposal
Restructure the CLI test suite so file-level parallelism distributes the ~157 tests across workers, dropping the slowest single file under the 5-minute gate.

1. Extract the shared `runCli` helper, plus the shared imports and setup it depends on, into a shared test-helper module (e.g. `tests/helpers/cli.ts`).
2. Split the ~44 `describe()` blocks out of `tests/cli.test.ts` into ~5-6 new per-command test files grouped by command — for example install, init, changes, gate/issue, propose, and misc — each importing the shared helper.
3. Delete the original `tests/cli.test.ts`.
4. Balance the grouping so the slowest resulting file runs at roughly 2 minutes of wall-clock, keeping the whole suite comfortably under the gate once files run in parallel across workers.

HARD requirement: preserve ALL ~157 tests verbatim. No test may be dropped, renamed, merged, or weakened. Verify `it()`-count parity before and after the split (count `it(` occurrences in the original file vs. the sum across all new files) and confirm the totals match.

## Impact
- `tests/cli.test.ts` is deleted; its contents move into ~5-6 new per-command test files plus one shared helper module.
- A new shared test-helper module is introduced and must be maintained going forward.
- `metta finalize`'s `tests` gate becomes passable: the slowest CLI test file drops from ~10 minutes to roughly 2 minutes, fitting under the 5-minute cap once Vitest spreads the files across workers.
- No production source code (`src/`) changes; behavior under test is unchanged. The same ~157 assertions run, just scheduled across more workers.
- The diff is large (touches every CLI test block) but mechanical. Primary risk is accidentally dropping or duplicating a test during the move, mitigated by the before/after `it()`-count parity check.

## Out of Scope
- Converting the CLI e2e tests to in-process invocation (calling the CLI entry in-process instead of spawning a subprocess). This is a deeper performance refactor that trades away real-subprocess fidelity (exit codes, stdout/stderr buffering, argv parsing under a real shell) and is explicitly deferred.
- Changing the gate timeout. The 5-minute cap stays as-is; raising it would re-introduce the slow/fragile finalize the fail-fast cap was added to prevent and would mask the serialization rather than fix it.
