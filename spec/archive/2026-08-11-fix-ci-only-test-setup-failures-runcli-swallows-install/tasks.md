# Tasks for fix-ci-only-test-setup-failures-runcli-swallows-install

## Batch 1 (no dependencies)

- [x] **Task 1.1: Refactor tests/helpers/cli.ts around execCliRaw with fail-fast helpers**
  - **Files**: `tests/helpers/cli.ts`
  - **Action**: Implement the helper layer exactly per design.md (Components item 1, Data Model, API Design):
    1. Add internal (not exported) `execCliRaw(args: string[], cwd: string, timeoutMs: number): Promise<RawResult>` — sole owner of the try/catch around `execAsync('npx', ['tsx', CLI_PATH, ...args], { cwd, timeout: timeoutMs })`; never throws; resolves `RawResult { stdout, stderr, code, signal, killed }` with `code: 0, signal: null, killed: false` on success and the exec error's fields preserved on failure (`code` as numeric exec code, `signal` NOT coerced into `code`).
    2. Reimplement `runCli(args, cwd, timeoutMs = 10000)` as a thin wrapper over `execCliRaw` with a **byte-identical** contract: resolves `{ stdout, stderr, code }`, applies the legacy `e.code ?? 1` coercion semantics at this layer only, and appends the timeout-kill stderr marker under the exact existing condition (`killed === true || signal !== null`) with the exact existing string `[runCli] subprocess killed (signal=${signal ?? 'unknown'}, timeout=${timeoutMs}ms)\n` including the current newline-join logic (`stderr.endsWith('\n') || stderr === '' ? '' : '\n'` prefix).
    3. Export `class CliSetupError extends Error` with `name = 'CliSetupError'` and readonly fields `args: string[]`, `cwd: string`, `code: number`, `signal: NodeJS.Signals | null`, `stdout: string`, `stderr: string` (full captures on the object; message tails truncated to last 8192 bytes per stream). Multi-line message format per design "Error message format (exact)": header `[runCliOrThrow] CLI setup command failed`, then `command:`, `cwd:`, `exit:    code=... signal=... (killed=..., timeout budget ...ms)` lines, then `--- stderr (last 8192 bytes) ---` and `--- stdout (last 8192 bytes) ---` blocks.
    4. Export `runCliOrThrow(args, cwd, timeoutMs = 10000): Promise<{ stdout: string; stderr: string }>` — wraps `execCliRaw`; throws `CliSetupError` when `code !== 0 || signal !== null || killed === true`; resolves `{ stdout, stderr }` on success; does NOT append the runCli marker.
    5. Export the config post-check as a small directly-testable function (e.g. `verifyInstallWrote(dir, result)`) using `access` from `node:fs/promises`: throws `CliSetupError` with `code: 0`, `signal: null`, header `[installFixture] install exited 0 but wrote no .metta/config.yaml` and a `missing: ${dir}/.metta/config.yaml` line, when `join(dir, '.metta', 'config.yaml')` is absent.
    6. Export `installFixture(dir: string, opts: { gitInit?: boolean } = {}): Promise<void>` — runs `runCliOrThrow(opts.gitInit !== false ? ['install', '--git-init'] : ['install'], dir)` then the post-check. Does NOT call `disableWorktrees`.
    7. Keep `execAsync`, `CLI_PATH`, `disableWorktrees` exports and the tsx contract comment (lines 11-15) intact. No new dependencies; Node builtins only.
  - **Verify**: `npx tsc --noEmit` passes. `npm test -- tests/cli-finalize.test.ts tests/cli-complete.test.ts` passes unmigrated (proves `runCli` contract unchanged, including any tests grepping the kill marker).
  - **Done**: All five helper surfaces (`runCli` unchanged contract, `CliSetupError`, `runCliOrThrow`, post-check function, `installFixture`) exist with the exact signatures and error format from design.md; existing suite behavior identical; `execCliRaw` is the only try/catch around `execAsync`.

