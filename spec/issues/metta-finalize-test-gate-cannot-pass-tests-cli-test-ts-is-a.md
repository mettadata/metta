# metta finalize test gate cannot pass: tests/cli.test.ts is a single 140-test file that exceeds the gate timeout on one worker

**Captured**: 2026-06-22
**Status**: logged
**Severity**: major

## Symptom
`metta finalize` always fails its `tests` gate with a Timeout at the 5-minute cap (validated live: gate fail at 300178ms), so finalize can never archive and every change must be finalized manually. The failure presents misleadingly as "load near 0, no progress" rather than an obvious hang.

## Root Cause Analysis
`tests/cli.test.ts` is a single ~2573-line file containing ~157 `it()` tests across 44 `describe()` blocks. Each test invokes the shared `runCli` helper, which spawns a cold CLI subprocess via `execFile` (`npx tsx src/cli/index.ts`). On this host each spawn costs ~2-9s (node startup + full module load), averaging ~4-5s, so the file totals roughly 10 minutes of wall-clock. Vitest parallelizes by FILE — a file is one worker's unit of work — so all ~157 tests run serially on a SINGLE worker and cannot be spread across the 56 cores. The file alone exceeds the 5-minute gate regardless of available parallelism. The "no progress" symptom is one worker serially waiting on subprocess spawns (not CPU-bound work); it is NOT a hung test or a leaked handle. The other 69 test files finish quickly on other workers — `cli.test.ts` is the long pole. The finalize-hang lock/timeout fix made this safe (fail-fast at 5min) but did not eliminate the underlying serialization.

### Evidence
- `tests/cli.test.ts:13` — the shared `runCli` helper spawns a cold subprocess via `execFile` per test, so each of ~157 tests pays full CLI startup cost.
- `tests/cli.test.ts:1-2573` — 157 `it()` across 44 `describe()` blocks all live in ONE file, which Vitest schedules onto a single worker (file is the unit of parallelism).

## Candidate Solutions
1. **Split by command into multiple files with a shared helper module** — extract `runCli` and shared imports into a `tests/helpers/cli.ts` module, then split `cli.test.ts` into several files grouped by command (e.g. install, init, changes, gate/issue/misc). File-level parallelism then distributes the ~157 tests across workers and the slowest single file drops to ~2 minutes, comfortably under the gate. All 157 tests must be preserved (verify count parity before/after). Tradeoff: larger diff touching every test block and a new shared module to maintain; risk of accidentally dropping or duplicating a test during the split, mitigated by a before/after count check.
2. **Convert e2e tests to in-process CLI invocation** — call the CLI entry in-process instead of spawning, eliminating per-test node startup so the whole file runs in seconds even on one worker. Tradeoff: trades away real-subprocess fidelity (process exit codes, stdout/stderr buffering, argv parsing under a real shell) — explicitly out of scope per the report as a deeper perf refactor.
3. **Raise the gate timeout above the file's wall-clock** — bump the 5-minute cap so the single-worker run finishes inside the gate. Tradeoff: re-introduces the slow/fragile finalize the fail-fast cap was added to prevent and masks the serialization rather than fixing it; explicitly out of scope (the 5-minute cap should stay).
