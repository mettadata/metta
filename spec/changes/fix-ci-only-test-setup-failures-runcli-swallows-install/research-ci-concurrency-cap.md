# Research: Cap CI Concurrency (vitest worker / file-parallelism pinning)

Approach under evaluation: pin vitest workers / file parallelism **in CI only** so heavy
CLI-exec test files never run concurrently, while preserving full parallelism locally.

## Problem summary

- `vitest.config.ts` sets **no** concurrency options — vitest 3.2.6 (lockfile-pinned) defaults
  to the `forks` pool with `maxWorkers = os.availableParallelism()` when watch is off.[^1][^2]
- Every `runCli()` call in `tests/helpers/cli.ts` (and ~18 local copies of the same helper in
  individual test files) execs `npx tsx src/cli/index.ts …` — a 3-process node chain — with a
  10s timeout, and **returns** `{ code }` instead of throwing, so a dead setup child
  (`metta install --git-init`) is silent until a later `ENOENT` on `.metta/config.yaml`.
- Scale measured in this worktree: **113 test files**, **33 files** call `runCli(`,
  **673 total `runCli(` call sites**. Heaviest: `cli-complete` (106), `cli-status` (89),
  `cli-issue-backlog` (66), `cli-roadmap` (47), `cli-install` (46), `cli-propose` (43),
  `cli-finalize` (37).
- Real CI evidence (run 31477848986, failed; run 31480520786, passed — via `gh run view`):
  - Failed-run summary: `Duration 368.94s (tests 1058.47s …)` → effective parallelism
    ≈ 1058/369 ≈ **2.9**, i.e. at least 3 concurrent workers, so the `ubuntu-latest` runner is
    the standard **4-core** public-repo runner, and vitest is running **4 fork workers**, each
    hosting an exec-heavy file. Peak process tree ≈ 4 forks × (npx → tsx → node CLI → git
    children) ≈ 16–20 node/git processes on 4 cores.
  - Failure signature matches the diagnosis exactly: `FAIL tests/cli-complete.test.ts`,
    `FAIL tests/cli-finalize.test.ts`, each with
    `Error: ENOENT: … /tmp/metta-cli-*/.metta/config.yaml` — the `install --git-init` setup
    child died and its non-zero result was swallowed.
  - A single `runCli`-driven install test takes ~1.47s under 4-way contention.
  - Passing-run Test step wall time: **~375s (~6.2 min)**.
- Same commit passes 2122/2122 locally (56-core machine — per-chain contention is ~28× lower).

## Vitest 3.2.6 option analysis (verified against docs for the pinned version)

| Option | Verified behavior in 3.2.6 | Project-level? |
|---|---|---|
| `maxWorkers` / `minWorkers` | `number \| string` (percentage allowed, e.g. `'50%'` of `os.availableParallelism()`); default when watch is off = all available parallelism. `poolOptions.forks.maxForks` has higher priority.[^1] | **No** — marked `NonProjectOption` (root-only)[^2] |
| `fileParallelism` | `boolean`, default `true`. Setting `false` "will override `maxWorkers` and `minWorkers` options to `1`" — full file serialization; per-file fork isolation (`poolOptions.forks.isolate: true` default) is unaffected.[^2] | **No** — root-only[^2] |
| `pool` | default `'forks'` (child processes).[^2] | **No** — root-only[^2] |
| `poolOptions.forks.maxForks` / `singleFork` | cap fork count / run all files in one child process.[^2] | **No** — root-only[^2] |
| `test.projects` (replaces deprecated `workspace`, 3.2+) | inline projects with `extends: true` + per-project `include` globs work,[^3] **but** all parallelism knobs above are `NonProjectOption`, so a "sequential project for `cli-*` files" cannot be expressed in a supported way on 3.2.x. Community reports confirm per-project `fileParallelism` silently does nothing in v3; the maintainer-suggested per-project `pool`/`poolOptions` workaround is undocumented behavior that already broke once between 1.5 → 3.0.[^4] | — |
| `sequence.groupOrder` (3.2+) | orders project *groups*; does not cap intra-group concurrency — not sufficient alone.[^2] | yes |
| Vitest 4 (future) | pool rework: `poolOptions` removed, `maxForks`/`maxThreads` flattened into top-level `maxWorkers`, per-project control becomes first-class.[^5] Not available on 3.2.6. | — |

Environment detection: GitHub Actions always sets `CI=true`, so `process.env.CI` in
`vitest.config.ts` is a reliable CI switch, and `CI=1 npm test` reproduces CI behavior locally.

[^1]: https://vitest.dev/config/maxworkers accessed 2026-08-11
[^2]: https://raw.githubusercontent.com/vitest-dev/vitest/v3.2.6/docs/config/index.md (`NonProjectOption` markers on `pool`, `poolOptions`, `fileParallelism`, `maxWorkers`, `minWorkers`; `fileParallelism` default/override text; `forks` default pool) accessed 2026-08-11
[^3]: https://v3.vitest.dev/guide/projects (unsupported-options list: "All configuration options that are not supported inside a project configuration are marked with a NonProjectOption sign") accessed 2026-08-11
[^4]: https://github.com/vitest-dev/vitest/discussions/7416 accessed 2026-08-11
[^5]: https://vitest.dev/guide/migration.html (v4 pool rework) accessed 2026-08-11

## Candidate configs compared

