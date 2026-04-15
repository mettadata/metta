# t5-user-story-layer-spec-forma — User Stories

## US-1: Surface user value alongside technical requirements

**As a** product/engineering team member reading a metta change

**I want to** see who benefits and why, not just MUST/SHOULD requirements

**So that** I can trace any line of code back to the user value it delivers

**Priority:** P1

**Independent Test Criteria:** A reviewer reading `spec/changes/<name>/` finds both `spec.md` (technical) and `stories.md` (product) in the standard workflow output, and can map any requirement to a user story via its `**Fulfills:** US-N` field.

**Acceptance Criteria:**

- **Given** a new change started with `metta propose` **When** the standard workflow advances **Then** the orchestrator produces `stories.md` between intent and spec phases
- **Given** a `stories.md` with US-1 through US-N **When** spec.md requirements include `**Fulfills:** US-N` **Then** finalize gate cross-validates each Fulfills reference exists
- **Given** an internal/refactor change **When** stories.md uses the sentinel pattern with `**Justification:**` **Then** finalize gate accepts the explicit acknowledgment

## US-2: Catch broken story to requirement traceability before ship

**As a** maintainer reviewing a change at finalize time

**I want to** be blocked when a requirement claims to fulfill a story that doesn't exist

**So that** stale or typo'd Fulfills references don't pollute the spec corpus

**Priority:** P2

**Independent Test Criteria:** `metta finalize` exits non-zero with a clear error when any spec.md `**Fulfills:** US-99` references a US-N not present in stories.md.

**Acceptance Criteria:**

- **Given** spec.md references US-99 **When** stories.md has only US-1, US-2 **Then** `metta validate-stories` exits 4 with a `broken_fulfills` error
- **Given** stories.md modified after spec.md was committed **When** finalize runs **Then** a non-blocking warning recommends spec re-derivation

## US-3: Allow internal/refactor changes without ceremony

**As a** developer making a pure refactor or infrastructure change

**I want to** mark the change as internal without inventing fictitious user stories

**So that** the workflow doesn't penalize legitimate non-user-facing work

**Priority:** P2

**Independent Test Criteria:** A change with stories.md containing only the sentinel `## No user stories — internal/infrastructure change` plus `**Justification:** ...` passes finalize without any `Fulfills` references in spec.md.

**Acceptance Criteria:**

- **Given** stories.md uses the sentinel pattern **When** finalize gate runs **Then** the change passes (sentinel is a valid document kind)
- **Given** sentinel justification under 10 chars **When** finalize runs **Then** Zod validation fails — explicit acknowledgment must be substantive
