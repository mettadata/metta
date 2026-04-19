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
**Independent Test Criteria:** A `/metta-quick` invocation whose `intent.md` `## Impact` section lists a single file dispatches exactly 1 quality reviewer and 1 tests/tsc verifier instead of the default 3 reviewers and 3 verifiers.

**Acceptance Criteria:**
- **Given** a change whose `intent.md` `## Impact` section enumerates one file **When** `/metta-quick` reaches the review/verify stage **Then** the skill spawns 1 quality reviewer and 1 tests/tsc verifier and logs the downsize decision
- **Given** a trivially-scored `/metta-quick` run **When** the fan-out executes **Then** no correctness reviewer, no security reviewer, and no dedicated goal-check verifier are spawned, while tests and tsc still run on the change
- **Given** a change whose `intent.md` `## Impact` section enumerates four files **When** `/metta-quick` reaches the review/verify stage **Then** the skill spawns the standard 3 reviewers and 3 verifiers with no downsize applied

---

## US-2: Auto-downscale prompt on oversized propose/fix-issues runs

**As a** developer running `/metta-propose` or `/metta-fix-issues` on a change that turns out to be trivial
**I want to** be prompted `[y/N]` after intent is written to collapse the workflow to `/metta-quick`
**So that** I can drop unnecessary planning artifacts (stories, spec, research, design, tasks) when the scorer indicates they are not warranted
**Priority:** P1
**Independent Test Criteria:** When `metta propose` or `metta fix-issues` finishes writing `intent.md` for a single-file change under a `standard` or `full` workflow, a `[y/N]` prompt appears; answering `y` mutates `.metta.yaml` `workflow` to `quick` and removes planning artifacts from the artifact list.

**Acceptance Criteria:**
- **Given** `metta propose` has just written `intent.md` and the scored tier is lower than the chosen workflow **When** scoring completes **Then** the CLI prints `Scored as <tier> (N files) — collapse workflow to /metta-quick? [y/N]` with default No
- **Given** the downscale prompt is visible **When** the user answers `y` **Then** `.metta.yaml` `workflow` is updated to `quick` and planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list
- **Given** the downscale prompt is visible **When** the user answers `n` or presses enter **Then** the original workflow is preserved and no artifacts are removed
- **Given** the chosen workflow already equals or is smaller than the recommendation **When** intent is written **Then** no downscale prompt appears
- **Given** the run is non-TTY or `--json` mode **When** the scorer fires **Then** the prompt is suppressed, No is assumed, and the advisory banner still prints

---

## US-3: Auto-upscale warning when implementation touched more files than the workflow covers

**As a** developer running `/metta-quick` on a change that turns out to be bigger than expected
**I want to** see a warning at `metta complete implementation` time if the actual file count exceeded the chosen workflow tier
**So that** I learn to use `/metta-propose` next time and the overshoot is persisted for retrospection
**Priority:** P2
**Independent Test Criteria:** When `metta complete implementation` writes `summary.md` for a `/metta-quick` run whose `## Files` section lists 5 distinct files, the command prints a tier-jump warning and persists `actual_complexity_score` to `.metta.yaml` without blocking finalize.

**Acceptance Criteria:**
- **Given** a `/metta-quick` change whose `summary.md` `## Files` section lists 5 distinct files **When** `metta complete implementation` runs **Then** the output begins with `Warning: this change touched 5 files — standard workflow was recommended; finalize will proceed on quick`
- **Given** the recompute ran **When** `.metta.yaml` is inspected **Then** `actual_complexity_score` is present with `score`, `signals.file_count`, and `recommended_workflow`, and the original `complexity_score` is unchanged
- **Given** the recomputed tier equals or is lower than the chosen workflow **When** `metta complete implementation` runs **Then** no warning is printed and `actual_complexity_score` is still written silently
- **Given** any recompute **When** `metta complete implementation` finishes **Then** finalize is not blocked and the command returns success

---

## US-4: Advisory banner at top of `metta instructions`

**As a** AI orchestrator calling `metta instructions` during planning
**I want to** see a one-line advisory banner at the top of the output when a complexity score is present
**So that** I can factor the recommendation into tier and routing decisions without opening additional artifacts
**Priority:** P2
**Independent Test Criteria:** `metta instructions` prints `Advisory: complexity scored as <tier> (N files) — recommended workflow: <workflow>` as the first line of output whenever `complexity_score` is persisted, and omits the banner when it is absent.

**Acceptance Criteria:**
- **Given** a change with `complexity_score: {score: 1, signals: {file_count: 3}, recommended_workflow: quick}` **When** `metta instructions` runs **Then** the first line of stdout is `Advisory: complexity scored as quick (3 files) — recommended workflow: quick`
- **Given** a change with no `complexity_score` (intent not yet written) **When** `metta instructions` runs **Then** no advisory banner is printed and the rest of the output is unchanged
- **Given** the advisory banner prints **When** the rest of the instructions are rendered **Then** no routing change occurs and execution is not blocked