Baseline: CI Test step ≈ 375s wall, ≈ 1058s cumulative test time at ~4-way parallelism.

### A. `fileParallelism: !process.env.CI` (root config) — full serialization in CI
- One exec chain alive at a time (~4–6 processes peak vs ~16–20). **Deterministically**
  eliminates concurrent exec storms — the stated goal of this approach.
- Per-file fork isolation preserved (isolate default true), so no shared-state risk.
- Wall-clock: 1058s cumulative was measured *under contention*; uncontended per-exec cost is
  ~0.8–1.0s vs the observed ~1.47s, so serial ≈ 700–950s tests + ~26s collect/prepare →
  **Test step ≈ 12–16 min (from 6.2 min; +6–10 min)**.

### B. `maxWorkers: process.env.CI ? 2 : undefined` — halve CI workers
- Caps concurrent exec chains at 2 (~8–10 processes peak). Strong mitigation, not a guarantee:
  two 100-call files (`cli-complete` + `cli-status`) can still overlap.
- Wall-clock: ≈ 900–1000s cumulative at lower contention / 2 →
  **Test step ≈ 8–9 min (+2–3 min)**.
- `'50%'` percentage form is equivalent on a 4-core runner but less explicit.

### C. Per-project split (`projects` with a sequential `cli` project) — **rejected on 3.2.6**
- Would give the best wall-clock (heavy files serial, unit files parallel alongside,
  ≈ +3–5 min), but every knob that could serialize the project (`pool`, `poolOptions`,
  `fileParallelism`, `maxWorkers`) is documented root-only in 3.2.6[^2][^3]; the known
  workaround relies on undocumented behavior that has already regressed once across
  versions.[^4] Also brittle: the 33 exec files don't share a glob (`tests/cli-*.test.ts`
  covers only 20 files / 523 of 673 calls; `progress-ceremony-metrics`, `complexity-tracking`,
  `tokens-command`, etc. would need a hand-maintained list). Revisit after a vitest 4 upgrade.

### D. CI-side flag instead of config branch: `npm test -- --no-file-parallelism` in `ci.yml`
- Same runtime effect as A; keeps `vitest.config.ts` untouched.
- Downside: the constraint is invisible to anyone running `CI=1 npm test`, and `ci.yml` already
  carries CI-only accommodations (git identity, gc.auto) — but test-topology policy belongs
  with the test config, and the config branch is reproducible locally. Mechanism variant, not
  a distinct behavior.

## Wall-clock estimate summary

| Config | CI Test step (est.) | Delta | Concurrency guarantee |
|---|---|---|---|
| current (implicit 4 workers) | ~6.2 min | — | none (observed failure) |
| B: `maxWorkers: 2` in CI | ~8–9 min | +2–3 min | ≤2 exec chains |
| A: `fileParallelism: false` in CI | ~12–16 min | +6–10 min | ≤1 exec chain (deterministic) |
| C: sequential project (vitest 4) | ~9–11 min | +3–5 min | unsupported today |

## Recommended change

**Option A** — CI-only `fileParallelism: false` in `vitest.config.ts`. It is the only
supported 3.2.6 configuration that *guarantees* heavy exec files never run concurrently,
which is the point of this approach; B merely lowers the probability of the same flake and
would leave CI credibility dependent on load luck. The +6–10 min cost is bounded, visible,
and can be recovered later via the vitest 4 per-project split (C) or by cutting per-call exec
cost (see `research-process-cost.md`).

```ts
// vitest.config.ts
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

No `package.json` or `ci.yml` edits required (GitHub Actions sets `CI=true`).

If the ~12–16 min CI Test step is judged too expensive, the fallback is the same diff with
`maxWorkers: isCI ? 2 : undefined` instead of `fileParallelism` (+2–3 min, mitigation only) —
acceptable **only** in combination with the loud-setup-failure fix
(`research-loud-setup-helper.md`), which converts any residual flake from a misleading ENOENT
into an immediate, diagnosable setup failure.

## Risks

- **Wall-clock regression**: CI gate roughly doubles (~6 → ~12–16 min). PR feedback slows;
  `concurrency.cancel-in-progress` already limits queue pileup.
- **Estimate uncertainty**: serial timing is extrapolated from contended measurements; the
  true number could land anywhere in 11–18 min. Cheap to measure on the first CI run.
- **Cap alone is a mitigation for the root cause**: even fully serialized, a slow cold `tsx`
  compile or npx hiccup can still kill a setup child inside the 10s `runCli` timeout; the
  silent-swallow fix is still required for diagnosability. This approach removes the
  *load-induced* failure mode only.
- **Config drift**: nothing enforces that new exec-heavy tests stay under this umbrella —
  acceptable, since the cap is global in CI.
- **Vitest upgrade**: on vitest 4, `poolOptions` disappears (not used here) and per-project
  `maxWorkers` arrives — revisit for option C to recover ~5 min.

## Verdict

Adopt **Option A**: env-conditional `fileParallelism: !isCI` in `vitest.config.ts`. It is
fully supported on the pinned vitest 3.2.6, is a 3-line diff, deterministically prevents
concurrent CLI exec storms in CI, preserves local speed, and is reproducible with
`CI=1 npm test`. Pair it with the loud-setup-failure change; treat the vitest-4 per-project
split as a follow-up optimization if the CI wall-clock cost proves painful.
