# enforce-workflow-tier-routing-so-ceremony-actually-scales — User Stories

## US-1: Small changes auto-downscale by default

**As a** developer completing an intent for a small, bounded change
**I want to** have the change automatically downscale to the scored workflow tier unless I explicitly locked the workflow
**So that** a one-file fix does not run a 6+ artifact planning pipeline just because the heavier tier was the silent default

**Priority:** P1
**Independent Test Criteria:** Run `metta complete` non-interactively on an intent whose Impact section scores below the chosen tier (workflow not explicitly locked) and observe the change's persisted workflow in `.metta.yaml` collapse to the scored recommendation.

**Acceptance Criteria:**
- **Given** a change on the `standard` workflow whose intent scores `quick` and whose metadata has `workflow_locked !== true` **When** `metta complete` runs the intent-time downscale prompt non-interactively (no TTY, `--json`, or auto mode off) **Then** the prompt resolves to Yes and the change downscales to the scored tier
- **Given** the same scored-below-current change **When** `metta complete` runs interactively **Then** the downscale prompt displays Yes as the default (`[Y/n]`)
- **Given** a change whose metadata has `workflow_locked === true` **When** the intent scores below the chosen tier **Then** the downscale prompt defaults to No and the explicitly chosen workflow is respected

---

## US-2: Escalating above the scored tier leaves a record

**As a** developer or AI orchestrator keeping or choosing a workflow tier above the scorer's recommendation
**I want to** have that escalation captured as a structured record (from tier, to tier, justification, timestamp) on the change's metadata
**So that** routing a small change onto heavy ceremony is a deliberate, auditable decision instead of a free silent default

**Priority:** P1
**Independent Test Criteria:** Complete an intent while keeping a tier above the scored recommendation, then read the change's `.metta.yaml` and find a populated `escalation` object with `from_tier`, `to_tier`, `justification`, and `timestamp`.

**Acceptance Criteria:**
- **Given** an intent scored at `quick` on a change kept at `standard` **When** the user or auto-mode declines the downscale (or the workflow was explicitly locked above the recommendation) **Then** an `escalation` object with `from_tier`, `to_tier`, `justification`, and `timestamp` is persisted to the change's `.metta.yaml`
- **Given** a change that downscales to the scored recommendation **When** `metta complete` finishes **Then** no `escalation` object is written
- **Given** an existing `.metta.yaml` file that omits the `escalation` field **When** the change metadata is loaded and validated **Then** validation succeeds without migration

---

## US-3: Escalations are visible in change status

**As a** developer or AI orchestrator checking a change's state
**I want to** see any recorded escalation in `metta status` output, both human-readable and `--json`
**So that** above-recommendation routing is visible in the normal course of work rather than buried in raw YAML

**Priority:** P2
**Independent Test Criteria:** Run `metta status` (and `metta status --json`) against a change whose metadata carries an `escalation` object and observe the escalation details in both outputs.

**Acceptance Criteria:**
- **Given** a change with a persisted `escalation` object **When** `metta status` renders human output **Then** the escalation's from/to tiers and justification are displayed
- **Given** the same change **When** `metta status --json` runs **Then** the JSON output includes the `escalation` field with its recorded values
- **Given** a change with no `escalation` field **When** `metta status` runs in either mode **Then** output renders normally with no escalation section

---

## US-4: The propose skill routes small changes to quick mode

**As a** skill-driven AI orchestrator invoking metta-propose with a change description
**I want to** have the skill classify small, bounded descriptions (single-file edits, typo fixes, localized bug fixes, small self-contained utilities) and route them to `metta quick` before starting standard ceremony
**So that** trivial work reaches the lightweight path by default instead of requiring the caller to already know about quick mode

**Priority:** P1
**Independent Test Criteria:** Inspect the metta-propose skill template and confirm it contains a routing pre-step, executed before existing Step 1, that routes small/bounded descriptions without an explicit `--workflow` flag to quick mode.

**Acceptance Criteria:**
- **Given** a description matching small/bounded criteria and no explicit `--workflow` flag from the caller **When** the metta-propose skill runs its routing pre-step **Then** the orchestrator is directed to `metta quick` instead of the standard proposal pipeline
- **Given** a caller who passes an explicit `--workflow` flag **When** the skill runs **Then** the routing pre-step defers to the caller's choice
- **Given** an orchestrator explicitly choosing `--workflow standard` or `--workflow full` **When** it follows the skill and the project's CLAUDE.md workflow guidance **Then** it is instructed that escalation above quick-by-default routing requires justification

---

## US-5: Ceremony cost is visible as a commit ratio

**As a** developer auditing project health
**I want to** see a ceremony commit ratio (chore/docs commits versus total commits) in `metta progress` output
**So that** the cost of over-routed ceremony is quantified in an existing surface instead of requiring a manual archive audit

**Priority:** P2
**Independent Test Criteria:** Run `metta progress` (and `metta progress --json`) in a repository with a mix of chore/docs and functional commits and observe a ceremony-commit-ratio metric in both output modes.

**Acceptance Criteria:**
- **Given** a repository with git history containing chore/docs and functional commits **When** `metta progress` runs **Then** the human output reports the ceremony commit ratio computed from `git log`
- **Given** the same repository **When** `metta progress --json` runs **Then** the JSON output includes the ceremony-commit-ratio metric

---

## US-6: Small-change artifact overhead is measured

**As a** developer evaluating whether ceremony actually scales with change size
**I want to** see the mean artifact count for archived changes that finished on the `quick` or `trivial` tier reported by `metta progress`
**So that** I can verify small changes are producing few artifacts over time rather than discovering ceremony bloat by hand

**Priority:** P3
**Independent Test Criteria:** Run `metta progress` against a project whose `spec/archive/` contains changes finished on the `quick` or `trivial` tier and observe an artifacts-per-small-change metric in both human and `--json` output.

**Acceptance Criteria:**
- **Given** archived changes in `spec/archive/` that finished on the `quick` or `trivial` tier **When** `metta progress` runs **Then** both human and `--json` output report the mean artifact count for those changes
- **Given** an archive with no quick/trivial-tier changes **When** `metta progress` runs **Then** the metric renders without error, indicating no data rather than a misleading number
