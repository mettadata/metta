# Artifacts — Template Reference

Reference for the 11 artifact templates under [`src/templates/artifacts/`](../../src/templates/artifacts/). Each template is the authoring skeleton a `metta-*` subagent fills in when a workflow stage runs. The rendered artifact is written under `spec/changes/<slug>/` and becomes input for downstream stages.

This doc is the per-template reference. For how templates compose into stage sequences, see [`workflows.md`](workflows.md). For which agent owns each template, see [`agents.md`](agents.md). For the gates that fire on artifacts before downstream stages consume them, see [`gates.md`](gates.md).

## Notes on applicability

- **`stories.md` is used only by the `standard` workflow.** Neither `quick` nor `full` includes a `stories` stage. User stories are a medium-ceremony concept; `quick` skips planning entirely, and `full` uses a different authoring path (`domain-research` → `intent` → `spec` directly, with UX details deferred to `ux-spec.md`).
- **`execute.md` is the template for the `implementation` stage.** The stage id is `implementation`, the template file is `execute.md`. All three workflows use it.
- **`verify.md` is the template for the `verification` stage.** The stage id is `verification`, the template file is `verify.md`. All three workflows use it.
- Placeholders use `{snake_case}` or `{Option|Other}` syntax. A `{Option|Other}` placeholder is a required choice among literal values. A `{snake_case}` placeholder is freeform prose the agent must author.
- Placeholder content like `"intent stub"` or `"summary stub"` is explicitly forbidden. Artifacts must carry real content authored by the matching subagent — see the `metta complete` issue history referenced in [`README.md`](README.md).

Artifacts below are ordered by their position in the most comprehensive workflow (`full`), with `stories.md` inserted between `intent` and `spec` where the `standard` workflow places it.

---

## `domain-research.md`

**Used by stages:** `domain-research` (in `full` only)
**Owning agent:** `metta-researcher` — see [`agents.md`](agents.md)
**Purpose:** Captures the domain, competitive, and technology landscape before intent is authored. Used at the very front of the `full` workflow to ground a complex system change in market and prior-art context so that the `intent` stage can articulate scope against real alternatives rather than in a vacuum. This is the only artifact in any workflow with no upstream `requires`.

**Required sections** (verbatim, in order):
1. `## Domain Overview`
2. `## Competitive Landscape`
3. `## Technology Landscape`
4. `## Key Findings`
5. `## Implications for Intent`

**Placeholders used:**
- `{change_name}` (H1 title)
- `{domain_overview_description}`
- `{competitive_landscape_analysis}`
- `{technology_landscape_survey}`
- `{key_findings_summary}`
- `{implications_for_intent}`

**Downstream consumers:** `intent` (declared via `requires: [domain-research]` in `full.yaml`). The intent author reads the `Implications for Intent` section to frame scope.

---

## `intent.md`

**Used by stages:** `intent` (in `quick`, `standard`, and `full`)
**Owning agent:** `metta-proposer` — see [`agents.md`](agents.md)
**Purpose:** The entry-point artifact for every change. Declares the problem, the proposal, the impact on existing functionality, and an explicit out-of-scope list. This is the human-readable charter for the change and the only artifact produced by the `quick` workflow before implementation begins. All three workflows start here (or, in `full`, the second stage after `domain-research`).

**Required sections** (verbatim, in order):
1. `## Problem`
2. `## Proposal`
3. `## Impact`
4. `## Out of Scope`

**Placeholders used:**
- `{change_name}` (H1 title)

The four body sections are authored as freeform prose answering the prompt under each heading (`What problem does this solve? Who is affected?`, `What are we changing? Be specific about scope.`, `What existing functionality is affected?`, `What are we explicitly NOT doing?`). No `{snake_case}` tokens appear in the body — the prompts themselves are the scaffolding.

**Downstream consumers:**
- In `quick`: `implementation` (`requires: [intent]`).
- In `standard`: `stories` (`requires: [intent]`).
- In `full`: `spec` (`requires: [intent]`).

---

## `stories.md`

**Used by stages:** `stories` (in `standard` only — absent from `quick` and `full`)
**Owning agent:** `metta-product` — see [`agents.md`](agents.md)
**Purpose:** User stories for the change in As-a / I-want-to / So-that form, each with a priority, independent test criteria, and Given/When/Then acceptance criteria. Bridges the prose of `intent.md` to the RFC-2119 requirement statements of `spec.md`. Exists only in the `standard` workflow because user-facing feature work is the standard case; internal changes skip stories via the explicit justification escape hatch in the template.

