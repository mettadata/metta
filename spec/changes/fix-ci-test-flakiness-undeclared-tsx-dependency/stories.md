# fix-ci-test-flakiness-undeclared-tsx-dependency — User Stories

## US-1: Deterministic CI signal on cold runners

**As a** metta maintainer
**I want to** have `npm test` pass deterministically on a cold CI runner after `npm ci`, with no test subprocess resolving a binary from the network
**So that** a red CI run always means a real defect — I stop re-running jobs, triaging phantom ENOENT/JSON-parse failures, and losing trust in the gate that blocks finalize/ship
**Priority:** P1
**Independent Test Criteria:** On a cold runner (no warm npx cache, no registry access beyond `npm ci`), the full test suite passes and every binary/runtime invoked by `runCli` is verifiably installed by `npm ci`.

**Acceptance Criteria:**
- **Given** a cold CI runner that has run only `npm ci` **When** the CI workflow executes the test step **Then** all CLI integration tests in `tests/cli-status.test.ts` and `tests/cli-complete.test.ts` pass without any per-invocation registry fetch
- **Given** the chosen execution mechanism for `runCli` **When** a CLI integration test spawns the CLI **Then** every binary and runtime it invokes is present from `npm ci` alone, and the 10s timeout is spent only on actual CLI work
- **Given** the chosen mechanism requires build output (if `dist/`-based) **When** the CI workflow runs **Then** the job order guarantees the required artifacts exist before tests execute

---

## US-2: Fresh-clone test runs work with no manual pre-steps

**As a** metta contributor
**I want to** clone the repo, run `npm ci` and `npm test`, and get the same passing result CI reports
**So that** my local dev loop stays trustworthy and I never chase failures (or miss real ones via a stale build) caused by an execution path that differs from CI's
**Priority:** P1
**Independent Test Criteria:** From a fresh clone, `npm ci && npm test` passes with no manual pre-step beyond what the npm scripts themselves encode, and local test runs exercise current source (a stale `dist/` cannot mask source changes).

**Acceptance Criteria:**
- **Given** a fresh clone with no prior build artifacts **When** the contributor runs `npm ci` followed by `npm test` **Then** the suite passes without any undocumented manual pre-step
- **Given** the mechanism executes built output **When** a contributor edits `src/cli/index.ts` and runs `npm test` **Then** the tests exercise the edited behavior, not a stale build, via a scripted rebuild rather than developer discipline
- **Given** the fix is in the shared `runCli` helper **When** existing or future CLI integration tests call it **Then** they inherit the deterministic behavior with no per-test edits

---

## US-3: Code, CI, and stated policy agree on the CLI test runtime

**As a** metta maintainer
**I want to** have the constitution's dev-loop statement, the `tests/helpers/cli.ts` in-code guidance, and the actual test execution mechanism reconciled to one consistent story
**So that** future contributors and AI agents follow accurate guidance instead of stale, contradictory comments that could reintroduce the undeclared-dependency flake
**Priority:** P2
**Independent Test Criteria:** After the change, no surviving statement in the constitution/CLAUDE.md or `tests/helpers/cli.ts` comments contradicts the implemented execution mechanism.

**Acceptance Criteria:**
- **Given** the chosen mechanism declares tsx as a devDependency **When** the change lands **Then** the constitution's "tsx is not currently part of the dev loop" wording is revised to match
- **Given** the chosen mechanism removes tsx from the test path **When** the change lands **Then** the constitution wording is reaffirmed and the helper's "do NOT switch to dist" comment (or its replacement) reflects the new mechanism
- **Given** a reader inspects `tests/helpers/cli.ts`, `.github/workflows/ci.yml`, and the constitution after the change **When** they compare stated policy to actual behavior **Then** no stale or contradictory guidance survives
