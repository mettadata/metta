<!--
User stories for this change.
Format: one `## US-N:` block per story with six bold-label fields.
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
**I want to** be prompted `[y/N]` after intent is written to collapse the workflow to a smaller tier
**So that** I can drop unnecessary planning artifacts (stories, spec, research, design, tasks) when the scorer indicates they are not warranted
**Priority:** P1
**Independent Test Criteria:** When `metta propose` or `metta fix-issues` finishes writing `intent.md` for a single-file change under a `standard` or `full` workflow, a `[y/N]` prompt appears; answering `y` mutates `.metta.yaml` `workflow` to the recommended smaller tier and removes unstarted planning artifacts from the artifact list.

**Acceptance Criteria:**
- **Given** `metta propose --workflow standard` has just written `intent.md` and the scored tier is `trivial` **When** scoring completes **Then** the CLI prints `Scored as trivial (1 files) -- collapse workflow to /metta-trivial? [y/N]` with default No
- **Given** the downscale prompt is visible **When** the user answers `y` **Then** `.metta.yaml` `workflow` is updated to the recommended tier and unstarted planning artifacts (stories, spec, research, design, tasks) are removed from the change's artifact list
- **Given** the chosen workflow already equals or is smaller than the recommendation **When** intent is written **Then** no downscale prompt appears and exit code is 0

---

## US-3: Auto-upscale prompt on undersized propose/quick runs at intent time

**As a** developer running `/metta-quick` or `/metta-propose --workflow quick` on a change whose intent reveals broader scope
**I want to** be prompted `[y/N]` after intent is written to promote the workflow to a larger tier
**So that** the required planning artifacts (stories, spec, research, design, tasks) get authored before implementation rather than left as silent gaps
**Priority:** P1
**Independent Test Criteria:** When `metta quick` or `metta propose` writes `intent.md` for a change whose `## Impact` section lists 5 files under a `quick` workflow, a `[y/N]` prompt appears; answering `y` mutates `.metta.yaml` `workflow` to `standard` and inserts the missing planning artifacts from the standard workflow YAML definition into the artifact list.

**Acceptance Criteria:**
- **Given** `metta quick` has just written `intent.md` listing 5 files and the scored tier is `standard` **When** scoring completes **Then** the CLI prints `Scored as standard (5 files) -- promote workflow to /metta-standard? [y/N]` with default No
- **Given** the upscale prompt is visible **When** the user answers `y` **Then** `.metta.yaml` `workflow` is updated to `standard` and the stages present in the standard workflow YAML definition but absent from the current artifact list (stories, spec, research, design, tasks) are inserted as pending artifacts before implementation runs
- **Given** the chosen workflow already equals or exceeds the recommendation **When** intent is written **Then** no upscale prompt appears and exit code is 0

---

## US-4: Post-implementation upscale prompt -- accept path retroactively authors stories + spec

**As a** developer whose `/metta-quick` run grew mid-implementation into a multi-file change
**I want to** be prompted at `metta complete implementation` time to promote the workflow and retroactively author `stories.md` + `spec.md`
**So that** the archived change carries the planning artifacts the spec store depends on instead of landing under-specified
**Priority:** P1
**Independent Test Criteria:** When `metta complete implementation` writes `summary.md` for a `/metta-quick` change whose `## Files` section lists 5 distinct files, a `[y/N]` prompt appears; answering `y` updates `.metta.yaml` `workflow` to `standard`, spawns product + specifier agents that write `stories.md` and `spec.md`, marks both artifacts `complete` in the artifact list, and causes the subsequent review and verify spawns to use the standard fan-out (3 reviewers + 3 verifiers).

**Acceptance Criteria:**
- **Given** a `/metta-quick` change whose `summary.md` `## Files` section lists 5 files **When** `metta complete implementation` runs **Then** the CLI prints `Implementation touched 5 files -- promote to /metta-standard and retroactively author stories + spec? [y/N]` with default No
- **Given** the user answers `y` **When** the retroactive path runs to completion **Then** `.metta.yaml` `workflow` equals `standard`, `stories.md` and `spec.md` exist in the change directory with content authored by the metta-product and metta-specifier agents, both artifacts are marked `complete` in the artifact list, and `actual_complexity_score` is persisted
- **Given** the retroactive path completed **When** the skill orchestrator spawns review and verify **Then** the fan-out matches the standard tier (3 reviewers + 3 verifiers) rather than the trivial/quick fan-out

