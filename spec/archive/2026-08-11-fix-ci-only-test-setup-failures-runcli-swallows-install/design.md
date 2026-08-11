# Design: fix-ci-only-test-setup-failures-runcli-swallows-install

## Approach

Two independent tracks, both confined to test/CI infrastructure (`src/` untouched), mapping 1:1 to the two stacked defects in the intent and following the decision recorded in `research.md`:

**Track 1 — Loud setup helpers (defect 1: silent setup failures).** Refactor `tests/helpers/cli.ts` around a single shared internal exec function, `execCliRaw`, that preserves exit code, signal, and killed-flag as first-class data instead of coercing signal kills to `code: 1`. On top of it, layer three things: (a) the existing `runCli`, reimplemented over `execCliRaw` with its resolve-always `{ stdout, stderr, code }` contract and timeout-kill stderr marker kept **byte-identical** (spec: "runCli Return-Value Contract Preserved"); (b) a new fail-fast `runCliOrThrow` that throws a `CliSetupError` on any non-success; (c) a purpose-built `installFixture` that runs install via the fail-fast path and additionally verifies `.metta/config.yaml` exists afterward (spec: "Install Fixture Verifies Resulting State"). Then migrate the discarded-result install call sites: 45 MUST-tier sites in `cli-finalize`/`cli-complete`, 102 SHOULD-tier sites across 10 more files — all the identical one-line shape `await runCli(['install', '--git-init'], tempDir)` → `await installFixture(tempDir)`.

**Track 2 — CI-only vitest serialization (defect 2: uncapped concurrency over an expensive exec model).** A 3-line change to `vitest.config.ts`: `fileParallelism: !isCI`, where `isCI` is a truthy-`CI`-env check. This is the only configuration supported on the pinned vitest 3.2.6 that deterministically prevents two heavy CLI-fixture files from executing on concurrent workers (all parallelism knobs are root-only `NonProjectOption`s on 3.2.x, so a per-project split is deferred to a vitest 4 upgrade — see `research-ci-concurrency-cap.md`). Local parallelism is untouched; CI behavior is reproducible locally via `CI=1 npm test`. No `package.json` or `.github/workflows/ci.yml` edits — GitHub Actions already sets `CI=true`.

This uses proven patterns only: a shared raw-exec core with thin composed wrappers (composition, not inheritance), a small custom error class per project convention, and a documented env-conditional vitest option. Neither track introduces new dependencies or any vendor lock-in (the `CI` env var is a de-facto cross-CI standard, not GitHub-specific).

### ADR-1: Full CI serialization (`fileParallelism: false`) over `maxWorkers: 2`
- **Decision:** serialize test files entirely in CI.
- **Rationale:** `maxWorkers: 2` only lowers the probability of the exec storm (two 100-call files can still overlap); `fileParallelism: false` is the only supported 3.2.6 config that *guarantees* the spec scenario "Heavy fixture files do not run concurrently in CI". Cost is bounded (+6–10 min CI Test step, est. ~12–16 min total) and recoverable later (vitest 4 per-project split, or the process-cost follow-up in `research-process-cost.md`).
- **Fallback (pre-approved in research):** if the first CI run proves too slow, swap to `maxWorkers: isCI ? 2 : undefined` — acceptable only because Track 1 makes any residual flake self-diagnosing.

### ADR-2: Custom `CliSetupError` class over plain `Error`
- **Decision:** a dedicated error class carrying `args`/`cwd`/`code`/`signal`/`stdout`/`stderr` fields.
- **Rationale:** matches the project convention "custom error classes with typed hierarchies", costs ~15 lines, and lets helper unit tests (and any future meta-test) assert on fields instead of parsing message prose.

### ADR-3: Exclude `tests/cli-install.test.ts` and all result-captured sites from migration
- **Decision:** the install capability's own test file keeps `runCli` everywhere; the 14 result-captured install sites repo-wide are untouched.
- **Rationale:** install behavior (including deliberate failures and re-install idempotency) is what that file asserts; migrating would change what it tests. The mechanical migration rule (below) excludes result-captured sites by construction.

## Components

All changes live under the change_root worktree.

