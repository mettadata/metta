# Research: Run CLI tests against built dist/ output

## Approach

Change the CLI test harness to exec the compiled CLI (`node dist/cli/index.js`) instead of `npx tsx src/cli/index.ts`, reorder CI so the build precedes tests, and add a `pretest` script so `npm test` always rebuilds first. This removes tsx (and any network fetch of it) from the test path entirely.

## How it works

- `tests/helpers/cli.ts` `runCli` currently spawns `npx tsx <REPO_ROOT>/src/cli/index.ts` with a 10s timeout. tsx is not in `package.json` (`devDependencies`: only `@types/node`, `typescript`, `vitest`), so on a cold runner `npx` resolves tsx from the registry per invocation; a slow fetch eats the 10s timeout and kills the CLI mid-run — the flake.
- Under this approach the helper spawns `process.execPath` (the current node binary) with `join(REPO_ROOT, 'dist', 'cli', 'index.js')`. No `npx`, no tsx, no network at test time — the root cause is eliminated, not just made faster.
- Freshness is guaranteed by npm's built-in `pre` hook: a `"pretest": "npm run build"` script runs automatically before `npm test` (standard npm lifecycle behavior). CI's Test step and metta's tests gate (`src/templates/gates/tests.yaml`, `command: npm test`) both go through `npm test`, so both are covered without further changes.
- CI step order in `.github/workflows/ci.yml` moves Build before Test (currently Test → Typecheck → Build). With `pretest` in place the explicit early Build step is technically redundant, but keeping it ordered first makes CI fail fast on compile errors and documents the dependency.

### History of the "do NOT switch to dist" warning

`git log -S` traces the comment to commit `160fd10a0` (2026-06-22, "test(cli): split cli.test.ts into per-command files for gate parallelism"). The helper was extracted during a pure refactor whose acceptance criterion was *verbatim behavior parity* with the old monolithic `tests/cli.test.ts` (parity verified: 140==140 tests, 499==499 expects). The comment reads "Behavior is identical — do NOT switch to dist" — i.e. it was a **refactor-scope invariant** ("don't change behavior while splitting files"), not an architectural constraint against dist. There is no recorded technical reason dist cannot work. The comment should be replaced with the new rationale, not silently deleted.

### Measured costs (in this worktree, warm node_modules)

| Operation | Time |
|---|---|
| `npm run build` (tsc + copy-templates, non-incremental) | ~6.5s |
| `node dist/cli/index.js --help` | ~0.48s |
| `npx tsx src/cli/index.ts --help` (tsx already in npx cache) | ~2.38s |

Each CLI spawn gets ~1.9s faster even in the *warm* case. The original test-split issue documented cold tsx spawns at 2–9s each across 140 tests; the current `tests/cli-*.test.ts` files contain ~356 `it()` blocks, most spawning a subprocess. The one-time 6.5s build is repaid within the first handful of tests — expect a large net suite speedup on top of the flake fix. Note `tsconfig.json` has no `"incremental": true`, so every `pretest` pays the full ~6.5s; adding `incremental` is an optional follow-up.

### Behavior parity audit

- **Template resolution**: all runtime template lookups are `import.meta.url`-relative, not cwd-relative: `src/delivery/command-installer.ts` resolves `../templates` (→ `dist/templates` when run from dist), `src/constitution/checker.ts` resolves `../templates/artifacts/...`. `npm run copy-templates` copies **all nine** subdirectories present under `src/templates/` (workflows, gates, gate-scaffolds, artifacts, skills, agents, docs, hooks, statusline — verified against `ls src/templates`), so nothing is missing from dist.
- **package.json resolution**: `src/cli/helpers.ts` resolves `new URL('../../package.json', import.meta.url)` — `src/cli/` and `dist/cli/` sit at the same depth, so both land on the repo-root `package.json`. Parity holds.
- **This is the shipped artifact**: `bin.metta` points at `./dist/cli/index.js`. Testing dist means tests exercise exactly what `npm link`/publish delivers — today the published entry point is never executed by any test.
- **Residual risk**: error stack traces will show `dist/**/*.js` paths instead of `src/**/*.ts`. A grep found no test asserting on source-file paths in CLI output, but full-suite green against dist is the required verification.

