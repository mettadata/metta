# Intent: Fix stale documentation to match actual current code

**Change:** fix-stale-documentation-across-docs-match-actual-current
**Date:** 2026-06-23
**Status:** Draft
**Workflow:** quick

---

## Problem

A 4-auditor review of the hand-written documentation (primarily the pre-existing `docs/workflows/` set, plus parts of `docs/guide/` and `docs/internals/`) found that the docs describe an **OLD state** of the metta workflow engine. They have drifted from the source of truth in `src/templates/` and the workflow-engine code. Developers and AI orchestrators reading these docs will form an incorrect mental model: they will look for gates that do not exist, count the wrong number of workflows, misunderstand which commands run which gates, and misattribute git-commit responsibility across agents.

Concretely, the docs are wrong on at least four axes:

1. **Phantom gates.** The docs reference gate names — `spec-quality`, `design-review`, `task-quality`, `uat` — that appear in **zero source files**. They are not wired into any workflow YAML, not registered, and resolve to *skip* at runtime. Readers will believe these gates run.

2. **Workflow count.** The docs say there are **three** workflows. There are actually **four**: `trivial`, `quick`, `standard`, `full`. The `trivial` workflow is entirely undocumented.

3. **Finalize scoping.** The docs describe `metta finalize` and `metta verify` inconsistently. In current code `metta finalize` is **workflow-scoped** (it unions the active workflow's per-stage gate arrays, falling back to the full registry only if the workflow fails to load), while `metta verify` is the registry-wide sweep.

4. **Agent commit model.** The docs misstate which agents commit. Of the 11 agent files in `src/templates/agents/`, only `metta-discovery` and `metta-executor` run git; the **orchestrator** commits all other artifacts *and* `summary.md`.

There are also smaller factual errors (a non-existent `metta abandon` command, an outdated `ChangeMetadata` field list, a stale quick-workflow artifact description, and a broken cross-link in `docs/internals/`).

This documentation drift is a correctness hazard: the docs are the contract developers read before touching the workflow engine, and following them today produces wrong assumptions.

---

## Proposal

Rewrite the affected hand-written docs so every workflow-engine claim matches the verified source-of-truth below. This is a **documentation-only** change (no code or template changes). The canonical facts (verified against source in `src/templates/` and the workflow-engine code) are:

### Workflows (FOUR, not three)

There are four workflows: `trivial`, `quick`, `standard`, `full` (`src/templates/workflows/{trivial,quick,standard,full}.yaml`). Docs that say "three workflows" must be corrected to four, and `trivial` must be documented alongside the others.

### Registered gates (exactly 5)

The registered gates are exactly: `tests`, `lint`, `typecheck`, `build`, `stories-valid` (`src/templates/gates/`). The names `spec-quality`, `design-review`, `task-quality`, and `uat` are **phantom** — they appear in zero source files, are not wired into any workflow YAML, are not registered, and resolve to *skip*. All references to them must be **removed** from the docs.

### Per-workflow gate arrays

- `trivial` and `quick`: implementation stage = `[tests, lint, typecheck, build]`; all other stages = `[]`.
- `standard`: spec stage = `[stories-valid]`; implementation stage = `[tests, lint, typecheck, build]`; all other stages = `[]`.
- `full`: implementation stage = `[tests, lint, typecheck]` (**no `build`**); all other stages = `[]`.

### Gate `on_failure` policy

- `stop`: `build`, `stories-valid`, `tests`.
- `retry_once`: `lint`, `typecheck`.

### finalize vs. verify scoping

- `metta finalize` is **workflow-scoped**: it unions the active workflow's per-stage gate arrays and runs that set. It falls back to `registry.list()` (all registered gates) **only if** the workflow fails to load.
- `metta verify` is the **registry-wide sweep** (runs the full registered gate set).

### Agents (11 files) and commit model

There are 11 agent files in `src/templates/agents/` (including `metta-skill-host`). Only `metta-discovery` and `metta-executor` run git directly. The **orchestrator** commits all other artifacts as well as `summary.md`. Docs that attribute commits to other agents, or omit the orchestrator's role, must be corrected.

### Command correctness

- `metta abandon` is **not** a command. The correct invocation is `metta changes abandon <name>`.

### ChangeMetadata fields

`ChangeMetadata` has optional fields beyond the basic six: `complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`, `workflow_locked`, `artifact_timings`, `artifact_tokens`, `review_iterations`, `verify_iterations`, `stop_after`. Docs that list only the basic six must note these optional fields.

### Quick-workflow artifacts

In the `quick` workflow there is **no** `implementation.md` artifact — the implementation stage generates code (`**/*`). There is **no** "stories sentinel" step in quick, and there is **no** `accepted` artifact status. Docs implying any of these must be corrected.

### Files to fix (approximate edit counts)

- `docs/workflows/gates.md` (~14)
- `docs/workflows/workflows.md` (~10)
- `docs/workflows/agents.md` (8)
- `docs/workflows/walkthroughs.md` (6)
- `docs/workflows/artifacts.md` (5)
- `docs/workflows/README.md` (3)
- `docs/workflows/state.md` (2)
- `docs/guide/concepts.md` (2)
- `docs/guide/getting-started.md` (1)
- `docs/internals/data-model.md` — fix broken cross-link `../architecture.md` → `./architecture.md`
- `docs/internals/extending.md` — fix broken cross-link `../architecture.md` → `./architecture.md`

---

## Impact

**Developers:** The `docs/workflows/` set becomes a trustworthy reference. Readers will no longer hunt for the four phantom gates, will know all four workflows exist (including `trivial`), will understand the finalize-vs-verify scoping distinction, and will correctly attribute commits to the orchestrator vs. the two git-running agents.

**AI orchestrators:** Instruction-mode orchestrators that read these docs to drive the lifecycle will have an accurate model of gate sets, commit responsibility, and command names (`metta changes abandon`, not `metta abandon`).

**No behavior change:** This change touches only documentation. No code, templates, gate definitions, or workflow YAML are modified.

---

## Out of Scope

- **`docs/proposed/`** — already flagged as historical; not corrected here.
- **The 4 generated docs** — `docs/api.md`, `docs/architecture.md`, `docs/changelog.md`, `docs/getting-started.md` are regenerated from specs and are out of scope (their drift is fixed by regeneration, not by hand-editing).
- **The spec-vs-code gap** where `specs/workflow-engine` references the phantom gates — that is a separate reconciliation concern and is not fixed in this change.
- **Any code, template, gate, or workflow YAML change** — this is a documentation-only correction. The source of truth is not modified; only the docs are brought into alignment with it.

---

## Given/When/Then Scenarios

### Scenario 1: Phantom gates removed

**Given** the hand-written docs in `docs/workflows/` reference gate names `spec-quality`, `design-review`, `task-quality`, and `uat`
**When** the docs are corrected
**Then** none of those four names appear anywhere in the hand-written docs, and the only gate names referenced are `tests`, `lint`, `typecheck`, `build`, and `stories-valid`

### Scenario 2: Workflow count corrected to four

**Given** docs that state there are three workflows
**When** the docs are corrected
**Then** the docs state there are four workflows (`trivial`, `quick`, `standard`, `full`) and document the `trivial` workflow

### Scenario 3: finalize vs. verify scoping documented correctly

**Given** docs that describe `metta finalize` and `metta verify`
**When** the docs are corrected
**Then** `metta finalize` is described as workflow-scoped (unions the active workflow's gate arrays, falling back to the full registry only on workflow-load failure) and `metta verify` is described as the registry-wide sweep

### Scenario 4: Agent commit model corrected

**Given** docs that describe which agents commit
**When** the docs are corrected
**Then** the docs state there are 11 agent files in `src/templates/agents/`, that only `metta-discovery` and `metta-executor` run git, and that the orchestrator commits all other artifacts and `summary.md`

### Scenario 5: Command name corrected

**Given** docs that reference `metta abandon`
**When** the docs are corrected
**Then** the docs reference `metta changes abandon <name>` instead

### Scenario 6: Broken internal cross-link fixed

**Given** `docs/internals/data-model.md` and `docs/internals/extending.md` link to `../architecture.md`
**When** the docs are corrected
**Then** both links point to `./architecture.md`

### Scenario 7: Generated docs untouched

**Given** the regenerated docs `docs/api.md`, `docs/architecture.md`, `docs/changelog.md`, `docs/getting-started.md`
**When** this change is applied
**Then** those four files are not hand-edited by this change