---

## US-5: Post-implementation upscale prompt -- decline path preserves original workflow

**As a** developer who acknowledges the tier jump but does not want to retroactively author planning artifacts
**I want to** answer `n` at the post-implementation upscale prompt and have verification proceed on the original workflow
**So that** I can accept the advisory record without being forced into a retroactive spawn
**Priority:** P2
**Independent Test Criteria:** When the post-implementation upscale prompt is answered `n` (or in non-TTY mode), `actual_complexity_score` is persisted to `.metta.yaml`, a warning is printed, the `workflow` field is unchanged, no retroactive agent spawn occurs, and verification proceeds on the original workflow with a success exit code.

**Acceptance Criteria:**
- **Given** the post-implementation upscale prompt is visible **When** the user answers `n` **Then** stdout contains `Warning: this change touched 5 files -- standard workflow was recommended; finalize will proceed on quick`, `.metta.yaml` `workflow` remains `quick`, and `actual_complexity_score` is persisted with `score`, `signals.file_count`, and `recommended_workflow`
- **Given** the decline path ran **When** the artifact list is inspected **Then** `stories.md` and `spec.md` were not created and no product or specifier agent was spawned
- **Given** the decline path ran **When** `metta complete implementation` returns **Then** the exit code is 0 and verification proceeds unchanged on the original workflow

---

## US-6: `--auto` flag auto-accepts all routing prompts

**As a** AI orchestrator running `metta propose`, `metta quick`, or `metta fix-issues` in an automated loop
**I want to** pass `--auto` once at invocation time to auto-accept every adaptive-routing recommendation
**So that** the lifecycle never blocks on an interactive prompt and the workflow converges on the scorer's tier recommendation without human input
**Priority:** P1
**Independent Test Criteria:** Passing `--auto` to `metta propose`, `metta quick`, or `metta fix-issues` persists `auto_accept_recommendation: true` in `.metta.yaml`; all three adaptive prompts (intent-time downscale, intent-time upscale, post-implementation upscale) skip the prompt and behave as if Yes was chosen.

**Acceptance Criteria:**
- **Given** `metta propose --auto --workflow standard` for a trivially-scored change **When** intent is written **Then** `.metta.yaml` contains `auto_accept_recommendation: true`, no downscale prompt is printed to stdout, and the `workflow` field is updated to the recommended smaller tier
- **Given** `metta quick --auto` for a change that scores `standard` **When** intent is written **Then** no upscale prompt is printed, the `workflow` field is updated to `standard`, and the missing planning artifacts are inserted into the artifact list
- **Given** a change with `auto_accept_recommendation: true` **When** `metta complete implementation` runs and the recomputed tier exceeds the chosen workflow **Then** no post-implementation prompt is printed, the retroactive product + specifier spawn runs to completion, and `stories.md` + `spec.md` exist before the command returns

---

## US-7: Advisory banner at top of `metta instructions`

**As a** AI orchestrator calling `metta instructions` during planning
**I want to** see a one-line advisory banner at the top of the output reflecting agreement, downscale, or upscale state
**So that** I can factor the recommendation into tier and routing decisions without opening additional artifacts
**Priority:** P2
**Independent Test Criteria:** `metta instructions` prints an `Advisory:` line as the first line of output whenever `complexity_score` is persisted, with the banner text reflecting agreement / downscale-recommended / upscale-recommended, and omits the banner when the score is absent.

**Acceptance Criteria:**
- **Given** a change with `workflow: quick` and `complexity_score.recommended_workflow: quick` **When** `metta instructions` runs **Then** the first line of stdout is `Advisory: current workflow quick matches recommendation quick`
- **Given** a change with `workflow: standard` and `complexity_score.recommended_workflow: trivial` **When** `metta instructions` runs **Then** the first line of stdout is `Advisory: current standard, scored trivial -- downscale recommended`
- **Given** a change with no `complexity_score` (intent not yet written) **When** `metta instructions` runs **Then** no advisory banner is printed and execution is not blocked

