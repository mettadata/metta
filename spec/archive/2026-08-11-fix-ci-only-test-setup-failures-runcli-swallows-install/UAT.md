# UAT: fix-ci-only-test-setup-failures-runcli-swallows-install

- **Change**: fix-ci-only-test-setup-failures-runcli-swallows-install
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

### US-1: Setup failures fail loud with full diagnostics

*Independent test:* Forcing a setup-phase CLI invocation to fail produces a test error that names the command and includes its exit code, signal, and captured stderr — with no downstream ENOENT masking it.

#### Step 1.1
- **Setup**: a fail-fast setup helper in `tests/helpers/cli.ts`
- **Do**: the CLI child process exits non-zero (or is killed by a signal)
- **Observe**: the helper throws an error containing the command args, exit code, signal, and full stderr/stdout instead of returning silently
- [ ] Pass

#### Step 1.2
- **Setup**: the install-specific setup helper
- **Do**: the install command exits zero but `.metta/config.yaml` does not exist afterward
- **Observe**: the helper throws with the same captured diagnostics
- [ ] Pass

#### Step 1.3
- **Setup**: an existing test that deliberately asserts on a non-zero exit
- **Do**: it calls the original `runCli`
- **Observe**: the existing `{ stdout, stderr, code }` return-value contract is unchanged and the test's semantics are preserved
- [ ] Pass

### US-2: Setup call sites migrated so no failure is swallowed

*Independent test:* All setup-phase install invocations in the CLI-fixture test files (at minimum `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`) use the throwing helper, and the full suite still passes on the happy path.

#### Step 2.1
- **Setup**: the CLI-fixture test files
- **Do**: a setup-phase invocation's result would otherwise be discarded
- **Observe**: it uses the fail-fast helper rather than the silent `runCli`
- [ ] Pass

#### Step 2.2
- **Setup**: `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`
- **Do**: the migration is complete
- **Observe**: every setup-phase install call site in those files fails fast on error
- [ ] Pass

#### Step 2.3
- **Setup**: the migrated suite
- **Do**: all setup commands succeed
- **Observe**: test behavior and pass/fail results are identical to before the migration
- [ ] Pass

### US-3: CI concurrency capped to prevent resource exhaustion

*Independent test:* The gates job runs green on this change's branch with a concurrency configuration that prevents multiple heavy CLI-fixture files from being scheduled onto concurrent workers on a 2-core runner.

#### Step 3.1
- **Setup**: the gates job on a 2-core GitHub runner
- **Do**: vitest schedules test files
- **Observe**: the configured cap prevents the heavy CLI-fixture files (`cli-finalize`, `cli-complete`, and peers) from running on concurrent workers
- [ ] Pass

#### Step 3.2
- **Setup**: this change's branch
- **Do**: the CI gates job runs
- **Observe**: it passes, including the previously failing `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`
- [ ] Pass

#### Step 3.3
- **Setup**: a residual CI setup failure after the cap
- **Do**: the run goes red
- **Observe**: the output self-diagnoses per US-1 rather than presenting a bare ENOENT
- [ ] Pass

### US-4: Local test runs stay fast

*Independent test:* Local `npm test` completes in roughly its current wall-clock time with the full suite passing (2122+ tests), unconstrained by the CI cap or affected only negligibly.

#### Step 4.1
- **Setup**: a local development machine
- **Do**: the developer runs `npm test` (Run: `npm test`)
- **Observe**: the concurrency cap either does not apply (env-scoped to CI) or imposes no meaningful slowdown
- [ ] Pass

#### Step 4.2
- **Setup**: the full local suite
- **Do**: it runs after this change
- **Observe**: all tests pass with unchanged happy-path behavior
- [ ] Pass

## Additional scenarios

#### Step 5.1: Non-zero exit throws with full diagnostics
- **Setup**: a CLI invocation via the fail-fast helper whose child process exits with a non-zero code
- **Do**: the helper's promise settles
- **Observe**: it rejects with an error whose message names the command arguments and includes the exit code and the full captured stderr and stdout
- [ ] Pass

#### Step 5.2: Signal kill throws with signal named
- **Setup**: a CLI invocation via the fail-fast helper whose child process is killed by a signal (e.g. the exec timeout fires SIGTERM)
- **Do**: the helper's promise settles
- **Observe**: it rejects with an error that identifies the terminating signal and the timeout budget, plus the captured stderr and stdout, instead of returning silently
- [ ] Pass