**Required sections** (verbatim, in order):
1. `# {{change_name}} — User Stories` (H1 title, not a `##` header)
2. `## US-1: <short title>`
3. `## US-2: <next title>`

Story IDs MUST be monotonic starting at US-1. Each `## US-N:` block carries six bold-label fields (`**As a**`, `**I want to**`, `**So that**`, `**Priority:**`, `**Independent Test Criteria:**`, `**Acceptance Criteria:**`) followed by one or more Given/When/Then bullets. The template also supplies an escape hatch for internal/infrastructure changes: the literal text `No user stories — internal/infrastructure change` followed by `**Justification:** <one sentence explaining why>`.

**Placeholders used:**
- `{{change_name}}` (H1 title — note the double braces, a stylistic divergence from other templates)
- `<short title>` / `<next title>` (story headers)
- `<user role>`, `<goal>`, `<value>` (As/I-want/So-that fields)
- `<one sentence describing a verifiable outcome>` (Independent Test Criteria)
- `<precondition>`, `<action>`, `<expected outcome>` (Given/When/Then bullets)
- `<one sentence explaining why>` (justification escape hatch)

**Downstream consumers:** `spec` (`requires: [stories]` in `standard.yaml`). The `stories-valid` gate fires at the `spec` stage to confirm story structure before spec authoring proceeds.

---

## `spec.md`

**Used by stages:** `spec` (in `standard` and `full`)
**Owning agent:** `metta-proposer` — see [`agents.md`](agents.md)
**Purpose:** Formal requirements for the change in the living-spec delta format. Each requirement is tagged as ADDED, MODIFIED, or REMOVED relative to the corresponding capability spec under `spec/specs/`, stated in RFC 2119 keywords (MUST / SHOULD / MAY), and backed by at least one Given/When/Then scenario. The spec is the contract against which verification is measured — the `verification` stage checks every scenario.

**Required sections** (verbatim, in order):
1. `## {ADDED|MODIFIED|REMOVED}: Requirement: {requirement_name}`
2. `### Scenario: {scenario_name}`

The template shows a single requirement and a single scenario. Real specs repeat the pair N times — one `## {ADDED|MODIFIED|REMOVED}: Requirement:` block per requirement, one or more `### Scenario:` blocks per requirement.

**Placeholders used:**
- `{capability_name}` (H1 title — matches a capability under `spec/specs/`)
- `{ADDED|MODIFIED|REMOVED}` (required choice; labels the delta direction)
- `{requirement_name}`
- `{requirement_text using RFC 2119 keywords}`
- `{scenario_name}`
- `{precondition}`, `{action}`, `{expected_outcome}` (Given/When/Then bullets)