---

## US-8: Complexity visible in `metta status` human and JSON output

**As a** developer running `metta status --change <name>`
**I want to** see the complexity score alongside the existing artifact state in both human and JSON output
**So that** I can tell at a glance whether the scorer considered the change trivial, quick, standard, or full
**Priority:** P2
**Independent Test Criteria:** `metta status --change <name>` renders a `Complexity:` line in human mode and includes a full `complexity_score` object (with `score`, `signals.file_count`, `recommended_workflow`) in `--json` mode whenever the score is persisted.

**Acceptance Criteria:**
- **Given** a change with `complexity_score.recommended_workflow: trivial` and `signals.file_count: 1` **When** `metta status --change <name>` runs in human mode **Then** stdout contains a line like `Complexity: trivial (1 file) -- recommended: trivial`
- **Given** the same change **When** `metta status --change <name> --json` runs **Then** the JSON payload contains the full `complexity_score` object with `score`, `signals.file_count`, and `recommended_workflow`
- **Given** a change that also has `actual_complexity_score` persisted **When** `metta status --change <name> --json` runs **Then** both `complexity_score` and `actual_complexity_score` are present in the JSON payload

---

## US-9: `--workflow` override preserves initial choice, `--auto` only fires on recomputation

**As a** developer who disagrees with the scorer's initial recommendation
**I want to** pin the initial tier with `--workflow <tier>` while still opting into automated acceptance of subsequent recomputations via `--auto`
**So that** my initial choice is honoured at invocation time and `--auto` only applies to later adaptive shifts away from that choice
**Priority:** P2
**Independent Test Criteria:** Passing `--workflow standard --auto` starts the change on the standard workflow regardless of the scored tier at intent time; if a later recomputation (post-implementation) recommends a different tier, `--auto` auto-accepts that shift.

**Acceptance Criteria:**
- **Given** `metta propose --workflow standard --auto` for a trivially-scored change **When** intent is written **Then** the `workflow` field in `.metta.yaml` is `standard` (not the recommended smaller tier) because `--workflow` pins the initial choice
- **Given** the same invocation continues through implementation **When** `metta complete implementation` runs and the recomputed tier differs from `standard` **Then** `--auto` auto-accepts the post-implementation recommendation and no interactive prompt is printed
- **Given** `--workflow` is passed without `--auto` **When** a lower tier is recommended at intent time **Then** the downscale prompt appears normally as defined in US-2

---

## US-10: `metta status` handles absent score without crashing

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

## US-11: Scoring rubric documented under `spec/specs/` for future signals

**As a** framework maintainer planning to add line-delta or spec-surface signals later
**I want to** find the current scoring rubric, thresholds, prompt behaviour, and retroactive authoring logic in a dedicated spec document under `spec/specs/`
**So that** I can extend the rubric without reverse-engineering behavior from the skill template or the executor
**Priority:** P3
**Independent Test Criteria:** `spec/specs/` contains a rubric document listing the v1 signal (file count), the four tier thresholds (trivial <=1, quick 2-3, standard 4-7, full 8+), the four prompt modes (intent-downscale, intent-upscale, post-impl-upscale, intra-quick-downsize), and the `complexity_score` / `actual_complexity_score` / `auto_accept_recommendation` storage field names; `CLAUDE.md` Active Specs table lists the new capability.

**Acceptance Criteria:**
- **Given** the change lands **When** a maintainer browses `spec/specs/` **Then** a rubric document exists documenting the file-count signal, the four tier thresholds, the four prompt modes, and the three storage field names
- **Given** the rubric file exists **When** `CLAUDE.md` is regenerated **Then** the Active Specs table lists the new rubric capability with its requirement count
- **Given** a maintainer reads the rubric **When** they look for extension guidance **Then** the document explicitly names the deferred signals (spec-surface, capability-count, line-delta) and the deferred retroactive artifacts (research, design, tasks) as extension points rather than silent omissions

---
