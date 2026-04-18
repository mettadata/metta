# User Stories

## US-1: Gate timeout reaps the full process tree

**As a** metta user whose project's test suite runs near the gate timeout
**I want to** have a single timeout not leave orphan worker processes
**So that** retries don't compete with zombies for CPU
**Priority:** P1
**Independent Test Criteria:** Integration test spawns a sleeping child process via the gate runner, triggers timeout, then `ps` shows no descendant processes in that PGID one second later.

**Acceptance Criteria:**
- **Given** a gate command that spawns grandchild processes **When** the gate timeout fires **Then** every descendant in the gate's process group receives SIGTERM followed by SIGKILL
- **Given** a timed-out gate run **When** the runner returns **Then** no descendant processes remain consuming CPU under the original PGID

## US-2: Finalize only runs gates the active workflow declares

**As a** AI orchestrator running a quick-workflow change
**I want to** have `stories-valid` (and other artifact-specific gates) not fire when the workflow doesn't declare the underlying artifact
**So that** finalize reaches archive instead of failing on a gate that doesn't apply
**Priority:** P1
**Independent Test Criteria:** Unit test — finalizer invoked with a `quick` workflow only runs gates declared in the workflow's artifact `gates:` field; `stories-valid` is not in that list and is not called.

**Acceptance Criteria:**
- **Given** a quick-workflow change with no `stories.md` artifact **When** finalize runs **Then** the `stories-valid` gate is not invoked
- **Given** any workflow object **When** the finalizer derives its gate list **Then** the list comes from the flattened per-artifact `gates:` fields of that workflow, not from `gateRegistry.list()`

## US-3: Quick and auto changes archive on finalize

**As a** metta user running `/metta-quick` or `/metta-auto`
**I want to** have the change's `spec/changes/<name>/` directory archived to `spec/archive/YYYY-MM-DD-<name>/` after merge
**So that** main stays tidy across repeated small fixes, matching `/metta-propose` behavior
**Priority:** P2
**Independent Test Criteria:** Integration test runs `metta finalize` on a quick-workflow change fixture and asserts `spec/changes/<name>/` no longer exists and `spec/archive/<date>-<name>/` does.

**Acceptance Criteria:**
- **Given** a finalized quick-workflow change **When** finalize completes successfully **Then** `spec/changes/<name>/` is absent from the working tree
- **Given** a finalized quick-workflow change **When** finalize completes successfully **Then** `spec/archive/<date>-<name>/` exists and contains the change's artifacts

## US-4: Retry-once reaps prior PGID before respawn

**As a** gate runner under retry-once
**I want to** have an initial timed-out run's PGID fully reaped before the retry spawns
**So that** cascading orphans can't pile up across retries
**Priority:** P2
**Independent Test Criteria:** Test asserts that the retry-once path calls the PGID-kill helper on the first run and waits for reaping before spawning the second run.

**Acceptance Criteria:**
- **Given** a gate that times out and is retried once **When** the retry is about to spawn **Then** the first run's process group has already been SIGKILLed and reaped
- **Given** a timed-out retry **When** the runner returns final status **Then** both the first and second run's process groups have no surviving descendants
