# fix-metta-propose-has-no-flag-stop-after-planning-artifacts — User Stories

## US-1: Stop propose after a named planning artifact

**As a** developer running `/metta-propose` for a non-trivial change
**I want to** pass `--stop-after <artifact>` and have the workflow halt cleanly after that artifact is committed
**So that** I can inspect the planning diffs (intent / stories / spec / research / design / tasks) before the orchestrator burns budget on implementation, review, verification, finalize, and merge
**Priority:** P1
**Independent Test Criteria:** Running `metta propose "<desc>" --stop-after tasks` against a fresh repo produces all planning artifacts up to and including `tasks.md`, leaves `implementation` and `verification` in their pre-execution state on the change record, and exits with a status message naming `/metta-execute` as the resume command.

**Acceptance Criteria:**
- **Given** a clean repo with no active change **When** the user runs `metta propose "<desc>" --stop-after tasks --json` **Then** the change is created on branch `metta/<change-name>`, the JSON output includes `"stop_after": "tasks"`, and the change record `.metta.yaml` persists `stop_after: tasks`.
- **Given** a propose invocation with `--stop-after tasks` **When** the propose skill completes the `tasks` artifact via `metta complete tasks` **Then** the orchestrator MUST NOT spawn any implementation, review, or verification subagents and MUST emit a single handoff line of the form `Stopped after \`tasks\`. Run \`/metta-execute\` to begin implementation.`.
- **Given** a propose invocation that stopped after planning **When** the user later runs `/metta-execute` on the same change **Then** execution resumes from `implementation` exactly as it does for a change whose planning was completed without `--stop-after`.

---

## US-2: Reject invalid `--stop-after` values up front

**As a** developer who mistypes `--stop-after spex` or names an execution-phase artifact like `--stop-after implementation`
**I want to** see the error before any change record, branch, or planning artifact is created
**So that** I am not left with a half-initialized change to clean up
**Priority:** P1
**Independent Test Criteria:** Running `metta propose "<desc>" --stop-after <bad-value>` exits with a non-zero status code and an error that lists the valid artifact ids for the resolved workflow; no change directory, branch, or `.metta.yaml` is created.

**Acceptance Criteria:**
- **Given** a workflow whose `buildOrder` does not include `spex` **When** the user runs `metta propose "<desc>" --stop-after spex` **Then** the CLI MUST exit with code 4, MUST print an error citing the unknown value AND the valid artifact ids for the resolved workflow, and MUST NOT have written any files under `spec/changes/`.
- **Given** any workflow **When** the user runs `metta propose "<desc>" --stop-after implementation` (an execution-phase id) **Then** the CLI MUST reject the value with an error that explains execution-phase ids are not valid stop points (`implementation` and `verification` are explicitly forbidden).
- **Given** the standard workflow **When** the user runs `metta propose "<desc>" --stop-after tasks` **Then** the CLI MUST accept the value because `tasks` is in the standard workflow's planning phase.

---

## US-3: `--stop-after` is opt-in and composes with existing flags

**As a** developer who already uses `metta propose "<desc>"` (no flags) or `metta propose "<desc>" --workflow full --auto`
**I want to** keep my current invocations working unchanged
**So that** adopting `--stop-after` for new workflows does not break my muscle memory or my CI scripts
**Priority:** P1
**Independent Test Criteria:** Running `metta propose "<desc>"` with no `--stop-after` flag produces the same end-to-end behavior as the current implementation (full lifecycle — planning, implementation, review, verification, finalize, merge). Running `--stop-after tasks` together with `--workflow standard` and `--auto` succeeds with all three semantics applied.

**Acceptance Criteria:**
- **Given** a propose invocation with no `--stop-after` flag **When** the workflow runs **Then** behavior is identical to the pre-change implementation — the orchestrator proceeds through all phases without an early exit.
- **Given** an invocation `metta propose "<desc>" --workflow standard --stop-after spec --auto` **When** the propose skill runs **Then** all three flags MUST take effect: the standard workflow is loaded, the discovery loop is short-circuited via `--auto`, and the orchestrator stops after `spec` is committed.
- **Given** an invocation that combines `--from-issue <slug>` with `--stop-after tasks` **When** propose runs **Then** the change MUST be created with the issue context AND MUST stop after tasks; the two flags compose without interaction bugs.

---

## US-4: Stop point is recorded on the change record

**As a** future tool, skill, or human reviewer reading a change directory
**I want to** see at a glance whether the change was created with a stop-after point and what that point was
**So that** resuming, auditing, or refreshing the change does not require replaying the original CLI invocation
**Priority:** P2
**Independent Test Criteria:** After `metta propose "<desc>" --stop-after tasks`, the file `spec/changes/<change>/.metta.yaml` contains `stop_after: tasks` as a top-level field, and `metta status --json --change <name>` returns the same value under a `stop_after` key.

**Acceptance Criteria:**
- **Given** a propose invocation with `--stop-after design` **When** the change is created **Then** `.metta.yaml` MUST persist `stop_after: design` and the change-record Zod schema MUST validate it.
- **Given** a change record with `stop_after: design` **When** `metta status --json --change <name>` runs **Then** the JSON output MUST include `stop_after: design`.
- **Given** a propose invocation with no `--stop-after` flag **When** the change is created **Then** `.metta.yaml` MUST NOT include a `stop_after` field (or MUST set it to `null`); the schema treats it as optional.

---

## US-5: Helpful resume guidance at the stop point

**As a** developer who just ran `metta propose "<desc>" --stop-after tasks`
**I want to** see exactly which command to run next to resume the workflow
**So that** I do not have to recall the metta skill catalog or read CLAUDE.md to figure out what comes after planning
**Priority:** P2
**Independent Test Criteria:** When the propose skill exits at the stop-after boundary, the final user-facing line names the resume command corresponding to the stop point: `/metta-execute` for stop-after-tasks, `/metta-plan` or `/metta-status` for earlier stops.

**Acceptance Criteria:**
- **Given** `--stop-after tasks` **When** the orchestrator hits the boundary **Then** the final message MUST read `Stopped after \`tasks\`. Run \`/metta-execute\` to begin implementation.` (exact string for matchability).
- **Given** `--stop-after spec` **When** the orchestrator hits the boundary **Then** the message MUST name `/metta-plan` (to continue planning) or `/metta-status` (to inspect) as the resume options.
- **Given** any stop point **When** the orchestrator exits **Then** it MUST NOT print any message implying that implementation, review, or verification ran.

---