1. **`tests/helpers/cli.ts`** (modified) — the single source of exec behavior for shared-helper consumers.
   - `execCliRaw(args, cwd, timeoutMs)` — *internal, not exported.* Runs `execAsync('npx', ['tsx', CLI_PATH, ...args], { cwd, timeout: timeoutMs })` exactly as today; never throws; resolves a `RawResult` with `code`, `signal`, `killed` preserved from the exec error (success → `code: 0, signal: null, killed: false`). Sole owner of the try/catch around `execAsync`.
   - `runCli(args, cwd, timeoutMs = 10000)` — *export, contract unchanged.* Thin wrapper over `execCliRaw`: maps `RawResult` to `{ stdout, stderr, code }`, where `code` is the raw code when the child exited normally and the current coercion (`e.code ?? 1`) semantics otherwise, and appends the timeout-kill stderr marker with the **byte-identical** condition and string as today (`e.killed === true || (e.signal !== undefined && e.signal !== null)` → `[runCli] subprocess killed (signal=${signal ?? 'unknown'}, timeout=${timeoutMs}ms)\n`, including the existing newline-join logic). Existing tests that grep this marker are the regression net.
   - `CliSetupError` — *export.* Error subclass; see Data Model.
   - `runCliOrThrow(args, cwd, timeoutMs = 10000)` — *export.* Wrapper over `execCliRaw`; throws `CliSetupError` when `code !== 0 || signal !== null || killed === true`; resolves `{ stdout, stderr }` on success. Does **not** append the runCli marker — the same facts are first-class in the error.
   - `installFixture(dir, opts = {})` — *export.* Runs `runCliOrThrow(gitInit ? ['install', '--git-init'] : ['install'], dir)` with `opts.gitInit` defaulting to `true`; after a zero-exit install, checks `access(join(dir, '.metta', 'config.yaml'))`; on absence throws `CliSetupError` with `code: 0`, `signal: null`, and the captured stdout/stderr, message naming the missing path. Returns `void`. Does **not** fold in `disableWorktrees` (the pairing is common but not universal — `cli-propose-worktree.test.ts` deliberately keeps worktree mode on).
   - `verifyInstallWrote(dir, result)` (or equivalent small exported post-check) — the config-existence check extracted as a directly testable function, per the research verification note, so the zero-exit-missing-config scenario is unit-testable without racing the real install.
   - Unchanged exports: `execAsync`, `CLI_PATH`, `disableWorktrees`.

2. **`tests/helpers/cli.test.ts`** (new) — unit tests for the helpers; see API Design → Test plan. Keeps the near-1:1 test-to-source convention.

3. **Migrated fixture test files** (modified, one-line substitutions plus one import edit each):
   - MUST tier (45 sites, 2 files): `tests/cli-finalize.test.ts` (9), `tests/cli-complete.test.ts` (36).
   - SHOULD tier (102 sites, 10 files): `tests/cli-status.test.ts` (29), `tests/cli-issue-backlog.test.ts` (24), `tests/cli-propose.test.ts` (17), `tests/progress-ceremony-metrics.test.ts` (12), `tests/complexity-tracking.test.ts` (8), `tests/cli-propose-worktree.test.ts` (6), `tests/complete-marks-tasks.test.ts` (3), `tests/cli-propose-stop-after.test.ts` / `tests/cli-roadmap.test.ts` / `tests/cli-worktree-change-root.test.ts` (1 each).
   - Excluded: `tests/cli-install.test.ts` entirely (19 bare sites — install behavior under test) and all 14 result-captured install sites repo-wide (ADR-3).

4. **`vitest.config.ts`** (modified) — Track 2; exact diff in API Design.

## Data Model

No persistent state, schemas, or `.metta/` files change. The only new data shapes are in-memory test-helper types:

```ts
// Internal to tests/helpers/cli.ts
interface RawResult {
  stdout: string
  stderr: string
  code: number                    // exec error code when numeric; 0 on success
  signal: NodeJS.Signals | null   // preserved, NOT coerced into code
  killed: boolean                 // exec's killed flag (timeout kills)
}

// Exported
export class CliSetupError extends Error {
  readonly name = 'CliSetupError'
  constructor(
    message: string,
    readonly args: string[],           // CLI argv, e.g. ['install', '--git-init']
    readonly cwd: string,              // fixture dir the command ran in
    readonly code: number,             // exit code (0 for the missing-config case)
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,           // full captured stdout
    readonly stderr: string,           // full captured stderr
  ) { super(message) }
}
```

Key modeling decision (from `research-loud-setup-helper.md`): signal and code are **separate fields** end to end. Today's `runCli` loses the signal into stderr prose and coerces `code` to 1; `execCliRaw` keeps both, `runCli` re-applies its legacy coercion at its own layer only, and `CliSetupError` carries the true values. Message tails are truncated to the last 8 KiB per stream (see API Design), but the error object's `stdout`/`stderr` fields carry the full captures for programmatic inspection.

## API Design

### Helper signatures (exact)

