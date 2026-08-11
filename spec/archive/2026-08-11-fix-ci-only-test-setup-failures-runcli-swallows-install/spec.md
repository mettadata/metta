# ci-test-infrastructure

## ADDED: Requirement: Fail-Fast Setup Helper With Full Diagnostics

`tests/helpers/cli.ts` MUST export a fail-fast setup helper (e.g. `runCliOrThrow(args, cwd, timeoutMs?)`) that runs the CLI through the same deterministic execution path as `runCli` and, when the child process exits non-zero or is killed by a signal, THROWS an error whose message includes the command arguments, exit code, signal (when present), and the full captured stderr and stdout. The helper MUST NOT convert failures into a return value. On success the helper MAY return the captured `{ stdout, stderr }` for callers that need it.
Trace: intent Problem defect 1, Proposal item 1; US-1.

### Scenario: Non-zero exit throws with full diagnostics
- GIVEN a CLI invocation via the fail-fast helper whose child process exits with a non-zero code
- WHEN the helper's promise settles
- THEN it rejects with an error whose message names the command arguments and includes the exit code and the full captured stderr and stdout

### Scenario: Signal kill throws with signal named
- GIVEN a CLI invocation via the fail-fast helper whose child process is killed by a signal (e.g. the exec timeout fires SIGTERM)
- WHEN the helper's promise settles
- THEN it rejects with an error that identifies the terminating signal and the timeout budget, plus the captured stderr and stdout, instead of returning silently

### Scenario: Successful invocation does not throw
- GIVEN a CLI invocation via the fail-fast helper that exits with code 0
- WHEN the helper's promise settles
- THEN it resolves without throwing and the calling test proceeds identically to the pre-change happy path


## ADDED: Requirement: Install Fixture Verifies Resulting State

`tests/helpers/cli.ts` MUST provide an install-specific setup helper (e.g. `installFixture(dir)`) that runs `metta install` (with the flags the fixture files need, e.g. `--git-init`) via the fail-fast helper and, after a zero-exit install, MUST additionally verify that `.metta/config.yaml` exists in the target directory. If the file is absent, the helper MUST throw an error carrying the same captured diagnostics (command, exit code, signal, stderr, stdout) even though the process exited zero.
Trace: intent Proposal item 1; US-1 acceptance criterion 2.

### Scenario: Zero exit but missing config throws
- GIVEN an install invocation that exits with code 0 but leaves no `.metta/config.yaml` in the fixture directory
- WHEN the install fixture helper's post-check runs
- THEN it throws an error naming the missing file and including the install command's captured stdout and stderr, so the failure is attributed to install rather than a later ENOENT

### Scenario: Successful install passes the post-check
- GIVEN an install invocation that exits 0 and writes `.metta/config.yaml`
- WHEN the install fixture helper completes
- THEN it resolves without throwing and the fixture directory is usable by subsequent CLI calls


## ADDED: Requirement: runCli Return-Value Contract Preserved

The existing `runCli` helper MUST keep its current contract — resolving to `{ stdout, stderr, code }` for both successful and failed invocations, including its timeout-kill stderr marker — so that assertion-phase tests that deliberately inspect non-zero exits retain their semantics without edits.
Trace: intent Proposal item 1, Impact; US-1 acceptance criterion 3.

### Scenario: Deliberate failure assertion still receives a return value
- GIVEN an existing test that calls `runCli` with arguments expected to fail and asserts `code !== 0` and on `stderr` content
- WHEN the CLI child process exits non-zero
- THEN `runCli` resolves (does not throw) with the populated `{ stdout, stderr, code }` result and the test's assertions behave exactly as before the change


## ADDED: Requirement: Setup-Phase Call Sites Fail Fast