**Downstream consumers:**
- `research` (`requires: [spec]` in both `standard` and `full`). Research explores how to implement the stated requirements.
- `verification` (transitive; the verifier iterates the spec's scenarios as a checklist).
- `spec/specs/` merge during ship — the change's spec delta is reconciled into the living capability spec on `/metta-ship`.

The `spec-quality` gate fires on this artifact. In `standard`, `stories-valid` also fires.

---

## `research.md`

**Used by stages:** `research` (in `standard` and `full`)
**Owning agent:** `metta-researcher` — see [`agents.md`](agents.md)
**Purpose:** Decision record for the chosen implementation approach. Lists the approaches considered, marks the selected one, records the rationale, and lists subsidiary artifacts produced during research (API contracts, data models, flow diagrams) under `contracts/`, `schemas/`, and `diagrams/` subdirectories of the change folder.

**Required sections** (verbatim, in order):
1. `## Decision: {chosen_approach}`
2. `### Approaches Considered`
3. `### Rationale`
4. `### Artifacts Produced`

**Placeholders used:**
- `{change_name}` (H1 title)
- `{chosen_approach}` (names the winning approach in the H2)
- `{approach_1}`, `{approach_2}` (named candidates)
- `{rationale}` (selected-approach rationale inline)
- `{reason_not_selected}` (for non-selected candidates)
- `{why_this_approach}` (expanded rationale)
- `{name}` and `{slug}` (repeated in the Artifacts Produced list — link text and file slug)

**Downstream consumers:** `design` (`requires: [research]` in both `standard` and `full`). The design author inherits the chosen approach and elaborates components, data model, and API against it.

---

## `design.md`

**Used by stages:** `design` (in `standard` and `full`)
**Owning agent:** `metta-architect` — see [`agents.md`](agents.md)
**Purpose:** High-level design for the change: approach, components and responsibilities, data model, API design, external and internal dependencies, and identified risks with mitigations. The bridge between "what are we doing" (spec) and "how do we do it in concrete steps" (tasks). The `design-review` gate fires on this artifact before tasks are planned.

**Required sections** (verbatim, in order):
1. `## Approach`
2. `## Components`
3. `## Data Model`
4. `## API Design`
5. `## Dependencies`
6. `## Risks & Mitigations`

**Placeholders used:**
- `{change_name}` (H1 title)
- `{high_level_approach}`
- `{component_list_and_responsibilities}`
- `{data_model_description}`
- `{api_design_description}`
- `{external_and_internal_dependencies}`
- `{identified_risks_and_mitigations}`

**Downstream consumers:**
- `tasks` (`requires: [design]` in both `standard` and `full`).
- `architecture` (`requires: [design]` in `full` only).
- `ux-spec` (`requires: [design]` in `full` only).

In `full`, `design.md` fans out into three parallel downstreams (`architecture`, `tasks`, `ux-spec`) — each elaborates a different facet of the design.

---

## `architecture.md`

**Used by stages:** `architecture` (in `full` only)
**Owning agent:** `metta-architect` — see [`agents.md`](agents.md)
**Purpose:** Deep architectural reference for a complex system change: system-level overview, component breakdown, interface contracts, state and data flow, deployment topology, and architectural risks. Complements `design.md` by going one level deeper where the `full` workflow is warranted (distributed systems, significant cross-component interfaces, deployment concerns).

**Required sections** (verbatim, in order):
1. `## Architecture Overview`
2. `## Component Breakdown`
3. `## Interfaces`
4. `## State & Data Flow`
5. `## Deployment Topology`
6. `## Risks`

**Placeholders used:**
- `{change_name}` (H1 title)
- `{architecture_overview}`
- `{component_breakdown}`
- `{interface_contracts}`
- `{state_and_data_flow}`
- `{deployment_topology}`
- `{architecture_risks_and_mitigations}`

**Downstream consumers:** `implementation` (`requires: [tasks, architecture]` in `full.yaml`). The executor reads both the task list and the architecture reference when implementing a `full`-workflow change — tasks describe the what, architecture constrains the how.

---

## `tasks.md`

**Used by stages:** `tasks` (in `standard` and `full`)
**Owning agent:** `metta-planner` — see [`agents.md`](agents.md)
**Purpose:** Executable task plan with dependency batches. Each task declares the files it touches, the action to perform, the verification step, and the done criteria. Tasks are grouped into batches — `Batch 1 (no dependencies)`, `Batch 2 (depends on Batch 1)`, etc. — to signal which tasks can run in parallel. Each task carries a `- [ ]` checkbox; the executor flips tasks to `- [x]` as they commit, and that write is staged alongside the task's code commit (never a separate commit — see the executor rules in `execute.md`).

**Required sections** (verbatim, in order):
1. `## Batch 1 (no dependencies)`
2. `## Batch 2 (depends on Batch 1)`

The template shows two batches with one task each; real plans repeat the batch pattern N times. Each task uses the structure:

```
- [ ] **Task N.M: {task_name}**
  - **Depends on**: <optional; cite prior task IDs>
  - **Files**: {files to create/modify}
  - **Action**: {what to do}
  - **Verify**: {how to verify it works}
  - **Done**: {acceptance criteria}
```

**Placeholders used:**
- `{change_name}` (H1 title)
- `{task_name}` (task header)
- `{files to create/modify}` / `{files}`
- `{what to do}` / `{action}`
- `{how to verify it works}` / `{verify}`
- `{acceptance criteria}` / `{done}`

**Downstream consumers:** `implementation` — `requires: [tasks]` in `standard`, `requires: [tasks, architecture]` in `full`. The `task-quality` gate fires before tasks are handed off to the executor. During implementation, the executor treats each task block as a unit of work and flips its checkbox on commit.

---

## `ux-spec.md`

**Used by stages:** `ux-spec` (in `full` only)
**Owning agent:** `metta-architect` — see [`agents.md`](agents.md)
**Purpose:** User-experience specification for a complex change with user-facing surfaces: user goals, key flows, screens and states, components and interactions, accessibility requirements, and visual tone and style. Used only in `full` — when a change is large enough to warrant the `full` workflow and also has UI concerns serious enough to warrant a dedicated spec (frontend components, accessibility review, design-system decisions).

**Required sections** (verbatim, in order):
1. `## User Goals`
2. `## Key Flows`
3. `## Screens & States`
4. `## Components & Interactions`
5. `## Accessibility`
6. `## Visual Tone`

**Placeholders used:**
- `{change_name}` (H1 title)
- `{user_goals}`
- `{key_flows}`
- `{screens_and_states}`
- `{components_and_interactions}`
- `{accessibility_requirements}`
- `{visual_tone_and_style}`

**Downstream consumers:** `ux-spec` is a leaf in the `full` workflow's DAG — no other stage declares `requires: [ux-spec]`. In practice the executor reads it when implementing UI tasks, and the verifier consults it during UAT for user-facing scenarios, but the workflow does not mandate either.

---

## `execute.md` (template for the `implementation` stage)

**Used by stages:** `implementation` (in `quick`, `standard`, and `full`)
**Owning agent:** `metta-executor` — see [`agents.md`](agents.md)
**Purpose:** The per-task execution prompt. Packages a single task's description, files, action, verification steps, and acceptance criteria along with the four Deviation Rules that govern how the executor handles unexpected situations (bug found, missing utility, infrastructure block, design-level change needed). The template is applied once per task batch during the implementation stage — this is the only artifact template used iteratively rather than written once per change.

**Required sections** (verbatim, in order):
1. `## Task`
2. `## Files`
3. `## Action`
4. `## Verify`
5. `## Done`
6. `## Rules`

The `## Rules` section is fixed boilerplate in the template (not a placeholder): it lists atomic commits, gates before commit, and the four Deviation Rules.

**Placeholders used:**
- `{task_id}` (H1 title)
- `{task_description}`
- `{file_list}`
- `{what_to_implement}`
- `{verification_steps}`
- `{acceptance_criteria}`

**Workflow config:** the `implementation` stage in every workflow declares `generates: "**/*"` (the executor can touch any file in the repo), and binds the gates `tests`, `lint`, `typecheck`. In `full`, the stage requires both `tasks` and `architecture`; elsewhere it requires `tasks` (standard) or `intent` (quick).

**Downstream consumers:** `verification` (`requires: [implementation]` in all three workflows). The verifier inspects the commits produced during implementation, not the template output itself.

---

## `verify.md` (template for the `verification` stage)

**Used by stages:** `verification` (in `quick`, `standard`, and `full`)
**Owning agent:** `metta-verifier` — see [`agents.md`](agents.md)
**Purpose:** Verification report for the completed change. Walks the spec scenarios as a checklist, summarises the gate results from the implementation stage, and provides a plain-prose implementation summary. Output is written to `summary.md` in the change directory (per every workflow's `generates: summary.md` declaration for the `verification` stage). This is the final artifact before a change is eligible for `/metta-ship`.

**Required sections** (verbatim, in order):
1. `## Spec Scenarios`
2. `## Gate Results`
3. `## Summary`

**Placeholders used:**
- `{change_name}` (H1 title)
- `{scenario_checklist}`
- `{gate_results_summary}`
- `{implementation_summary}`

**Workflow config:** every workflow's `verification` stage binds the `uat` gate — the final human-facing quality check before ship.

**Downstream consumers:** none inside the workflow DAG. On `/metta-ship`, the change directory (including `summary.md`) is moved from `spec/changes/` to `spec/archive/`, and the spec deltas from `spec.md` are reconciled into `spec/specs/`. The summary becomes the durable record of what was verified.

---

## Cross-reference

- **Per-workflow stage composition:** [`workflows.md`](workflows.md) — shows each workflow's full stage sequence, `requires` edges, and gate bindings.
- **Per-agent authoring surface:** [`agents.md`](agents.md) — shows which artifacts each `metta-*` subagent is responsible for.
- **Per-gate enforcement:** [`gates.md`](gates.md) — shows what each gate checks and at which stage it fires against which artifact.
- **On-disk layout of authored artifacts:** [`state.md`](state.md) — shows where `spec/changes/<slug>/*.md` lives and when it moves to `spec/archive/`.
