# Summary: fix-ci-test-flakiness-undeclared-tsx-dependency

## What changed

Fixes the logged issue `ci-test-flakiness-from-undeclared-tsx-dependency-in-the-cli`:
CI runs flaked because `runCli` exec'd `npx tsx` while tsx was undeclared, so
cold runners fetched it from the npm registry inside the 10s exec timeout.

- `package.json` / `package-lock.json` — declared `tsx@^4.23.12` as a
  devDependency (`npm install --save-dev tsx@^4.23.12`). `npm ci` now installs
  tsx; `npx` resolves the local binary with zero registry traffic at test
  time. Lockfile already satisfied tsx's `esbuild ~0.28.0` via the existing
  `esbuild@0.28.1` entries. (Task 1.1, commit d28708446)
- `tests/helpers/cli.ts` — retired the stale "do NOT switch to dist" comment
  in favor of guidance matching the declared-tsx mechanism; `runCli` gained an
  optional `timeoutMs = 10000` parameter and now appends
  `[runCli] subprocess killed (signal=..., timeout=...ms)` to stderr when the
  subprocess is killed, making timeout deaths diagnosable instead of surfacing
  as empty-stdout JSON parse errors or ENOENT. Return shape unchanged; all
  existing call sites unaffected. (Task 2.1, commit 182739d41)
- `spec/project.md` + `CLAUDE.md` — replaced "(tsx is not currently part of
  the dev loop)" with "(tsx is a declared devDependency used by the CLI test
  harness)" in both files. (Task 2.2, commit aef8d8100)
- `tests/cli-runtime-declared.test.ts` (new) — regression guard: asserts tsx
  is declared in devDependencies and that a timeout-killed `runCli` subprocess
  carries the stderr kill marker. (Task 3.1, commit a2c457e6a)

No CI workflow changes: the mechanism runs from source, so the existing
`npm ci -> npm test` order already provides every artifact tests need, and CI
and local runs exercise the identical path.

## Verification evidence

- `npx tsc --noEmit` — clean after each code task
- `npx vitest run tests/cli-status.test.ts` — 36/36 passed post-helper change
- `npx vitest run tests/cli-runtime-declared.test.ts` — 2/2 passed
- `npm ls tsx` — resolves tsx@4.23.12 locally; `node_modules/.bin/tsx --version` -> v4.23.12
- grep confirms no "not currently part of the dev loop" text survives