---

## US-5: Complexity visible in `metta status` human and JSON output

**As a** developer running `metta status --change <name>`
**I want to** see the complexity score alongside the existing artifact state in both human and JSON output
**So that** I can tell at a glance whether the scorer considered the change trivial, quick, standard, or full
**Priority:** P2
**Independent Test Criteria:** `metta status --change <name>` renders a `Complexity:` line in human mode and includes a full `complexity_score` object (with `score`, `signals.file_count`, `recommended_workflow`) in `--json` mode whenever the score is persisted.

**Acceptance Criteria:**
- **Given** a change with `complexity_score.recommended_workflow: trivial` and `signals.file_count: 1` **When** `metta status --change <name>` runs in human mode **Then** stdout contains a line like `Complexity: trivial (1 file) — recommended: trivial`
- **Given** the same change **When** `metta status --change <name> --json` runs **Then** the JSON payload contains the full `complexity_score` object with `score`, `signals.file_count`, and `recommended_workflow`
- **Given** a change that also has `actual_complexity_score` persisted **When** `metta status --change <name> --json` runs **Then** both `complexity_score` and `actual_complexity_score` are present in the JSON payload

---

## US-6: `--workflow` flag continues to override the advisory

**As a** developer who disagrees with the scorer's recommendation
**I want to** continue using the existing `--workflow <tier>` flag on `metta propose` to pin a tier
**So that** the advisory stays print-only and the auto-downscale prompt never second-guesses my explicit choice
**Priority:** P2
**Independent Test Criteria:** Passing `--workflow standard` on a change that scores as `trivial` runs the standard fan-out unchanged, suppresses the downscale prompt, and still persists the advisory score.

**Acceptance Criteria:**
- **Given** `metta propose --workflow standard` for a trivially-scored change **When** intent.md is written **Then** the auto-downscale prompt is suppressed and the chosen `standard` workflow is preserved
- **Given** the same invocation **When** scoring completes **Then** `complexity_score` is still persisted and the advisory banner still prints via `metta instructions`
- **Given** `--workflow` is absent **When** a lower tier is recommended **Then** the downscale prompt appears as defined in US-2

---

## US-7: `metta status` handles absent score without crashing

**As a** developer running `metta status` before intent.md has been written
**I want to** see the change listed with a null / empty complexity state rather than an error
**So that** early-lifecycle status checks and legacy pre-feature changes never crash on absent metadata
**Priority:** P3
**Independent Test Criteria:** `metta status --change <name>` on a change with no `complexity_score` in `.metta.yaml` exits 0, renders an empty-state line in human mode, and returns `"complexity_score": null` (or omitted per schema) in `--json` mode without throwing a Zod validation error.

**Acceptance Criteria:**
- **Given** a newly scaffolded change with no intent.md and no `complexity_score` **When** `metta status --change <name>` runs **Then** the command exits 0 and the human output shows an empty or `not yet scored` complexity state
- **Given** the same change **When** `metta status --change <name> --json` runs **Then** the JSON payload includes `"complexity_score": null` (or omits the field per schema) without a Zod validation error
- **Given** a legacy `.metta.yaml` that predates this feature and has no `complexity_score` field **When** any `ArtifactStore` read path loads it **Then** the load succeeds and downstream renderers treat the score as absent

---

## US-8: Scoring rubric documented under `spec/specs/` for future signals

**As a** framework maintainer planning to add line-delta or spec-surface signals later
**I want to** find the current scoring rubric, thresholds, and signal list in a dedicated spec document under `spec/specs/`
**So that** I can extend the rubric without reverse-engineering behavior from the skill template or the executor
**Priority:** P3
**Independent Test Criteria:** `spec/specs/` contains a rubric document listing the v1 signal (file count), the four tier thresholds (trivial ≤1, quick 2–3, standard 4–7, full 8+), and the `complexity_score` storage field name; `CLAUDE.md` Active Specs table lists the new capability.

**Acceptance Criteria:**
- **Given** the change lands **When** a maintainer browses `spec/specs/` **Then** a rubric document exists documenting the file-count signal, the four tier thresholds, and the `complexity_score` / `actual_complexity_score` storage field names
- **Given** the rubric file exists **When** `CLAUDE.md` is regenerated **Then** the Active Specs table lists the new rubric capability with its requirement count
- **Given** a maintainer reads the rubric **When** they look for extension guidance **Then** the document explicitly names the deferred signals (spec-surface, capability-count, line-delta) as extension points rather than silent omissions

---
