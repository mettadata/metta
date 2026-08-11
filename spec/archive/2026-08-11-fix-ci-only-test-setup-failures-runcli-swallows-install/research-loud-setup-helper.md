# Research: Loud Setup Helper (`runCliOrThrow` + `installFixture`)

Approach under evaluation: add fail-fast helpers to `tests/helpers/cli.ts` that throw with full
diagnostics when a setup-phase CLI command fails (or when install exits 0 but leaves no
`.metta/config.yaml`), then migrate the discarded-result setup call sites.

## 1. Problem summary

`runCli` (`tests/helpers/cli.ts:36-65`) catches every exec failure and converts it into a
`{ stdout, stderr, code }` return. It even appends a stderr marker for timeout kills
(lines 57-62) — but setup-phase callers discard the return entirely
(`await runCli(['install', '--git-init'], tempDir)`), so a dead install process leaves zero
trace. The first visible symptom is a downstream ENOENT on `.metta/config.yaml`, which reads
like an unrelated flake. This is exactly what blocked PR #79 in CI: 3/3 red runs in
`tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts` with no captured stderr from the
dead child.

Two properties of the current helper matter for the design:

- **Signal info is lossy.** On a signal kill, `execFile`'s error has `code: undefined`; `runCli`
  coerces that to `code: 1` and pushes the signal into a stderr text marker. A throwing helper
  should surface signal/code as first-class data, not only as prose in stderr.
