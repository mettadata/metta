# UAT: fix-ci-test-flakiness-undeclared-tsx-dependency

- **Change**: fix-ci-test-flakiness-undeclared-tsx-dependency
- **Generated**: 2026-08-11
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Deterministic CI signal on cold runners

*Independent test:* On a cold runner (no warm npx cache, no registry access beyond `npm ci`), the full test suite passes and every binary/runtime invoked by `runCli` is verifiably installed by `npm ci`.

#### Step 1.1
- **Setup**: a cold CI runner that has run only `npm ci`
- **Do**: the CI workflow executes the test step (Run: `npm ci`)
- **Observe**: all CLI integration tests in `tests/cli-status.test.ts` and `tests/cli-complete.test.ts` pass without any per-invocation registry fetch
- [ ] Pass

#### Step 1.2
- **Setup**: the chosen execution mechanism for `runCli`
- **Do**: a CLI integration test spawns the CLI (Run: `npm ci`)
- **Observe**: every binary and runtime it invokes is present from `npm ci` alone, and the 10s timeout is spent only on actual CLI work
- [ ] Pass

#### Step 1.3
- **Setup**: the chosen mechanism requires build output (if `dist/`-based)
- **Do**: the CI workflow runs
- **Observe**: the job order guarantees the required artifacts exist before tests execute
- [ ] Pass

### US-2: Fresh-clone test runs work with no manual pre-steps

*Independent test:* From a fresh clone, `npm ci && npm test` passes with no manual pre-step beyond what the npm scripts themselves encode, and local test runs exercise current source (a stale `dist/` cannot mask source changes).

#### Step 2.1
- **Setup**: a fresh clone with no prior build artifacts
- **Do**: the contributor runs `npm ci` followed by `npm test` (Run: `npm ci`, `npm test`)
- **Observe**: the suite passes without any undocumented manual pre-step
- [ ] Pass

#### Step 2.2
- **Setup**: the mechanism executes built output
- **Do**: a contributor edits `src/cli/index.ts` and runs `npm test` (Run: `npm test`)
- **Observe**: the tests exercise the edited behavior, not a stale build, via a scripted rebuild rather than developer discipline
- [ ] Pass

#### Step 2.3
- **Setup**: the fix is in the shared `runCli` helper
- **Do**: existing or future CLI integration tests call it
- **Observe**: they inherit the deterministic behavior with no per-test edits
- [ ] Pass

### US-3: Code, CI, and stated policy agree on the CLI test runtime

*Independent test:* After the change, no surviving statement in the constitution/CLAUDE.md or `tests/helpers/cli.ts` comments contradicts the implemented execution mechanism.

#### Step 3.1
- **Setup**: the chosen mechanism declares tsx as a devDependency
- **Do**: the change lands
- **Observe**: the constitution's "tsx is not currently part of the dev loop" wording is revised to match
- [ ] Pass

#### Step 3.2
- **Setup**: the chosen mechanism removes tsx from the test path
- **Do**: the change lands
- **Observe**: the constitution wording is reaffirmed and the helper's "do NOT switch to dist" comment (or its replacement) reflects the new mechanism
- [ ] Pass

#### Step 3.3
- **Setup**: a reader inspects `tests/helpers/cli.ts`, `.github/workflows/ci.yml`, and the constitution after the change
- **Do**: they compare stated policy to actual behavior
- **Observe**: no stale or contradictory guidance survives
- [ ] Pass

## Additional scenarios

#### Step 4.1: Cold runner passes with only declared dependencies
- **Setup**: a cold runner with no warm `npx`/npm cache and no registry access after `npm ci` completes
- **Do**: `npm test` runs the full suite, including `tests/cli-status.test.ts` and `tests/cli-complete.test.ts` (Run: `npm ci`, `npm test`)
- **Observe**: every CLI subprocess spawned by `runCli` starts using only binaries installed by `npm ci`, and the suite passes with no per-invocation registry fetch
- **Machine-verified** — summary.md references "Deterministic CLI Test Execution Path"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.2: Test runtime is declared, not implicit
- **Setup**: the mechanism chosen for `runCli`
- **Do**: the binaries and runtimes it invokes are compared against `package.json` (dependencies, devDependencies, and scripts) plus the Node.js runtime itself (Run: `npm ci`)
- **Observe**: each invoked binary is traceable to a declared entry installed by `npm ci` (or is Node itself), with no reliance on globally installed or network-resolved tooling
- **Machine-verified** — summary.md references "Deterministic CLI Test Execution Path"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.3: Required artifacts exist before tests run in CI
- **Setup**: the chosen mechanism requires build output to run CLI tests
- **Do**: the CI gates job executes
- **Observe**: the required artifacts are produced before any CLI integration test spawns the CLI, and the test step passes on a cold runner
- **Machine-verified** — summary.md references "CI Ordering Consistent With Execution Path"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.4: CI and local runs exercise the same path
- **Setup**: the CI workflow definition and the npm `test` script after the change
- **Do**: CI runs `npm test` and a developer runs `npm test` locally (Run: `npm test`)
- **Observe**: both invocations execute the CLI through the same mechanism defined by `runCli`, with no CI-only or local-only execution path
- **Machine-verified** — summary.md references "CI Ordering Consistent With Execution Path"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.5: Fresh clone passes with scripts alone
- **Setup**: a fresh clone with no prior build artifacts and no globally installed tooling beyond Node.js >= 22 and npm
- **Do**: the contributor runs `npm ci` followed by `npm test` (Run: `npm ci`, `npm test`)
- **Observe**: the full suite passes without any undocumented manual pre-step
- **Machine-verified** — summary.md references "Fresh-Clone Test Runs Without Manual Pre-Steps"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.6: Stale build cannot mask source changes
- **Setup**: the chosen mechanism executes built output and a contributor has just edited `src/cli/index.ts`
- **Do**: the contributor runs `npm test` without manually rebuilding (Run: `npm test`)
- **Observe**: the CLI tests exercise the edited source behavior, because the scripted test flow refreshes the executed output
- **Machine-verified** — summary.md references "Fresh-Clone Test Runs Without Manual Pre-Steps"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.7: Timeout budget covers only CLI work
- **Setup**: the deterministic execution path is in place
- **Do**: a CLI subprocess spawned by `runCli` runs against its timeout
- **Observe**: the elapsed time consists only of CLI startup and command execution, with zero time spent resolving or fetching dependencies
- **Machine-verified** — summary.md references "Actionable Failures and Consistent Runtime Policy"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.8: Timeout failure is diagnosable
- **Setup**: a CLI subprocess that genuinely exceeds the `runCli` timeout
- **Do**: the calling test fails
- **Observe**: the failure output lets a maintainer identify the subprocess termination (timeout/kill) as the cause, rather than presenting only an unexplained empty-stdout parse error
- **Machine-verified** — summary.md references "Actionable Failures and Consistent Runtime Policy"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 4.9: No contradictory guidance survives
- **Setup**: the change has landed with its chosen mechanism
- **Do**: a reader compares `tests/helpers/cli.ts` comments, `.github/workflows/ci.yml`, `package.json`, and the constitution's dev-loop wording against the implemented behavior
- **Observe**: every surviving statement is consistent with the mechanism, and the tsx dev-loop claim has been either reaffirmed (tsx removed from the test path) or revised (tsx declared)
- **Machine-verified** — summary.md references "No contradictory guidance survives"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass
