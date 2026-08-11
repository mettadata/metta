# fix-ci-only-test-setup-failures-runcli-swallows-install — User Stories

## US-1: Setup failures fail loud with full diagnostics

**As a** metta developer debugging a red CI run
**I want to** see the failing setup command's exit code, signal, and captured stderr/stdout directly in the test output when a setup-phase CLI invocation dies
**So that** I can diagnose the real cause immediately instead of chasing a misleading downstream ENOENT that looks like an unrelated flake
**Priority:** P1
**Independent Test Criteria:** Forcing a setup-phase CLI invocation to fail produces a test error that names the command and includes its exit code, signal, and captured stderr — with no downstream ENOENT masking it.

**Acceptance Criteria:**
- **Given** a fail-fast setup helper in `tests/helpers/cli.ts` **When** the CLI child process exits non-zero (or is killed by a signal) **Then** the helper throws an error containing the command args, exit code, signal, and full stderr/stdout instead of returning silently
- **Given** the install-specific setup helper **When** the install command exits zero but `.metta/config.yaml` does not exist afterward **Then** the helper throws with the same captured diagnostics
- **Given** an existing test that deliberately asserts on a non-zero exit **When** it calls the original `runCli` **Then** the existing `{ stdout, stderr, code }` return-value contract is unchanged and the test's semantics are preserved

---

## US-2: Setup call sites migrated so no failure is swallowed

**As a** metta maintainer
**I want to** have setup-phase `runCli(['install', ...])` invocations across the CLI-fixture test files converted to the fail-fast helper
**So that** no future setup failure in any fixture file can be silently discarded and surface later as an unexplainable cascade of failures
**Priority:** P1
**Independent Test Criteria:** All setup-phase install invocations in the CLI-fixture test files (at minimum `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`) use the throwing helper, and the full suite still passes on the happy path.

**Acceptance Criteria:**
- **Given** the CLI-fixture test files **When** a setup-phase invocation's result would otherwise be discarded **Then** it uses the fail-fast helper rather than the silent `runCli`
- **Given** `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts` **When** the migration is complete **Then** every setup-phase install call site in those files fails fast on error
- **Given** the migrated suite **When** all setup commands succeed **Then** test behavior and pass/fail results are identical to before the migration

---

## US-3: CI concurrency capped to prevent resource exhaustion

**As a** contributor whose PR must pass the CI gates job
**I want to** have vitest's parallelism constrained in CI so heavy exec-storm fixture files cannot run concurrently on a 2-core runner
**So that** my PR is not randomly blocked by process-spawn resource exhaustion in tests my change never touched
**Priority:** P1
**Independent Test Criteria:** The gates job runs green on this change's branch with a concurrency configuration that prevents multiple heavy CLI-fixture files from being scheduled onto concurrent workers on a 2-core runner.

**Acceptance Criteria:**
- **Given** the gates job on a 2-core GitHub runner **When** vitest schedules test files **Then** the configured cap prevents the heavy CLI-fixture files (`cli-finalize`, `cli-complete`, and peers) from running on concurrent workers
- **Given** this change's branch **When** the CI gates job runs **Then** it passes, including the previously failing `tests/cli-finalize.test.ts` and `tests/cli-complete.test.ts`
- **Given** a residual CI setup failure after the cap **When** the run goes red **Then** the output self-diagnoses per US-1 rather than presenting a bare ENOENT

---

## US-4: Local test runs stay fast

**As a** metta developer running `npm test` locally
**I want to** keep local suite wall-clock time at its current speed
**So that** the CI-oriented concurrency fix does not degrade my inner development loop
**Priority:** P2
**Independent Test Criteria:** Local `npm test` completes in roughly its current wall-clock time with the full suite passing (2122+ tests), unconstrained by the CI cap or affected only negligibly.

**Acceptance Criteria:**
- **Given** a local development machine **When** the developer runs `npm test` **Then** the concurrency cap either does not apply (env-scoped to CI) or imposes no meaningful slowdown
- **Given** the full local suite **When** it runs after this change **Then** all tests pass with unchanged happy-path behavior
