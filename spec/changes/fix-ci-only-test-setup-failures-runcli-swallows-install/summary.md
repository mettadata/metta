# Implementation Summary: fix-ci-only-test-setup-failures-runcli-swallows-install

## What was built

Two tracks, per design.md:

**Track 1 — Fail-fast setup helpers (`tests/helpers/cli.ts`, commit e419026da)**
- Internal `execCliRaw(args, cwd, timeoutMs)` is now the sole owner of the exec try/catch; it never throws and preserves `code`/`signal`/`killed` as first-class data (signal no longer coerced into `code`).
- `runCli` reimplemented as a thin wrapper with a byte-identical contract: resolves `{ stdout, stderr, code }`, legacy `?? 1` coercion at its own layer, exact timeout-kill stderr marker preserved.
- New exports: `CliSetupError` (args, cwd, code: number|null, signal, stdout, stderr; multi-line message with command, cwd, exit line, and 8 KiB stderr/stdout tails), `runCliOrThrow`, `verifyInstallWrote` (post-check that `.metta/config.yaml` exists after a zero-exit install), and `installFixture(dir, {gitInit?})`.
- Helper unit tests: `tests/helpers/cli.test.ts` (commit 5790d7af2) — 7 tests covering non-zero throw, signal-kill throw, success resolve, missing-config throw, installFixture happy path, and both `runCli` contract regressions.

**Track 2 — CI-only vitest serialization (`vitest.config.ts`, commit 1967ab2ff)**
- `fileParallelism: !isCI` with `isCI` derived from `process.env.CI`; local runs keep full parallelism; `CI=1 npm test` reproduces CI behavior.

**Call-site migration (147 sites, 12 files)**
- MUST tier (commit 65e94076e): `cli-finalize` 9, `cli-complete` 36.
- SHOULD tier group A (commit 21c4c7070): `cli-status` 29, `cli-issue-backlog` 24, `cli-propose` 17.
- SHOULD tier group B (commit 9992e073c): `progress-ceremony-metrics` 12, `complexity-tracking` 8, `cli-propose-worktree` 6 (worktree mode preserved — no `disableWorktrees` added), `complete-marks-tasks` 3, `cli-propose-stop-after` 1, `cli-roadmap` 1, `cli-worktree-change-root` 1.
- Excluded by design: `tests/cli-install.test.ts` wholesale (install behavior is what it tests) and all 14 result-captured install sites.

## Verification results (Task 3.1)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm test` (local, parallel) | 120 files, 2123/2123 passed, 305s |
| `CI=1` full suite (serialized, sharded 3x + src co-located) | 120 files, 2123/2123 passed |
| Bare-await install grep outside `cli-install.test.ts` | only 5 result-captured assignment sites remain (as intended) |
| `git diff main --stat -- src/` | empty — no production code touched |

## Notes / risks surfaced

- CI-mode serialized wall time measured ~30 min total on the (fast) local machine across sharded runs — above the design's 12-16 min CI estimate; actual GitHub runner timing should be checked on the first CI run. Fallback pre-approved in design: `maxWorkers: isCI ? 2 : undefined`.
- `CliSetupError.code` is typed `number | null` (design-consistent; task text said `number`) so signal kills can render `code=null` truthfully.
- Follow-up candidate recorded in research: drop the `npx tsx` 3-process chain via `node --import <resolved tsx loader>` (~2x faster per call) to claw back CI wall-clock.
