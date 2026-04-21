<!--
User stories for surface-time-token-budget-review-verifier-iteration-count.
All stories are grounded in the behavior described in intent.md.
-->

# surface-time-token-budget-review-verifier-iteration-count — User Stories

## US-1: See time spent per artifact in progress output

**As a** metta user working a change across multiple sessions
**I want to** see how long each artifact took (wall-clock) in `metta progress`
**So that** I can identify bottlenecks and tell whether a change is stalling
**Priority:** P1
**Independent Test Criteria:** After running `metta complete intent` and
`metta complete spec` on a test change, `metta progress --json` returns
`artifact_timings` with ISO-string `completed` values for both artifacts, and
the human-rendered output contains a line showing `intent <duration> · spec
<duration>`.

**Acceptance Criteria:**
- **Given** a change whose intent artifact has been completed **When** the
  user runs `metta progress --json` **Then** the change entry contains
  `artifact_timings.intent.completed` as an ISO-8601 datetime string.
- **Given** a change with `started` and `completed` timestamps for an
  artifact **When** the user runs `metta progress` (human output) **Then** a
  duration segment appears in the form `intent 2m 14s` (rounded to the nearest
  second, using `<N>m <N>s` for under an hour and `<N>h <N>m` for longer
  durations).
- **Given** a legacy change missing `artifact_timings` **When** the user
  runs `metta progress` **Then** the time line is derived from `git log` of
  the artifact file in `spec/changes/<change>/` and no error is emitted.

---

## US-2: See token budget consumed vs. budgeted in progress output

**As a** metta user
**I want to** see the token budget and consumption per artifact
**So that** I know whether I am near the `budget_tokens` ceiling before I
start an artifact, and which artifacts are the largest consumers
**Priority:** P1
**Independent Test Criteria:** After running `metta instructions spec --json`
against a test change, the change's `.metta.yaml` contains
`artifact_tokens.spec = { context: <N>, budget: <M> }` matching the values
the command just printed, and `metta progress --json` surfaces them.

**Acceptance Criteria:**
- **Given** a change where `metta instructions <artifact>` has been called
  **When** the user reads `.metta.yaml` **Then** `artifact_tokens[<artifact>]`
  contains both `context` and `budget` integers.
- **Given** a change with `artifact_tokens` populated for two artifacts
  **When** the user runs `metta progress` (human output) **Then** the output
  includes a line of the form `📊 <total_context>k / <total_budget>k tokens`
  summed across tracked artifacts, and `metta progress --json` surfaces
  `artifact_tokens` verbatim.
- **Given** a change where no `metta instructions` call has been made yet
  **When** the user runs `metta progress` **Then** the token line is
  suppressed (not rendered as zeros, not errored on).

---

## US-3: See review and verify iteration counts

**As a** metta user whose change went through a review-fix loop
**I want to** see how many review and verify iterations ran
**So that** I know whether the change sailed through or scraped by at the
max-3 ceiling, and the signal is not lost after ship
**Priority:** P2
**Independent Test Criteria:** After running
`metta iteration record --phase review --change <c>` three times and
`metta iteration record --phase verify --change <c>` once, the change's
`.metta.yaml` contains `review_iterations: 3` and `verify_iterations: 1`,
and `metta progress --json` surfaces both values.

**Acceptance Criteria:**
- **Given** the CLI `metta iteration record --phase review --change <c>` is
  invoked on a change whose `.metta.yaml` has no `review_iterations` field
  **When** the command exits successfully **Then** the file is updated with
  `review_iterations: 1`.
- **Given** a change with `review_iterations: 2` **When** the same command
  is invoked again **Then** the value becomes `3`.
- **Given** `metta iteration record --phase verify` is invoked on the same
  change **Then** `verify_iterations` is incremented and `review_iterations`
  is unchanged.
- **Given** `metta iteration record --phase review --change <c>` is invoked
  on a non-existent change **Then** the command exits with a non-zero status
  and prints a clear error (no partial writes).
- **Given** a change with `review_iterations: 2, verify_iterations: 1`
  **When** the user runs `metta progress` (human output) **Then** the line
  includes `↻ review ×2, verify ×1`. When either counter is `0` or absent,
  that half is suppressed.

---

## US-4: Per-artifact "started" timestamp captured at instruction time

**As a** metta user or the metta-auto loop
**I want to** have each artifact's `started` time recorded when the
orchestrator first asks for instructions on it
**So that** the duration shown in progress covers the whole authoring
window, not just from the `metta complete` call
**Priority:** P2
**Independent Test Criteria:** A freshly created change has no
`artifact_timings.intent.started` field; after `metta instructions intent
--json --change <c>` is called, the field is populated; a second call does
NOT overwrite it.

**Acceptance Criteria:**
- **Given** a change in the `ready` state for artifact `intent` **When**
  `metta instructions intent --json --change <c>` is invoked **Then**
  `artifact_timings.intent.started` is set to the current UTC time in
  ISO-8601.
- **Given** `artifact_timings.intent.started` is already set **When**
  `metta instructions intent` is invoked again (e.g. the orchestrator
  re-reads the instructions) **Then** the existing `started` value is not
  overwritten.
- **Given** the state write fails (e.g. filesystem permission error)
  **When** `metta instructions` is called **Then** the command still
  completes successfully and emits its instructions JSON, logging a warning
  rather than aborting (instrumentation MUST NOT block workflow).

---

## US-5: Back-compat with existing `.metta.yaml` files

**As a** metta user with in-flight changes created before this feature
**I want to** not have my existing changes break after upgrade
**So that** I can finish them normally and benefit from the new surface on
future changes
**Priority:** P1
**Independent Test Criteria:** Loading an existing `.metta.yaml` that
contains none of `artifact_timings`, `artifact_tokens`, `review_iterations`,
`verify_iterations` validates cleanly against the updated
`ChangeMetadataSchema`, and `metta progress` / `metta status` render without
error (suppressing missing segments).

**Acceptance Criteria:**
- **Given** a pre-existing `.metta.yaml` with no new fields **When**
  `ArtifactStore.getChange` reads it **Then** Zod validation passes.
- **Given** such a change **When** the user runs `metta progress` **Then**
  the output contains only the segments it has data for (or the git-log
  fallback for timings) and no error is emitted.
- **Given** such a change **When** `metta complete <artifact>` is invoked
  **Then** the call succeeds and the file is written with
  `artifact_timings[<artifact>].completed` added (fields are upserted,
  never required to pre-exist).
