# fix-ci-only-test-setup-failures-runcli-swallows-install

## Problem

CI is failing on tests the PR under review never touched, and the logs contain no evidence of why. On PR #79, the gates job failed 3/3 runs with 4–10 failures per run in `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`, all sharing one signature: the setup-phase `metta install --git-init` child process dies in about 1 second without creating `.metta/`, so every subsequent state read fails with ENOENT on `.metta/config.yaml`. The identical commit passes the full suite locally (2122/2122, including runs pinned to 2 CPUs), and main's CI is green — this blocks PR #79 and, unfixed, will randomly block any future PR whose test additions shift vitest's file scheduling.

Two stacked defects in the test infrastructure cause this:

1. **Setup failures are silent.** `runCli` in `tests/helpers/cli.ts` (lines 41–64) catches every exec failure and converts it into a plain `{ stdout, stderr, code }` return value. Setup-phase callers — e.g. `await runCli(['install', '--git-init'], tempDir)` at `tests/cli-finalize.test.ts:33` — discard that return without asserting `code === 0`. There are ~180 such install call sites across ~15 CLI-fixture test files. When install dies, nothing throws and nothing is logged; the first visible error is a downstream ENOENT that reads like an unrelated flake. The helper already appends a stderr marker for timeout kills (lines 57–62), but even that marker vanishes because the caller ignores the result. Consequence: the actual CI-side errno (EAGAIN? ENOMEM? npx contention?) is invisible in every red run so far.

2. **CI concurrency is uncapped over an expensive exec model.** `vitest.config.ts` sets no `maxWorkers`, pool, or file-parallelism caps, so CI runs vitest's default worker-per-CPU parallelism. Every `runCli` call execs an `npx tsx src/cli/index.ts` chain — npx wrapper → tsx → node, three processes per CLI invocation. The heaviest fixture files (`cli-finalize`, `cli-complete`) each spawn dozens of these chains; concurrent workers on a resource-constrained 2-core GitHub runner multiplying multi-process chains is consistent with process-spawn resource exhaustion or npx cache/binstub contention killing the child within ~1s before the CLI writes anything. PR #79's two new real-git-worktree e2e tests plausibly shifted file scheduling so the heavy files now run concurrently, crossing the threshold — explaining why an untouched test file fails in CI while local runs (warm npx cache, no cgroup memory limits) pass.

**Who is affected:** every contributor whose PR must pass the CI gates job; the maintainer, who currently cannot diagnose the failure because CI logs carry zero stderr from the dead process; and PR #79 specifically, which is blocked now.

## Proposal

Fix both defects together — diagnosability first (so any residual CI failure self-diagnoses), then the exhaustion trigger:

1. **Loud setup helper.** Add a fail-fast helper to `tests/helpers/cli.ts` — `runCliOrThrow(args, cwd, timeoutMs?)` and/or a purpose-built `installFixture(dir)` — that runs the CLI and **throws** with exit code, signal, and full stderr/stdout when the command exits non-zero, and (for install) additionally verifies `.metta/config.yaml` exists afterward, throwing with the same captured diagnostics if it does not. The existing `runCli` keeps its current contract for tests that deliberately assert on non-zero exits.

2. **Migrate setup-phase call sites.** Convert setup-phase `runCli(['install', ...])` invocations (and other setup calls whose results are discarded) in the CLI-fixture test files to the loud helper — at minimum all sites in `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`, and preferably the same pattern across the other fixture files (`cli-propose`, `cli-status`, `cli-install`, etc.) that share it. Assertion-phase `runCli` calls whose return values are inspected stay as-is.

3. **Cap CI test concurrency.** Constrain vitest parallelism so the heavy exec-storm fixture files cannot run concurrently on a resource-constrained runner — e.g. `maxWorkers` (env-driven so local runs stay fast, or a conservative unconditional cap), or serializing the identified heavy files. The exact mechanism is a design decision; the requirement is that the gates job no longer schedules multiple heavy CLI-fixture files onto concurrent workers on a 2-core runner.

Acceptance shape: CI gates job green on this change's branch; if any setup-phase CLI invocation ever fails again in CI, the test output names the failing command with its exit code, signal, and captured stderr instead of a downstream ENOENT.

## Impact

- **Test suite only — no production/CLI source code changes.** `src/` is untouched.
- `tests/helpers/cli.ts` gains a throwing helper; the existing `runCli` return-value contract is unchanged, so the ~2100 existing assertions keep their semantics.
- CLI-fixture test files (~15 files, up to ~180 setup call sites) have setup invocations migrated to the loud helper; test behavior on the happy path is identical, failure behavior becomes fail-fast with diagnostics.
- `vitest.config.ts` (and possibly `.github/workflows/ci.yml` via an env var) gains a concurrency cap. CI wall-clock time may increase modestly; local `npm test` should remain at current speed if the cap is env-scoped to CI.
- Unblocks PR #79, whose failures are this infrastructure defect, not its own changes.
- The `ci-test-infrastructure` capability spec is the likely home for the resulting requirements.

## Out of Scope

- **Reducing per-call process cost** (candidate solution 3): dropping the `npx` wrapper, resolving the tsx binary directly, or building once and exec-ing `node dist/cli/index.js`. This is the most invasive option, reintroduces stale-dist risk, and requires reworking the tsx-resolution contract documented in `tests/helpers/cli.ts:11-15`. It can be a follow-up if the concurrency cap proves insufficient.
- Any change to `metta install` or other production CLI behavior — the install command is not at fault.
- Rearchitecting the CLI test harness (e.g. in-process CLI invocation instead of child processes).
- Fixing or reviewing the content of PR #79 itself; this change only removes the CI blocker.
- General flake-hunting beyond the two defects identified here (e.g. the git auto-gc teardown races already mitigated in `ci.yml`).
- Tuning coverage configuration or CI matrix/runner sizing.
