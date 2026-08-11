# Tasks for fix-ci-test-flakiness-undeclared-tsx-dependency

## Batch 1 (no dependencies)

- [x] **Task 1.1: Declare tsx as a devDependency**
  - **Files**: `package.json`, `package-lock.json`
  - **Action**: Run `npm install --save-dev tsx@^4.23.12` at the repo root so
    `devDependencies` gains `"tsx": "^4.23.12"` and the lockfile is
    regenerated. Do not alter any other dependency entry.
  - **Verify**: `npm ls tsx` resolves locally; `node_modules/.bin/tsx --version`
    prints a 4.23.x version; `git diff package.json` shows only the one added
    devDependencies line.
  - **Done**: `npm ci` on a cold environment installs tsx; `npx tsx` resolves
    the local binary with no registry fetch.

## Batch 2 (depends on Batch 1)

- [x] **Task 2.1: Reconcile runCli helper comment and add timeout kill marker**
  - **Depends on**: Task 1.1
  - **Files**: `tests/helpers/cli.ts`
  - **Action**: (a) Replace the header comment above `CLI_PATH` (the
    "do NOT switch to dist" note) with wording stating the helper execs
    `npx tsx src/cli/index.ts`, that tsx is a declared devDependency installed
    by `npm ci`, and that tsx must not be removed from `package.json` while
    this helper execs it. (b) In `runCli`'s catch block, when the error object
    has `killed === true` or a non-null `signal`, append a line to the returned
    `stderr`: `[runCli] subprocess killed (signal=<signal>, timeout=<ms>ms)`.
    (c) Give `runCli` an optional third parameter `timeoutMs = 10000` passed to
    the exec `timeout` option, so tests can exercise the kill path quickly.
    Existing call sites are unaffected; the `{ stdout, stderr, code }` return
    shape is unchanged.
  - **Verify**: `npx tsc --noEmit` passes; `npx vitest run tests/cli-status.test.ts`
    passes unchanged.
  - **Done**: No stale "do NOT switch to dist" guidance survives; a
    timeout-killed subprocess yields a stderr marker identifying the kill.

- [x] **Task 2.2: Reconcile constitution and CLAUDE.md dev-loop wording**
  - **Depends on**: Task 1.1
  - **Files**: `spec/project.md`, `CLAUDE.md`
  - **Action**: In `spec/project.md`, replace the Toolchain parenthetical
    "(tsx is not currently part of the dev loop)" with "(tsx is a declared
    devDependency used by the CLI test harness)". Update the mirrored sentence
    in the `CLAUDE.md` Stack paragraph identically. Touch nothing else in
    either file.
  - **Verify**: `grep -rn "not currently part of the dev loop" spec/project.md CLAUDE.md`
    returns nothing; `grep -n "declared devDependency" spec/project.md CLAUDE.md`
    hits both files.
  - **Done**: No surviving statement contradicts the declared-tsx mechanism.

## Batch 3 (depends on Batch 2)

- [x] **Task 3.1: Add regression guard test**
  - **Depends on**: Task 1.1, Task 2.1
  - **Files**: `tests/cli-runtime-declared.test.ts`
  - **Action**: New Vitest file with two tests: (1) read `package.json` (via
    `import.meta.dirname`-relative path) and assert `devDependencies.tsx` is
    declared; (2) assert timeout diagnosability — call
    `runCli(['--help'], tmpDir, 1)` (1ms timeout guarantees the kill path
    without waiting) and assert the returned stderr contains
    `[runCli] subprocess killed`. Use temp-dir isolation norms; no network.
  - **Verify**: `npx vitest run tests/cli-runtime-declared.test.ts` passes;
    `npx tsc --noEmit` passes.
  - **Done**: Removing tsx from devDependencies or regressing the kill marker
    fails the suite.
