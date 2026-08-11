# ci-test-infrastructure

<!-- new-capability -->

## ADDED: Requirement: Deterministic CLI Test Execution Path

The `runCli` test helper (`tests/helpers/cli.ts`) MUST execute the CLI through a path in which every binary and runtime it invokes is installed by `npm ci` from declared entries in `package.json`. No test subprocess spawned via `runCli` MAY resolve a binary or package over the network at test time (e.g., a per-invocation `npx` registry fetch of an undeclared package). The specific mechanism (executing built `dist/` output, declaring the runner as a devDependency, or another deterministic runner) is a design decision, but whichever mechanism is chosen MUST satisfy this requirement. All existing tests that call `runCli` MUST inherit the deterministic path with no per-test edits.

_Trace: intent Problem/Proposal item 1; US-1._

### Scenario: Cold runner passes with only declared dependencies
- GIVEN a cold runner with no warm `npx`/npm cache and no registry access after `npm ci` completes
- WHEN `npm test` runs the full suite, including `tests/cli-status.test.ts` and `tests/cli-complete.test.ts`
- THEN every CLI subprocess spawned by `runCli` starts using only binaries installed by `npm ci`, and the suite passes with no per-invocation registry fetch

### Scenario: Test runtime is declared, not implicit
- GIVEN the mechanism chosen for `runCli`
- WHEN the binaries and runtimes it invokes are compared against `package.json` (dependencies, devDependencies, and scripts) plus the Node.js runtime itself
- THEN each invoked binary is traceable to a declared entry installed by `npm ci` (or is Node itself), with no reliance on globally installed or network-resolved tooling

## ADDED: Requirement: CI Ordering Consistent With Execution Path

The CI workflow (`.github/workflows/ci.yml`) MUST order its steps so that every artifact the chosen test execution path requires exists before the test step runs. If the mechanism executes built output, the build MUST complete before tests execute (via workflow step order or an npm script the test step itself triggers); if the mechanism runs from source, no build-before-test ordering is required. CI MUST exercise the same CLI execution path that a local `npm test` run exercises. The audit job MUST remain unchanged.

_Trace: intent Proposal item 2, Impact; US-1 acceptance criterion 3._

### Scenario: Required artifacts exist before tests run in CI
- GIVEN the chosen mechanism requires build output to run CLI tests
- WHEN the CI gates job executes
- THEN the required artifacts are produced before any CLI integration test spawns the CLI, and the test step passes on a cold runner

### Scenario: CI and local runs exercise the same path
- GIVEN the CI workflow definition and the npm `test` script after the change
- WHEN CI runs `npm test` and a developer runs `npm test` locally
- THEN both invocations execute the CLI through the same mechanism defined by `runCli`, with no CI-only or local-only execution path

## ADDED: Requirement: Fresh-Clone Test Runs Without Manual Pre-Steps

From a fresh clone, `npm ci` followed by `npm test` MUST pass with no manual pre-step beyond what the npm scripts themselves encode. If the chosen mechanism executes built output, the test flow MUST guarantee via scripting — not developer discipline — that tests exercise current source, so a stale build cannot mask source changes.

_Trace: intent Proposal item 3, Impact (Risk); US-2._

### Scenario: Fresh clone passes with scripts alone
- GIVEN a fresh clone with no prior build artifacts and no globally installed tooling beyond Node.js >= 22 and npm
- WHEN the contributor runs `npm ci` followed by `npm test`
- THEN the full suite passes without any undocumented manual pre-step

### Scenario: Stale build cannot mask source changes
- GIVEN the chosen mechanism executes built output and a contributor has just edited `src/cli/index.ts`
- WHEN the contributor runs `npm test` without manually rebuilding
- THEN the CLI tests exercise the edited source behavior, because the scripted test flow refreshes the executed output

## ADDED: Requirement: Actionable Failures and Consistent Runtime Policy

When a CLI subprocess spawned by `runCli` exceeds its timeout, the resulting test failure MUST be attributable to actual CLI work, not dependency resolution, and SHOULD surface an actionable signal (e.g., a timeout/exit-code indication) rather than only downstream symptoms such as `JSON.parse` failures on empty stdout or ENOENT for files the killed subprocess never wrote. After the change, the constitution's dev-loop statement about tsx, the in-code guidance in `tests/helpers/cli.ts` (including the "do NOT switch to dist" comment), and the actual execution mechanism MUST agree: any statement contradicted by the chosen mechanism MUST be revised, and no stale guidance MAY survive.

_Trace: intent Proposal item 4, Success criteria; US-3._

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