```ts
// tests/helpers/cli.ts

async function execCliRaw(args: string[], cwd: string, timeoutMs: number): Promise<RawResult>  // internal

export async function runCli(
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string; code: number }>   // UNCHANGED contract + marker

export class CliSetupError extends Error { /* fields as in Data Model */ }

export async function runCliOrThrow(
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string }>
// throws CliSetupError when: code !== 0 || signal !== null || killed === true

export async function installFixture(
  dir: string,
  opts: { gitInit?: boolean } = {},    // gitInit defaults to true → ['install', '--git-init']
): Promise<void>
// throws CliSetupError on install failure (via runCliOrThrow) OR on zero-exit
// with missing `${dir}/.metta/config.yaml` (code: 0, signal: null)
```

### Error message format (exact)

Multi-line `Error.message`; vitest renders it verbatim in the failure block, so it is fully visible in CI logs. Stream tails capped at the last 8192 bytes each (install output is normally < 2 KiB, so the cap only guards pathological runaway spew):

```
[runCliOrThrow] CLI setup command failed
  command: metta install --git-init
  cwd:     /tmp/metta-cli-abc123
  exit:    code=null signal=SIGTERM (killed=true, timeout budget 10000ms)
  --- stderr (last 8192 bytes) ---
  <stderr tail>
  --- stdout (last 8192 bytes) ---
  <stdout tail>
```

- Non-signal failures render the exit line as `exit:    code=2 signal=none (killed=false, timeout budget 10000ms)`.
- The `installFixture` missing-config variant uses the header `[installFixture] install exited 0 but wrote no .metta/config.yaml` and names the missing absolute path (`missing: ${dir}/.metta/config.yaml`) before the same command/cwd/exit/stderr/stdout block.
- This satisfies the spec scenarios: command arguments named, exit code and signal included, timeout budget on signal kills, stderr and stdout captured.

### Migration rule (exact, mechanical)

Substitute **only** lines matching the bare-await shape `^\s*await runCli\(\['install'` — concretely the single textual form present at all 147 target sites:

```
await runCli(['install', '--git-init'], tempDir)   →   await installFixture(tempDir)
```

plus one import edit per file (all 12 files already import from `./helpers/cli.js`; add `installFixture` to the existing named-import list). By construction this excludes every `const { ... } = await runCli(['install', ...])` result-captured site and, by file-level exclusion, all of `tests/cli-install.test.ts`. The ~116 bare non-install setup calls (`propose`/`quick`/`roadmap`/…) are **not** migrated in this change (each needs per-site review; explicit follow-up). Assertion-phase `runCli` calls remain unchanged, satisfying the spec's "runCli Return-Value Contract Preserved" and "Setup-Phase Call Sites Fail Fast" requirements.

### Test plan for the helpers (`tests/helpers/cli.test.ts`, new)

Covers the four spec scenarios plus the refactor regression net:

1. **Non-zero exit throws** — `runCliOrThrow` with args that deterministically fail fast (e.g. an unknown command/flag) rejects with `CliSetupError`; assert `err.code !== 0`, and that `err.message` contains the argv, the code, and the stderr content. (Spec: "Non-zero exit throws with full diagnostics".)
2. **Signal kill throws with signal named** — `runCliOrThrow` with a tiny `timeoutMs` (e.g. 1–50 ms) against any real invocation rejects with `CliSetupError`; assert `err.signal === 'SIGTERM'` (or non-null) and the message includes the timeout budget. (Spec: "Signal kill throws with signal named".)
3. **Success does not throw** — `runCliOrThrow(['--version'], tmpdir)` (or another cheap always-green command) resolves with `{ stdout, stderr }`. (Spec: "Successful invocation does not throw".)
4. **Zero exit, missing config throws** — unit-test the extracted post-check directly: call it with a dir that lacks `.metta/config.yaml` and a success result; assert it throws `CliSetupError` with `code === 0`, `signal === null`, and a message naming the missing path. Companion happy case: after a real `installFixture(tempDir)`, `.metta/config.yaml` exists and no throw occurred. (Spec: "Zero exit but missing config throws" / "Successful install passes the post-check".)
5. **runCli contract regression** — assert `runCli` still resolves (not throws) on a failing command with populated `{ stdout, stderr, code }`, and that a timeout kill still appends the exact `[runCli] subprocess killed (signal=…, timeout=…ms)` marker string. (Spec: "Deliberate failure assertion still receives a return value".) Existing suite tests that grep the marker are a second net.

Full-suite verification: local `npm test` (2122+ tests) must pass with identical pass/fail results, and `CI=1 npm test` must pass serialized — the reproducible stand-in for the CI gates scenario.

### vitest.config.ts (exact resulting file — Track 2)

