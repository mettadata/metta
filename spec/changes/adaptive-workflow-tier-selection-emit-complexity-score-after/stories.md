<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# adaptive-workflow-tier-selection-emit-complexity-score-after — User Stories

## US-1: Trivial-change fan-out downsize in /metta-quick

**As a** developer running `/metta-quick` on a one-line tooltip tweak
**I want to** have the skill automatically reduce reviewer and verifier fan-out when the change is trivial
**So that** I spend roughly one minute and tens of KB of tokens instead of five minutes and 200 KB per trivial feature
**Priority:** P1
**Independent Test Criteria:** A `/metta-quick` invocation whose `intent.md` `## Impact` section lists a single file dispatches exactly 1 reviewer and 1 verifier subagent (tests/tsc only) instead of the default 3+3.

**Acceptance Criteria:**
- **Given** a change whose `intent.md` `## Impact` section enumerates one file **When** `/metta-quick` reaches the review/verify stage **Then** the skill spawns 1 reviewer and 1 verifier subagent and logs the downsize decision
- **Given** a change whose `intent.md` `## Impact` section enumerates four files **When** `/metta-quick` reaches the review/verify stage **Then** the skill spawns the standard 3 reviewers and 3 verifiers with no downsize applied

---

## US-2: Complexity score persisted to change metadata

**As an** AI orchestrator running `/metta-propose`
**I want to** have a `complexity_score` field written to `.metta.yaml` immediately after `intent.md` is authored
**So that** downstream skills, status commands, and future signals can read one authoritative value instead of re-parsing intent
**Priority:** P1
**Independent Test Criteria:** After the intent-authoring phase completes, the change's `.metta.yaml` file contains a validated `complexity_score` object whose `recommended_workflow` matches the file-count thresholds (≤1 trivial, 2–3 quick, 4–7 standard, 8+ full).

**Acceptance Criteria:**
- **Given** an `intent.md` with three files in its `## Impact` section **When** the scoring step fires at end of intent authoring **Then** `.metta.yaml` contains `complexity_score.recommended_workflow: quick` and `complexity_score.file_count: 3`
- **Given** an `intent.md` with nine files in its `## Impact` section **When** the scoring step fires **Then** `.metta.yaml` contains `complexity_score.recommended_workflow: full`
- **Given** an invalid `complexity_score` payload **When** the state store attempts to write `.metta.yaml` **Then** the Zod schema rejects the write with a typed error

---

## US-3: Complexity visible in `metta status`

**As a** developer running `metta status --change <name>`
**I want to** see a `Complexity:` line in human output and a `complexity_score` object in `--json` output
**So that** I can tell at a glance whether the scorer considered the change trivial, quick, standard, or full before I decide how to proceed
**Priority:** P2
**Independent Test Criteria:** `metta status --change <name>` renders a `Complexity:` line in human mode and includes a `complexity_score` object with `recommended_workflow` and `file_count` in `--json` mode.

**Acceptance Criteria:**
- **Given** a change with `complexity_score.recommended_workflow: trivial` **When** `metta status --change <name>` runs in human mode **Then** stdout contains a line like `Complexity: trivial (1 file)`
- **Given** the same change **When** `metta status --change <name> --json` runs **Then** the JSON payload contains `complexity_score.recommended_workflow: "trivial"` and `complexity_score.file_count: 1`
- **Given** a legacy change with no `complexity_score` field in `.metta.yaml` **When** `metta status --change <name>` runs **Then** the command succeeds and omits the complexity line rather than crashing

---

## US-4: Advisory banner in `metta instructions`

**As an** AI orchestrator fetching instructions via `metta instructions`
**I want to** see an advisory banner at the top of the output when the recommended workflow differs from the active workflow
**So that** I can surface the mismatch to the user without mutating routing behavior
**Priority:** P2
**Independent Test Criteria:** `metta instructions` prints a banner at the top of its output whenever `complexity_score.recommended_workflow` is present and differs from the change's active workflow.

**Acceptance Criteria:**
- **Given** a change with `complexity_score.recommended_workflow: trivial` running under the `quick` workflow **When** `metta instructions` is invoked **Then** the first lines of stdout contain an advisory banner naming both the recommended and active workflows
- **Given** a change whose recommended and active workflows match **When** `metta instructions` is invoked **Then** no advisory banner is printed
- **Given** the advisory banner is printed **When** the rest of the instructions are rendered **Then** no routing change occurs — the active workflow is unchanged

---

## US-5: `--workflow` flag overrides the advisory

**As a** developer who disagrees with the scorer's recommendation
**I want to** continue using the existing `--workflow` flag to pick my workflow
**So that** the advisory stays print-only and never blocks me from running the standard fan-out on a change the scorer called trivial
**Priority:** P1
**Independent Test Criteria:** Passing `--workflow standard` to a change whose `recommended_workflow` is `trivial` runs the standard fan-out unchanged and emits no error.

**Acceptance Criteria:**
- **Given** a change scored as `trivial` **When** the developer invokes the lifecycle with `--workflow standard` **Then** the standard fan-out (3 reviewers, 3 verifiers) runs and the advisory is logged but not enforced
- **Given** a change scored as `full` **When** the developer invokes `/metta-quick` with no override **Then** the quick skill still runs (advisory is print-only) and dispatches its default fan-out

---

## US-6: Scoring rubric documented in spec/specs/

**As a** framework maintainer planning to add line-delta or spec-surface signals later
**I want to** find the current scoring rubric, thresholds, and signal list in a dedicated spec doc under `spec/specs/`
**So that** I can extend the rubric without reverse-engineering behavior from the skill template
**Priority:** P3
**Independent Test Criteria:** `spec/specs/` contains a rubric document listing the v1 signal (file count), the four thresholds (trivial ≤1, quick 2–3, standard 4–7, full 8+), and the storage field name, and `CLAUDE.md` Active Specs references it.

**Acceptance Criteria:**
- **Given** the change lands **When** a maintainer greps `spec/specs/` for the rubric file **Then** it exists and documents the file-count signal, the four thresholds, and the `complexity_score` field name
- **Given** the rubric file exists **When** `CLAUDE.md` is regenerated **Then** the Active Specs table lists the new capability with its requirement count

---
