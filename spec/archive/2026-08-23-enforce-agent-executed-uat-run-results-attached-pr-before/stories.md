<!--
User stories for this change.

Format: one `## US-N:` block per story with six bold-label fields
(**As a**, **I want to**, **So that**, **Priority:**, **Independent Test Criteria:**,
**Acceptance Criteria:**) followed by one or more Given/When/Then bullets.
Story IDs MUST be monotonic starting at US-1.
-->

# enforce-agent-executed-uat-run-results-attached-pr-before — User Stories

## US-1: Reviewer receives PRs with UAT evidence attached

**As a** PR reviewer on a metta-managed project
**I want to** see the change's UAT run results (pass/fail/skip counts and per-failed-step details) directly in the PR body or a PR comment
**So that** I can judge whether the change meets its own generated acceptance criteria without cloning the branch or trusting an unverified "ready" claim
**Priority:** P1
**Independent Test Criteria:** A PR created by any ship-path skill contains a UAT run summary (counts plus failed-step details and skip reasons) in its body or as a comment, generated from an actual agent-executed run of the archived UAT.md.

**Acceptance Criteria:**
- **Given** a change reaches the ship step and `metta finalize` has archived its UAT.md **When** the ship-path skill runs `gh pr create` **Then** the PR body includes the UAT run summary with pass/fail/skip counts, details for each failed step, and reasons for each skipped step
- **Given** a PR for the change already exists **When** the ship-path skill completes the UAT run **Then** the run summary is attached as a `gh pr comment` on the existing PR instead of being lost
- **Given** the archived UAT.md has never been executed **When** the skill reaches the hand-back point **Then** it does not present the PR as ready without first spawning the metta-uat-runner subagent against the archived UAT.md

---

## US-2: Failing UAT blocks hand-back as ready

**As a** project owner receiving "ready" PRs from AI-driven ship skills
**I want to** have any failing UAT step block the hand-back, mirroring how red CI blocks merge
**So that** a change that fails its own acceptance script can never be presented to me as ready or silently merged
**Priority:** P1
**Independent Test Criteria:** When at least one machine-verified UAT step fails, the ship-path skill reports the failures and stops — the PR remains open and flagged, no merge occurs, and the change is not declared ready.

**Acceptance Criteria:**
- **Given** the agent-executed UAT run records at least one failed step **When** the ship-path skill evaluates readiness **Then** it reports the failures, leaves the PR open and flagged, and stops without merging or declaring the change ready
- **Given** all machine-verified UAT steps pass **When** the skill evaluates readiness **Then** the change proceeds to hand-back (or merge, on run-to-merge paths) with the passing summary attached

---

## US-3: Run-to-merge paths gated before merge

**As a** consumer of the run-to-merge skills (quick, auto, fix-issues, fix-gap)
**I want to** have the mandatory UAT run sit inside the create-to-merge window, before the merge step
**So that** changes on fast paths cannot land on main with an untouched UAT document and zero acceptance evidence
**Priority:** P1
**Independent Test Criteria:** On each run-to-merge skill, the UAT execution step is ordered after `metta finalize` and before the merge step, and a UAT failure on these paths prevents the merge from happening.

**Acceptance Criteria:**
- **Given** a quick/auto/fix-issues/fix-gap run has finalized and opened its PR **When** the skill reaches its merge step **Then** the UAT run has already executed and its results are attached to the PR before any merge command runs
- **Given** the UAT run on a run-to-merge path reports a failure **When** the skill would otherwise merge **Then** the merge is skipped, the PR stays open flagged with the failure summary, and the skill stops

---

## US-4: Manual acceptance steps skip without blocking

**As a** developer shipping changes whose UAT.md contains human-only acceptance steps
**I want to** have manual-acceptance steps reported as skipped with reasons rather than treated as failures
**So that** the automated gate never deadlocks the ship path on steps an agent cannot legitimately verify
**Priority:** P2
**Independent Test Criteria:** A UAT.md containing only manual-acceptance steps (or a mix where all machine-verified steps pass) results in a non-blocking run whose summary lists each manual step as skipped with a stated reason.

**Acceptance Criteria:**
- **Given** the archived UAT.md contains manual-acceptance steps **When** the metta-uat-runner executes the script **Then** those steps are marked skipped with reasons in the run summary and do not count as failures
- **Given** all machine-verified steps pass and one or more manual steps are skipped **When** the skill evaluates readiness **Then** hand-back proceeds and the skip reasons are visible in the PR summary

---

## US-5: Audit trail rides the change branch into the merge

**As a** maintainer auditing shipped changes
**I want to** have the UAT run record committed on the change branch as `docs(<change>): UAT run record` before merge
**So that** the dated archived UAT.md carries real execution evidence into main and the audit trail exists at review time, not as an optional afterthought
**Priority:** P2
**Independent Test Criteria:** After a ship-path run, the change branch contains a commit updating `spec/archive/<date>-<slug>/UAT.md` with checked results, authored via the reuse of the /metta-uat orchestration contract (runner as sole mutator, orchestrator snapshotting cleanliness and sanity-checking the diff shape).

**Acceptance Criteria:**
- **Given** the metta-uat-runner has mutated the archived UAT.md **When** the orchestrating skill validates the diff shape against its pre-run cleanliness snapshot **Then** it commits the record as `docs(<change>): UAT run record` on the change branch so the record merges to main with the change
- **Given** the runner's diff touches files outside the expected UAT.md shape **When** the orchestrator sanity-checks the diff **Then** it does not blindly commit unexpected mutations

---

## US-6: Consumers can opt out via configuration

**As a** consumer of metta on a project where ship-time UAT enforcement is not wanted
**I want to** disable the gate with a `uat.enforce_on_ship: false` config setting
**So that** I keep control over my ship path's strictness without patching skill files, while the safe default (true) protects everyone else
**Priority:** P2
**Independent Test Criteria:** With `uat.enforce_on_ship` set to false in the validated UatConfigSchema, ship-path skills skip the mandatory UAT run and hand back without it; with the setting absent, enforcement defaults to on.

**Acceptance Criteria:**
- **Given** `uat.enforce_on_ship` is explicitly set to false **When** a ship-path skill reaches the post-finalize step **Then** it proceeds to PR creation and hand-back without spawning the UAT runner
- **Given** no `uat.enforce_on_ship` value is configured **When** the strict UatConfigSchema validates config **Then** the effective value is true and the UAT gate is enforced

---

## US-7: All six ship-path skill pairs stay compliant

**As a** metta framework maintainer
**I want to** grep-assert tests pinning the UAT-before-handback step, with ordering assertions relative to `gh pr create` and merge steps, across all six skill pairs (template and deployed copies)
**So that** future skill edits cannot silently drop or reorder the gate on any ship path
**Priority:** P2
**Independent Test Criteria:** The test suite fails if any of the six skill pairs (metta-ship, metta-propose, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap) is missing the UAT step or has it ordered after `gh pr create`/merge where the intent requires it before.

**Acceptance Criteria:**
- **Given** the grep-assert tests are in place **When** a skill file's UAT step is removed or moved after its `gh pr create` or merge step **Then** the test suite fails and names the offending skill pair
- **Given** all twelve skill files (six pairs, template plus deployed) carry the correctly ordered UAT step and metta-ship's allowed-tools includes Agent **When** the test suite runs **Then** the ordering assertions pass
