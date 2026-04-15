# t8-post-merge-gate-re-run-afte — User Stories

## US-1: Catch silent merge-resolution regressions before they hit main

**As a** maintainer landing parallel changes via metta ship

**I want to** be blocked when the post-merge state breaks tests/lint/typecheck even though pre-merge gates passed

**So that** main never carries known-broken code from merge interaction effects

**Priority:** P1

**Independent Test Criteria:** Ship a branch whose merge resolution introduces a type error not present in either side; ship pipeline runs post-merge gates, detects the failure, rolls back to the snapshot tag, and exits non-zero with a clear "tests failed; rolled back to <sha>" message.

**Acceptance Criteria:**

- **Given** a clean merge that compiles and tests pass on both sides individually **When** the merge result still passes all gates **Then** ship completes and main carries the merged commit
- **Given** a merge that introduces a regression caught by typecheck **When** post-merge-gates step runs **Then** the step fails, the pipeline rolls back to the pre-merge snapshot tag, and the step output names the failing gate
- **Given** a project with no gates configured **When** ship runs post-merge-gates step **Then** the step passes with detail "no gates configured" and the ship continues