```ts
import { defineConfig } from 'vitest/config'

// CI runners (4-core ubuntu-latest) collapse under 4 concurrent
// `npx tsx` CLI exec chains (~16-20 processes): the `metta install
// --git-init` setup child dies and tests fail on ENOENT for
// .metta/config.yaml. Serialize test files in CI only; local runs
// keep full parallelism. Reproduce CI behavior with `CI=1 npm test`.
const isCI = process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    fileParallelism: !isCI,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**'],
    },
  },
})
```

Diff vs current: add the `isCI` const with the explanatory comment, add the single `fileParallelism: !isCI` line inside `test`. Nothing else changes; no `package.json`/`ci.yml` edits. On 3.2.6, `fileParallelism: false` forces `maxWorkers`/`minWorkers` to 1 while preserving per-file fork isolation (`poolOptions.forks.isolate` default true), so no shared-state risk is introduced (source: vitest v3.2.6 config docs, cited in `research-ci-concurrency-cap.md`).

## Dependencies

**External:** none added or changed.
- vitest 3.2.6 (lockfile-pinned) — `fileParallelism` is a documented root-level boolean on this version; no upgrade required or performed.
- tsx (declared devDependency) — helper continues to exec `npx tsx src/cli/index.ts`; the existing "do not remove tsx" contract comment in `tests/helpers/cli.ts:11-15` stays intact.
- Node >= 22 builtins only: `node:child_process` (`execFile`), `node:util` (`promisify`), `node:fs/promises` (`access` added for the post-check), `node:path`.
- `CI` env var — set by GitHub Actions and virtually every CI vendor; no GitHub-specific API is used, so **no vendor lock-in**.

**Internal:**
- Track 1 has an internal ordering: `execCliRaw` refactor → `runCli` reimplementation (marker byte-identical) → `CliSetupError`/`runCliOrThrow`/`installFixture` → helper unit tests → MUST-tier migration → SHOULD-tier migration. Each migration step is independently green-verifiable via `npm test`.
- Track 2 is fully independent of Track 1 and can land in either order; both are required for the acceptance shape (green CI + self-diagnosing residual failures).
- The ~18 test files with inline copies of the npx exec pattern are untouched (out of scope; they belong to the process-cost follow-up in `research-process-cost.md`).
- Spec home: the six requirements in this change's `spec.md` merge into the `ci-test-infrastructure` capability at ship time.

## Risks & Mitigations

1. **CI wall-clock regression (~6.2 → ~12–16 min Test step).** Bounded and estimated from real run data; `concurrency.cancel-in-progress` already limits queue pileup. Pre-approved fallback: `maxWorkers: isCI ? 2 : undefined` (+2–3 min, mitigation-only) if the first CI run proves the cost too high — acceptable only because Track 1 makes residual flakes self-diagnosing. Longer-term recovery: vitest 4 per-project split or the process-cost follow-up.
2. **`runCli` refactor drifts the marker or code-coercion semantics.** ~13 tests assert `code !== 0` and some grep the marker string. Mitigation: keep the marker condition and string byte-identical, add explicit contract-regression tests in `tests/helpers/cli.test.ts` (test 5), and rely on the full suite as the net — any drift fails loudly.
3. **Migrating a site that tolerates install failure.** Near-zero by construction: only the exact bare-await line shape is substituted, all 14 result-captured sites are excluded automatically, and `cli-install.test.ts` is excluded wholesale (ADR-3). The sole intentional-failure install (`cli-install.test.ts:436`) is inside both exclusions.
4. **Signal-kill helper test flakiness.** A 1–50 ms timeout races process spawn; on a very fast machine the child could theoretically exit first. Mitigation: point the timed-out invocation at a command guaranteed to outlive the budget (any real CLI invocation takes ~0.9 s+), and assert `signal !== null` rather than an exact signal if SIGTERM/SIGKILL escalation varies.
5. **Serialization masks rather than fixes the root cost.** True — the per-call 3-process exec chain remains expensive. Accepted: reducing process cost is explicitly out of scope (intent Out of Scope; research approach 3) and recorded as a follow-up. Track 1 guarantees any recurrence is diagnosable regardless.
6. **Estimate uncertainty on serialized CI time (11–18 min band).** Cheap to measure: the first CI run on this branch gives the real number and directly exercises the spec scenario "Gates job passes on a constrained runner"; the fallback in risk 1 is the pressure valve.
7. **Config drift — future exec-heavy tests.** The cap is global in CI, so new heavy files are automatically covered; new bare setup calls could still be written against silent `runCli`. Accepted residual risk; the non-install bare-call sweep is a named follow-up.