Setup-phase CLI invocations in the CLI-fixture test files whose results are otherwise discarded MUST use the fail-fast helper (or the install fixture helper) instead of the silent `runCli`. At minimum, every setup-phase `install` call site in `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts` MUST be migrated; the same pattern SHOULD be applied to the remaining CLI-fixture files that share it (e.g. `cli-propose`, `cli-status`, `cli-install`). Assertion-phase `runCli` calls whose return values are inspected MUST remain unchanged. The migration MUST NOT change happy-path test behavior or pass/fail results.
Trace: intent Proposal item 2; US-2.

### Scenario: No discarded setup result in the minimum files
- GIVEN the migrated `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`
- WHEN their setup-phase install invocations are inspected
- THEN none calls `runCli` with a discarded result; each uses the throwing helper so a dead install process fails the test at the setup line

### Scenario: Setup failure surfaces at the failing command
- GIVEN a migrated fixture file in which the setup-phase install child process dies before writing `.metta/`
- WHEN the test runs
- THEN the test fails at the setup invocation with the install command's exit code, signal, and captured stderr — not with a downstream ENOENT on `.metta/config.yaml`

### Scenario: Happy-path suite behavior is unchanged
- GIVEN the fully migrated suite with all setup commands succeeding
- WHEN `npm test` runs the full suite
- THEN every test passes with the same pass/fail results as before the migration


## ADDED: Requirement: CI Vitest Concurrency Cap

The vitest configuration MUST constrain test-file parallelism when running in CI so that the heavy CLI-fixture files (e.g. `tests/cli-finalize.test.ts`, `tests/cli-complete.test.ts`, and peers that spawn many CLI subprocess chains) are not scheduled onto concurrent workers on a resource-constrained 2-core runner. The mechanism (e.g. env-driven `maxWorkers`/`fileParallelism` in `vitest.config.ts`, optionally wired through `.github/workflows/ci.yml`) is a design decision, but whichever mechanism is chosen MUST prevent concurrent execution of the heavy fixture files in the CI gates job. Changes MUST be confined to test/CI infrastructure; no `src/` production code MAY change.
Trace: intent Problem defect 2, Proposal item 3, Impact; US-3.

### Scenario: Heavy fixture files do not run concurrently in CI
- GIVEN the CI gates job on a 2-core GitHub runner with the cap active
- WHEN vitest schedules the test files
- THEN the effective worker/file-parallelism configuration prevents two heavy CLI-fixture files from executing on concurrent workers at the same time

### Scenario: Gates job passes on a constrained runner
- GIVEN this change's branch with the cap and the setup-helper migration in place
- WHEN the CI gates job runs on a standard 2-core GitHub runner
- THEN the suite passes, including `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`, with no setup-phase child process dying from spawn-resource exhaustion

### Scenario: Residual CI failure self-diagnoses
- GIVEN the cap is active and a setup-phase CLI invocation nevertheless fails in CI
- WHEN the run goes red
- THEN the test output names the failing command with its exit code, signal, and captured stderr per the fail-fast helper, rather than presenting only a downstream ENOENT


## ADDED: Requirement: Local Test Runs Retain Current Parallelism

The CI concurrency cap MUST NOT meaningfully degrade local `npm test` wall-clock time: the cap MUST either be scoped so it does not apply outside CI (e.g. keyed on the `CI` environment variable) or be demonstrably negligible for local runs. A local `npm test` after the change MUST pass the full suite with unchanged happy-path behavior.
Trace: intent Proposal item 3, Impact; US-4.

### Scenario: Local run is not constrained by the CI cap
- GIVEN a local development machine without the CI environment condition (or with the negligible unconditional cap)
- WHEN the developer runs `npm test`
- THEN vitest uses its normal local parallelism (or an equivalent-speed configuration) and the full suite passes in roughly its current wall-clock time

### Scenario: Full local suite passes after the change
- GIVEN the migrated helpers, call sites, and concurrency configuration
- WHEN the developer runs `npm test` locally
- THEN all tests (2122+) pass with no behavioral change on the happy path