- **The `runCli` contract must not change.** The change spec (Requirement: "runCli Return-Value
  Contract Preserved") pins the existing resolve-always behavior for the ~13 tests that
  deliberately assert `code !== 0` (e.g. `tests/cli-install.test.ts:436-437`,
  `tests/cli-complete.test.ts:1216`, `tests/cli-finalize.test.ts:374`).

## 2. Call-site landscape (measured in this worktree)

`grep -rn "runCli(\['install'"` across `tests/`: **180 total install call sites in 15 files.**

Classification:

| Pattern | Count | Notes |
|---|---|---|
| Bare `await runCli(['install', ...], tempDir)` (result discarded) | 166 | The silent-failure population |
| `const { ... } = await runCli(['install', ...])` (result asserted) | 14 | `cli-install` (9), `cli-metta-guard-bash-integration` (3), `cli-version-drift` (2) — must NOT migrate |

The 166 bare sites are **remarkably uniform** — only two textual shapes exist:

- `await runCli(['install', '--git-init'], tempDir)` — **162 sites**
- `await runCli(['install'], tempDir)` — **4 sites**, all in `tests/cli-install.test.ts`
  (re-install idempotency calls, e.g. lines 216, 244, 281, 453)

Per-file bare-site counts:

| File | Bare install sites |
|---|---|
| `tests/cli-complete.test.ts` | 36 |
| `tests/cli-status.test.ts` | 29 |
| `tests/cli-issue-backlog.test.ts` | 24 |
| `tests/cli-install.test.ts` | 19 (15 `--git-init` + 4 plain) |
| `tests/cli-propose.test.ts` | 17 |
| `tests/progress-ceremony-metrics.test.ts` | 12 |
| `tests/cli-finalize.test.ts` | 9 |
| `tests/complexity-tracking.test.ts` | 8 |
| `tests/cli-propose-worktree.test.ts` | 6 |
| `tests/complete-marks-tasks.test.ts` | 3 |
| `tests/cli-propose-stop-after.test.ts`, `cli-roadmap`, `cli-worktree-change-root` | 1 each |

Adjacent finding: there are also **~116 bare `await runCli([...])` non-install setup calls**
(49 `propose`, 31 `quick`, 16 `roadmap`, 9 `issue`, 5 `backlog`, ...) across 10 files. These are
equally silent but require per-site review before migration (a bare await *could* be a
deliberately-failing command whose side-effect absence is asserted afterward). They map to the
spec's SHOULD tier, not the MUST tier.

The `install` → `disableWorktrees(tempDir)` pairing is common (103 pairings across 8 files) but
**not universal** — `cli-propose-worktree.test.ts` has 6 installs and only 1 `disableWorktrees`
because it deliberately keeps worktree mode on. So `installFixture` must NOT fold
`disableWorktrees` in.

## 3. Proposed helper design

Refactor the exec into a shared internal that preserves signal info, then layer three exports.
`runCli`'s public shape and marker behavior stay byte-identical.

```ts
// tests/helpers/cli.ts (additions; runCli reimplemented over execCliRaw, contract unchanged)

interface RawResult {
  stdout: string
  stderr: string
  code: number
  signal: NodeJS.Signals | null
  killed: boolean
}

async function execCliRaw(args: string[], cwd: string, timeoutMs: number): Promise<RawResult>

/** Thrown by runCliOrThrow / installFixture. Fields allow programmatic inspection. */
export class CliSetupError extends Error {
  readonly name = 'CliSetupError'
  constructor(
    message: string,
    readonly args: string[],
    readonly cwd: string,
    readonly code: number,
    readonly signal: NodeJS.Signals | null,
    readonly stdout: string,
    readonly stderr: string,
  ) { super(message) }
}

/** Fail-fast variant: throws on non-zero exit or signal kill; resolves with output on success. */
export async function runCliOrThrow(
  args: string[],
  cwd: string,
  timeoutMs = 10000,
): Promise<{ stdout: string; stderr: string }>

/** Install a fixture project and verify .metta/config.yaml exists afterward. */
export async function installFixture(
  dir: string,
  opts: { gitInit?: boolean } = {},   // default gitInit: true → ['install', '--git-init']
): Promise<void>
```

**Error message format** (multi-line; vitest renders `Error.message` verbatim in the failure
block, so a structured multi-line message is fully visible in CI logs):

```
[runCliOrThrow] CLI setup command failed
  command: metta install --git-init
  cwd:     /tmp/metta-test-abc123
  exit:    code=null signal=SIGTERM (killed=true, timeout budget 10000ms)
  --- stderr (last 8192 bytes) ---
  ...
  --- stdout (last 8192 bytes) ---
  ...
```

Design decisions and rationale:

1. **Throw condition:** `code !== 0 || signal !== null || killed`. Signal kills currently
   masquerade as `code: 1`; the raw layer keeps them distinct so the message names the signal
   and the timeout budget directly (spec scenario "Signal kill throws with signal named"),
   instead of relying on the stderr marker prose.
2. **Timeout-marker interaction:** `runCli` keeps appending its `[runCli] subprocess killed`
   marker exactly as today (both built on `execCliRaw`, marker applied only in `runCli`).
   `runCliOrThrow` doesn't need the marker — the same facts are first-class in the error.
   No duplication, no behavior drift for existing assertions (e.g.
   `tests/cli-complete.test.ts` tests that grep the marker keep working).
3. **`installFixture` post-check:** after a zero-exit install, `access(join(dir, '.metta',
   'config.yaml'))`; on ENOENT throw `CliSetupError` with `code: 0`, `signal: null`, and the
   captured stdout/stderr, message naming the missing path. This covers the "exited 0 but wrote
   nothing" corner the spec requires, and pins failure attribution to install rather than the
   next state read.
4. **Custom class vs plain Error:** a small `CliSetupError` subclass matches the project's
   "custom error classes with typed hierarchies" convention, costs ~10 lines, and lets any
   future meta-test assert on fields instead of parsing the message. Plain `Error` would also
   satisfy the spec; the class is the better fit for near-zero cost.
5. **Output truncation:** cap stderr/stdout at the last 8 KiB each. `metta install` output is
   normally < 2 KiB, so truncation never fires on the target failure mode; it only guards a
   pathological runaway (e.g. tsx stack spew) from producing a megabyte-scale vitest error
   block. "Full stderr/stdout" in the spec is satisfied in practice — the tail always contains
   the terminal error; if strict literalism is preferred, drop the cap (low risk either way).
6. **Success return:** `runCliOrThrow` resolves `{ stdout, stderr }` (spec allows this; a few
   future setup sites may want to read output). `installFixture` returns `void` — no caller
   uses install output today.

## 4. Migration plan (mechanics + real counts)

**Phase A — MUST (spec minimum): 45 sites, 2 files, fully sed-able.**
`tests/cli-finalize.test.ts` (9) + `tests/cli-complete.test.ts` (36). Every site is the exact
line `await runCli(['install', '--git-init'], tempDir)` → `await installFixture(tempDir)`, plus
one import-line edit per file (both files already import from `./helpers/cli.js`).

**Phase B — SHOULD (same mechanical pattern): +102 sites, 10 more files.**
All remaining `await runCli(['install', '--git-init'], tempDir)` sites *outside*
`cli-install.test.ts`: `cli-status` (29), `cli-issue-backlog` (24), `cli-propose` (17),
`progress-ceremony-metrics` (12), `complexity-tracking` (8), `cli-propose-worktree` (6),
`complete-marks-tasks` (3), `cli-propose-stop-after` / `cli-roadmap` /
`cli-worktree-change-root` (1 each). Identical one-line substitution + import edits. A single
`sed`/`perl -pi` over the file list handles the bodies; imports are 10 small manual edits.

**Deliberately excluded:**
- `tests/cli-install.test.ts` (19 bare sites) — this is the install capability's own test file.
  Its bare first-installs are followed immediately by direct file assertions (they self-diagnose
  one step later), and its 4 plain `['install']` calls are re-install idempotency probes that
  are part of the behavior under test. Migrating them changes what the file is asserting about
  install; leave on `runCli`. (Optional follow-up: migrate only the first-install setup lines.)
- All 14 result-captured install sites — including the one intentionally-failing install
  (`cli-install.test.ts:436`, `--stack ruby`, asserts `code !== 0`). The migration rule
  "only lines matching `^\s*await runCli\(\['install'` exactly" excludes these by construction.
- The ~116 bare non-install setup calls (`propose`/`quick`/`roadmap`/...) — candidate for a
  `runCliOrThrow` sweep, but each needs a per-site glance to confirm the command is expected to
  succeed. Recommend doing this as a second commit within the same change (or explicit
  follow-up), file by file, not blindly.

**Verification:** full local `npm test` (2122+ tests) must be green with identical pass/fail
results — the helpers only change failure-path behavior. A small new
`tests/helpers/cli.test.ts` (or additions to an existing helper test) covering the four spec
scenarios (non-zero throw, signal throw, success no-throw, zero-exit-missing-config throw) keeps
the ~1:1 test-to-source convention; the missing-config scenario is testable by running install
into a dir and deleting `.metta/config.yaml` is not possible post-hoc — instead exercise
`installFixture` against a stub command or test `CliSetupError` construction plus an
`installFixture` run where install is pointed at a path that succeeds, and unit-test the
post-check via a directory where `.metta/config.yaml` is removed between exec and check
(simplest honest version: extract the post-check into a tiny exported function and test it
directly).

## 5. Risks and tradeoffs

- **Migrating a site that tolerates failure** — the main hazard. Mitigated by construction:
  only bare-await install sites with the exact two textual shapes are touched, the 14
  result-captured sites (including the sole intentional-failure install) are untouched, and
  `cli-install.test.ts` is excluded wholesale. Residual risk ≈ zero for Phase A/B; real for the
  non-install sweep, hence per-site review there.
- **Happy-path behavior drift** — none: helpers throw only when the child fails, and
  `installFixture` runs the identical `npx tsx` chain (`execCliRaw` shared with `runCli`), so
  process count/cost per test is unchanged.
- **`runCli` refactor regression** — rebuilding `runCli` on `execCliRaw` risks subtle marker
  drift. Mitigation: keep the marker string and append logic byte-identical; existing tests
  that assert on the marker act as the regression net.
- **Error message size in vitest output** — bounded by the 8 KiB tails; without the cap a
  runaway child could bloat CI logs. Multi-line `Error.message` renders fine in vitest's
  reporter (it prints the message block verbatim before the stack).
- **This helper alone does not fix CI** — it converts an undiagnosable red into a diagnosable
  one. The concurrency cap (spec requirement 5, separate track) is what should make CI green;
  the helper is what proves it (and self-diagnoses any residue). Ship both.
- **Beforeeach duplication remains** — 147 near-identical setup blocks still exist; this change
  intentionally does not extract a shared fixture builder (out of scope, higher blast radius).

## 6. Verdict

**Viable and recommended.** The call-site population is far more uniform than feared — 162 of
166 discarded sites are one identical line — so migration is a mechanical substitution with a
crisp exclusion rule that automatically protects every intentional-failure test. The layered
design (`execCliRaw` → `runCli` unchanged / `runCliOrThrow` / `installFixture` +
`CliSetupError`) satisfies all four helper-related spec requirements without touching the
existing `runCli` contract, adds first-class signal reporting the current marker approach
loses, and covers the zero-exit-no-config corner. Effort: ~60 lines of helper code + tests,
45 MUST-tier line edits, 102 SHOULD-tier line edits, 12 import edits.