#### Step 5.3: Successful invocation does not throw
- **Setup**: a CLI invocation via the fail-fast helper that exits with code 0
- **Do**: the helper's promise settles
- **Observe**: it resolves without throwing and the calling test proceeds identically to the pre-change happy path
- [ ] Pass

#### Step 5.4: Zero exit but missing config throws
- **Setup**: an install invocation that exits with code 0 but leaves no `.metta/config.yaml` in the fixture directory
- **Do**: the install fixture helper's post-check runs
- **Observe**: it throws an error naming the missing file and including the install command's captured stdout and stderr, so the failure is attributed to install rather than a later ENOENT
- [ ] Pass

#### Step 5.5: Successful install passes the post-check
- **Setup**: an install invocation that exits 0 and writes `.metta/config.yaml`
- **Do**: the install fixture helper completes
- **Observe**: it resolves without throwing and the fixture directory is usable by subsequent CLI calls
- [ ] Pass

#### Step 5.6: Deliberate failure assertion still receives a return value
- **Setup**: an existing test that calls `runCli` with arguments expected to fail and asserts `code !== 0` and on `stderr` content
- **Do**: the CLI child process exits non-zero (Run: `code !== 0`)
- **Observe**: `runCli` resolves (does not throw) with the populated `{ stdout, stderr, code }` result and the test's assertions behave exactly as before the change
- [ ] Pass

#### Step 5.7: No discarded setup result in the minimum files
- **Setup**: the migrated `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`
- **Do**: their setup-phase install invocations are inspected
- **Observe**: none calls `runCli` with a discarded result; each uses the throwing helper so a dead install process fails the test at the setup line
- [ ] Pass

#### Step 5.8: Setup failure surfaces at the failing command
- **Setup**: a migrated fixture file in which the setup-phase install child process dies before writing `.metta/`
- **Do**: the test runs
- **Observe**: the test fails at the setup invocation with the install command's exit code, signal, and captured stderr — not with a downstream ENOENT on `.metta/config.yaml`
- [ ] Pass

#### Step 5.9: Happy-path suite behavior is unchanged
- **Setup**: the fully migrated suite with all setup commands succeeding
- **Do**: `npm test` runs the full suite (Run: `npm test`)
- **Observe**: every test passes with the same pass/fail results as before the migration
- [ ] Pass

#### Step 5.10: Heavy fixture files do not run concurrently in CI
- **Setup**: the CI gates job on a 2-core GitHub runner with the cap active
- **Do**: vitest schedules the test files
- **Observe**: the effective worker/file-parallelism configuration prevents two heavy CLI-fixture files from executing on concurrent workers at the same time
- [ ] Pass

#### Step 5.11: Gates job passes on a constrained runner
- **Setup**: this change's branch with the cap and the setup-helper migration in place
- **Do**: the CI gates job runs on a standard 2-core GitHub runner
- **Observe**: the suite passes, including `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`, with no setup-phase child process dying from spawn-resource exhaustion
- **Machine-verified** — summary.md references "Gates job passes on a constrained runner"; gates all passed (stories-valid, tests, lint, typecheck, build)
- [ ] Pass

#### Step 5.12: Residual CI failure self-diagnoses
- **Setup**: the cap is active and a setup-phase CLI invocation nevertheless fails in CI
- **Do**: the run goes red
- **Observe**: the test output names the failing command with its exit code, signal, and captured stderr per the fail-fast helper, rather than presenting only a downstream ENOENT
- [ ] Pass

#### Step 5.13: Local run is not constrained by the CI cap
- **Setup**: a local development machine without the CI environment condition (or with the negligible unconditional cap)
- **Do**: the developer runs `npm test` (Run: `npm test`)
- **Observe**: vitest uses its normal local parallelism (or an equivalent-speed configuration) and the full suite passes in roughly its current wall-clock time
- [ ] Pass

#### Step 5.14: Full local suite passes after the change
- **Setup**: the migrated helpers, call sites, and concurrency configuration
- **Do**: the developer runs `npm test` locally (Run: `npm test`)
- **Observe**: all tests (2122+) pass with no behavioral change on the happy path
- [ ] Pass