- [x] **Task 1.2: CI-only vitest file serialization**
  - **Files**: `vitest.config.ts`
  - **Action**: Apply the exact resulting file from design.md "vitest.config.ts (exact resulting file — Track 2)": add `const isCI = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false'` with the explanatory comment about 4-core runners collapsing under concurrent `npx tsx` exec chains and `CI=1 npm test` reproduction, and add `fileParallelism: !isCI` inside `test`. No other lines change; no `package.json` or `.github/workflows/ci.yml` edits.
  - **Verify**: `npx tsc --noEmit` passes. `CI=1 npx vitest run tests/helpers/ --reporter=verbose 2>&1 | head -5` (or any small file subset) runs without config errors; a quick `CI=1 npx vitest run tests/cli-roadmap.test.ts tests/cli-worktree-change-root.test.ts` confirms serialized execution works.
  - **Done**: `vitest.config.ts` matches the design's exact target file; local runs (no `CI` env) keep full parallelism; `CI=1` forces `fileParallelism: false`.

## Batch 2 (depends on Batch 1)

- [x] **Task 2.1: Helper unit tests (tests/helpers/cli.test.ts)**
  - **Depends on**: Task 1.1
  - **Files**: `tests/helpers/cli.test.ts` (new)
  - **Action**: Write unit tests covering the five cases in design.md "Test plan for the helpers":
    1. Non-zero exit: `runCliOrThrow` with a deterministically failing invocation (unknown command/flag) rejects with `CliSetupError`; assert `err.code !== 0` and message contains the argv, code, and stderr content.
    2. Signal kill: `runCliOrThrow` with a tiny `timeoutMs` (1-50 ms) against a real invocation rejects with `CliSetupError`; assert `err.signal !== null` (do not pin SIGTERM exactly per design risk 4) and message includes the timeout budget.
    3. Success: `runCliOrThrow(['--version'], tmpdir)` (or equivalent cheap green command) resolves `{ stdout, stderr }` without throwing.
    4. Post-check: call the extracted post-check function directly with a dir lacking `.metta/config.yaml`; assert it throws `CliSetupError` with `code === 0`, `signal === null`, and a message naming the missing path. Companion happy case: after a real `installFixture(tempDir)`, `.metta/config.yaml` exists and nothing threw.
    5. `runCli` contract regression: `runCli` resolves (not throws) on a failing command with populated `{ stdout, stderr, code }`; a timeout kill appends the exact `[runCli] subprocess killed (signal=` ... `timeout=...ms)` marker string.
    Use temp dirs (`fs.mkdtemp`) with cleanup; import from `./cli.js` with the `.js` extension.
  - **Verify**: `npx vitest run tests/helpers/cli.test.ts` — all tests pass. `npx tsc --noEmit` passes.
  - **Done**: New test file exercises all four spec scenarios plus the runCli regression net and is green; no flaky timing assertions (signal asserted non-null, not exact).

- [x] **Task 2.2: MUST-tier migration — cli-finalize and cli-complete**
  - **Depends on**: Task 1.1
  - **Files**: `tests/cli-finalize.test.ts`, `tests/cli-complete.test.ts`
  - **Action**: In each file, replace ONLY lines matching the bare-await shape `^\s*await runCli\(\['install'` — concretely `await runCli(['install', '--git-init'], tempDir)` → `await installFixture(tempDir)` (9 sites in cli-finalize, 36 in cli-complete; preserve indentation and any variable name other than `tempDir` as-is in the argument). Add `installFixture` to each file's existing named import from `./helpers/cli.js`. Do NOT touch result-captured `const { ... } = await runCli(['install', ...])` sites or any non-install `runCli` calls.
  - **Verify**: `grep -n "await runCli(\['install'" tests/cli-finalize.test.ts tests/cli-complete.test.ts` returns only result-captured lines (assignment shapes), no bare awaits. `npx vitest run tests/cli-finalize.test.ts tests/cli-complete.test.ts` passes with the same test counts as before.
  - **Done**: Zero discarded-result install `runCli` calls remain in the two MUST-tier files (spec scenario "No discarded setup result in the minimum files"); both files green; imports updated.

- [x] **Task 2.3: SHOULD-tier migration group A — status, issue-backlog, propose**
  - **Depends on**: Task 1.1
  - **Files**: `tests/cli-status.test.ts`, `tests/cli-issue-backlog.test.ts`, `tests/cli-propose.test.ts`
  - **Action**: Same mechanical rule as Task 2.2: replace bare-await `await runCli(['install', '--git-init'], <dir>)` lines with `await installFixture(<dir>)` (29 / 24 / 17 sites respectively) and add `installFixture` to each file's existing `./helpers/cli.js` named import. Exclude result-captured sites by construction; leave all other `runCli` calls untouched.
  - **Verify**: `grep -n "await runCli(\['install'" tests/cli-status.test.ts tests/cli-issue-backlog.test.ts tests/cli-propose.test.ts` shows no bare-await lines. `npx vitest run tests/cli-status.test.ts tests/cli-issue-backlog.test.ts tests/cli-propose.test.ts` passes with unchanged test counts.
  - **Done**: All bare install setup calls in the three files use `installFixture`; files green; imports updated.

- [x] **Task 2.4: SHOULD-tier migration group B — remaining 7 files**
  - **Depends on**: Task 1.1
  - **Files**: `tests/progress-ceremony-metrics.test.ts`, `tests/complexity-tracking.test.ts`, `tests/cli-propose-worktree.test.ts`, `tests/complete-marks-tasks.test.ts`, `tests/cli-propose-stop-after.test.ts`, `tests/cli-roadmap.test.ts`, `tests/cli-worktree-change-root.test.ts`
  - **Action**: Same mechanical rule as Task 2.2 across the seven files (12 / 8 / 6 / 3 / 1 / 1 / 1 sites): bare-await `await runCli(['install', '--git-init'], <dir>)` → `await installFixture(<dir>)`, plus `installFixture` added to each existing `./helpers/cli.js` import. Do NOT add `disableWorktrees` anywhere it isn't already present — `cli-propose-worktree.test.ts` deliberately keeps worktree mode on (design: installFixture does not fold it in). Do NOT touch `tests/cli-install.test.ts` (excluded wholesale, ADR-3) or result-captured sites.
  - **Verify**: `grep -rn "await runCli(\['install'" tests/ --include='*.test.ts' | grep -v cli-install.test.ts | grep -v '=' ` returns nothing (no remaining bare-await install sites outside the excluded file). `npx vitest run` on the seven files passes with unchanged test counts.
  - **Done**: All 147 target sites across the 12 files are migrated (this task completes the sweep); `tests/cli-install.test.ts` untouched; all seven files green.

## Batch 3 (depends on Batch 2)

- [x] **Task 3.1: Full-suite verification (local and CI-mode)**
  - **Depends on**: Task 2.1, Task 2.2, Task 2.3, Task 2.4
  - **Files**: none (verification only; fix-forward edits allowed to files from prior tasks if a regression surfaces)
  - **Action**: Run the full verification battery from the design:
    1. `npx tsc --noEmit` — clean.
    2. `npm run lint` — clean.
    3. `npm test` — full suite (2122+ tests) passes with identical pass/fail results, normal local parallelism (spec: "Full local suite passes after the change" / "Local run is not constrained by the CI cap").
    4. `CI=1 npm test` — full suite passes serialized (`fileParallelism: false` in effect), the reproducible stand-in for the CI gates scenario (spec: "Gates job passes on a constrained runner").
    Confirm via `grep -rn "await runCli(\['install'" tests/ --include='*.test.ts' | grep -v cli-install.test.ts` that only result-captured sites remain repo-wide. If any step fails, diagnose and apply the minimal fix within this change's scope (helpers, migrated files, or vitest config) and rerun.
  - **Verify**: All four commands exit 0; the grep confirms no bare-await install sites outside `tests/cli-install.test.ts`.
  - **Done**: Green `npm test`, green `CI=1 npm test`, clean typecheck and lint; migration completeness confirmed; no `src/` files modified anywhere in the change.