## Required changes (file-by-file)

1. **`tests/helpers/cli.ts`** — `CLI_PATH` → `join(REPO_ROOT, 'dist', 'cli', 'index.js')`; `execAsync('npx', ['tsx', CLI_PATH, ...args], ...)` → `execAsync(process.execPath, [CLI_PATH, ...args], ...)`; replace the "do NOT switch to dist" comment with the new rationale (pretest guarantees freshness; dist is the shipped artifact). 32 test files import this helper and need no edits.
2. **18 additional test files with duplicated local `execAsync('npx', ['tsx', CLI_PATH, ...])` harnesses** — `cli-check-constitution-paths`, `cli-issue-backlog`, `cli-metta-guard-bash-integration`, `cli-propose-stop-after`, `complete-marks-tasks`, `complete-stamps-timings`, `complexity-tracking`, `config-set-edit`, `context-stats`, `instructions-agent-registry`, `instructions-emission-auto-commit`, `instructions-model-emission`, `instructions-payload-paths`, `instructions-stamps-timings`, `iteration-command`, `model-escalation-command`, `status-new-lines`, `tokens-command` (`.test.ts` each). Minimal fix: same two-line substitution in each. Better fix (larger scope): delete the duplicates and import the shared helper.
3. **`package.json`** — add `"pretest": "npm run build"`. Optionally add `"incremental": true` to `tsconfig.json` to cut rebuild cost.
4. **`.github/workflows/ci.yml`** — reorder `gates` job steps to Build → Test → Typecheck (or Build → Typecheck → Test). The pretest hook makes Test self-sufficient, but explicit ordering fails fast.

## Pros

- **Eliminates the root cause outright**: no tsx, no `npx`, no registry access during tests. Deterministic on cold CI runners; the 10s timeout becomes generous instead of marginal.
- **Constitution-aligned**: `spec/project.md` line 17 states "tsx is not currently part of the dev loop" — this approach keeps that true, whereas declaring tsx as a devDependency would amend it. A build gate (`npm run build`) already exists in the gate set, so "build before test" is consistent with the existing lifecycle.
- **Large speedup**: ~1.9s saved per subprocess spawn across ~356 CLI tests vs a one-time ~6.5s build; the prior suite-duration crisis (the 160fd10a0 split) is further relieved.
- **Tests the shipped artifact**: closes the gap where `dist/cli/index.js` (the `bin` entry) was never executed by any test; template copy-step regressions in `copy-templates` become test-visible.
- **Stale-dist guard is structural**: npm's `pre` hook fires on every `npm test`, covering local dev, CI, and the metta tests gate identically with one line.

## Cons / Risks

- **Change surface is 19 files, not 1**: the 18 duplicated harnesses must all be converted, or consolidated onto the shared helper (a worthwhile but larger refactor). Missing one leaves a flaky straggler.
- **Stale-dist gap outside `npm test`**: `pretest` does not fire for `npm run test:watch` or direct `npx vitest run tests/foo.test.ts` (the form used in task Verify lines). A dev editing `src/` and re-running a single file sees stale behavior. Mitigations: a vitest `globalSetup` that rebuilds (covers every vitest entry point, but adds ~6.5s to unit-only runs), or accepting the gap with a helper comment. Not fully mitigated by `pretest` alone.
- **~6.5s fixed cost per `npm test`**, doubled in CI if the explicit Build step is kept (negligible at ~13s total; `tsc --incremental` reduces it).
- **Stack-trace path drift** (`dist/*.js` vs `src/*.ts`) could break an assertion; no such assertion found by grep, but full-suite verification against dist is mandatory before merge.
- Contradicts the in-code "do NOT switch to dist" comment — mitigated by the history finding above showing it was a refactor-parity note, not a design decision; the comment must be rewritten, and the summary of change `160fd10a0`'s archive entry is unaffected.

## Verdict

**8/10** — Removes the flake's root cause entirely (no network in the test path), is the only option consistent with the constitution's "tsx is not part of the dev loop", makes tests exercise the shipped artifact, and nets a major suite speedup; docked two points for the 19-file change surface (duplicated harnesses) and the residual stale-dist window for direct single-file vitest invocations.
