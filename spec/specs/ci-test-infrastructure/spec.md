# ci-test-infrastructure

## Requirement: Deterministic CLI Test Execution Path

The `runCli` test helper (`tests/helpers/cli.ts`) MUST execute the CLI through a path in which every binary and runtime it invokes is installed by `npm ci` from declared entries in `package.json`. No test subprocess spawned via `runCli` MAY resolve a binary or package over the network at test time (e.g., a per-invocation `npx` registry fetch of an undeclared package). The specific mechanism (executing built `dist/` output, declaring the runner as a devDependency, or another deterministic runner) is a design decision, but whichever mechanism is chosen MUST satisfy this requirement. All existing tests that call `runCli` MUST inherit the deterministic path with no per-test edits.
Trace: intent Problem/Proposal item 1; US-1.

### Scenario: Cold runner passes with only declared dependencies
- GIVEN a cold runner with no warm `npx`/npm cache and no registry access after `npm ci` completes
- WHEN `npm test` runs the full suite, including `tests/cli-status.test.ts` and `tests/cli-complete.test.ts`
- THEN every CLI subprocess spawned by `runCli` starts using only binaries installed by `npm ci`, and the suite passes with no per-invocation registry fetch

### Scenario: Test runtime is declared, not implicit
- GIVEN the mechanism chosen for `runCli`
- WHEN the binaries and runtimes it invokes are compared against `package.json` (dependencies, devDependencies, and scripts) plus the Node.js runtime itself
- THEN each invoked binary is traceable to a declared entry installed by `npm ci` (or is Node itself), with no reliance on globally installed or network-resolved tooling


## Requirement: CI Ordering Consistent With Execution Path

The CI workflow (`.github/workflows/ci.yml`) MUST order its steps so that every artifact the chosen test execution path requires exists before the test step runs. If the mechanism executes built output, the build MUST complete before tests execute (via workflow step order or an npm script the test step itself triggers); if the mechanism runs from source, no build-before-test ordering is required. CI MUST exercise the same CLI execution path that a local `npm test` run exercises. The audit job MUST remain unchanged.
Trace: intent Proposal item 2, Impact; US-1 acceptance criterion 3.

### Scenario: Required artifacts exist before tests run in CI
- GIVEN the chosen mechanism requires build output to run CLI tests
- WHEN the CI gates job executes
- THEN the required artifacts are produced before any CLI integration test spawns the CLI, and the test step passes on a cold runner

### Scenario: CI and local runs exercise the same path
- GIVEN the CI workflow definition and the npm `test` script after the change
- WHEN CI runs `npm test` and a developer runs `npm test` locally
- THEN both invocations execute the CLI through the same mechanism defined by `runCli`, with no CI-only or local-only execution path


## Requirement: Fresh-Clone Test Runs Without Manual Pre-Steps

From a fresh clone, `npm ci` followed by `npm test` MUST pass with no manual pre-step beyond what the npm scripts themselves encode. If the chosen mechanism executes built output, the test flow MUST guarantee via scripting — not developer discipline — that tests exercise current source, so a stale build cannot mask source changes.
Trace: intent Proposal item 3, Impact (Risk); US-2.

### Scenario: Fresh clone passes with scripts alone
- GIVEN a fresh clone with no prior build artifacts and no globally installed tooling beyond Node.js >= 22 and npm
- WHEN the contributor runs `npm ci` followed by `npm test`
- THEN the full suite passes without any undocumented manual pre-step

### Scenario: Stale build cannot mask source changes
- GIVEN the chosen mechanism executes built output and a contributor has just edited `src/cli/index.ts`
- WHEN the contributor runs `npm test` without manually rebuilding
- THEN the CLI tests exercise the edited source behavior, because the scripted test flow refreshes the executed output


## Requirement: Actionable Failures and Consistent Runtime Policy

When a CLI subprocess spawned by `runCli` exceeds its timeout, the resulting test failure MUST be attributable to actual CLI work, not dependency resolution, and SHOULD surface an actionable signal (e.g., a timeout/exit-code indication) rather than only downstream symptoms such as `JSON.parse` failures on empty stdout or ENOENT for files the killed subprocess never wrote. After the change, the constitution's dev-loop statement about tsx, the in-code guidance in `tests/helpers/cli.ts` (including the "do NOT switch to dist" comment), and the actual execution mechanism MUST agree: any statement contradicted by the chosen mechanism MUST be revised, and no stale guidance MAY survive.
Trace: intent Proposal item 4, Success criteria; US-3.

### Scenario: Timeout budget covers only CLI work
- GIVEN the deterministic execution path is in place
- WHEN a CLI subprocess spawned by `runCli` runs against its timeout
- THEN the elapsed time consists only of CLI startup and command execution, with zero time spent resolving or fetching dependencies

### Scenario: Timeout failure is diagnosable
- GIVEN a CLI subprocess that genuinely exceeds the `runCli` timeout
- WHEN the calling test fails
- THEN the failure output lets a maintainer identify the subprocess termination (timeout/kill) as the cause, rather than presenting only an unexplained empty-stdout parse error

### Scenario: No contradictory guidance survives
- GIVEN the change has landed with its chosen mechanism
- WHEN a reader compares `tests/helpers/cli.ts` comments, `.github/workflows/ci.yml`, `package.json`, and the constitution's dev-loop wording against the implemented behavior
- THEN every surviving statement is consistent with the mechanism, and the tsx dev-loop claim has been either reaffirmed (tsx removed from the test path) or revised (tsx declared)


## Requirement: Fail-Fast Setup Helper With Full Diagnostics

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


## Requirement: Install Fixture Verifies Resulting State

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


## Requirement: runCli Return-Value Contract Preserved

The existing `runCli` helper MUST keep its current contract — resolving to `{ stdout, stderr, code }` for both successful and failed invocations, including its timeout-kill stderr marker — so that assertion-phase tests that deliberately inspect non-zero exits retain their semantics without edits.
Trace: intent Proposal item 1, Impact; US-1 acceptance criterion 3.

### Scenario: Deliberate failure assertion still receives a return value
- GIVEN an existing test that calls `runCli` with arguments expected to fail and asserts `code !== 0` and on `stderr` content
- WHEN the CLI child process exits non-zero
- THEN `runCli` resolves (does not throw) with the populated `{ stdout, stderr, code }` result and the test's assertions behave exactly as before the change


## Requirement: Setup-Phase Call Sites Fail Fast

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


## Requirement: CI Vitest Concurrency Cap

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


## Requirement: Local Test Runs Retain Current Parallelism

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
