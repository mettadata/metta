# User Stories

## US-1: See how much context a phase is consuming

**As a** metta operator running a change through the workflow

**I want to** run `metta context stats --change <name>` and see how many tokens each phase is loading vs its budget

**So that** I can tell before kicking off an executor whether the phase is context-bloated and decide to fan-out or split

**Priority:** P1

**Independent Test Criteria:** can be verified in isolation by creating a synthetic change with known-size artifacts, running the command, and asserting the reported utilization matches the known input

**Acceptance Criteria:**

- **Given** a change with an artifact whose context load is 65% of budget **When** I run `metta context stats --change <name>` **Then** the output lists the artifact with utilization `65%` and recommendation `ok`
- **Given** a change with an artifact whose context load exceeds 90% of budget **When** I run the stats command **Then** the recommendation is `fan-out` or `split-phase` and the CLI exits 0 (warning, not error)
- **Given** I pass `--json` **When** the command runs **Then** output is machine-parseable with fields `artifact`, `tokens`, `budget`, `utilization`, `recommendation`

## US-2: Get an automatic warning when instructions exceed smart-zone

**As a** metta operator about to spawn an executor agent

**I want to** see a warning in `metta instructions <artifact>` JSON when the loaded context exceeds 80% of budget

**So that** I can decide whether to split the phase before the agent starts, rather than discovering overflow mid-run

**Priority:** P1

**Independent Test Criteria:** can be verified by seeding a fixture with oversized optional files, running `metta instructions`, and asserting the `budget.warning` field is populated

**Acceptance Criteria:**

- **Given** context load is under 80% of budget **When** I run `metta instructions <artifact> --json` **Then** the `budget` object contains no `warning` field
- **Given** context load is between 80% and 100% of budget **When** I run the command **Then** `budget.warning` equals `"smart-zone"` with a human-readable recommendation
- **Given** context load exceeds 100% of budget **When** the command runs **Then** `budget.warning` equals `"over-budget"` and lists which optional files were dropped

## US-3: Use section filtering to stay under budget

**As a** metta contributor loading a large optional dependency

**I want to** the context engine to load only the relevant section of a large markdown artifact instead of silently truncating

**So that** the agent sees coherent content rather than a mid-sentence cutoff

**Priority:** P2

**Independent Test Criteria:** can be verified by providing an oversized fixture with known headings, configuring `skeleton` strategy, and asserting only heading lines appear in the loaded content

**Acceptance Criteria:**

- **Given** an optional dependency exceeds remaining budget and strategy is `skeleton` **When** context is built **Then** only H1/H2/H3 headings from that file are included, not body paragraphs
- **Given** strategy is `full` (default) **When** an optional dependency exceeds remaining budget **Then** it is skipped entirely (current behavior preserved)
- **Given** strategy is `section` with a named section **When** context is built **Then** only the content under the named heading is loaded
