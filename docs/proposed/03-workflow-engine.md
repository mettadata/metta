# 03 — Workflow Engine

## Core Concept

Workflows are **declarative YAML graphs** of artifacts with dependencies. The engine computes build order, tracks status, and determines what's ready next. No hardcoded phases, no rigid pipelines.

---

## Workflow Definition Format

```yaml
# .metta/workflows/standard.yaml
name: standard
description: Standard workflow for medium-complexity features
version: 1

artifacts:
  - id: intent
    type: intent
    template: intent.md
    generates: intent.md
    requires: []
    agents: [proposer]
    gates: []

  - id: spec
    type: spec
    template: spec.md
    generates: spec.md
    requires: [intent]
    agents: [specifier]
    gates: [spec-quality]

  - id: design
    type: design
    template: design.md
    generates: design.md
    requires: [spec]
    agents: [architect]
    gates: [design-review]

  - id: tasks
    type: tasks
    template: tasks.md
    generates: tasks.md
    requires: [design]
    agents: [planner]
    gates: [task-quality]

  - id: implementation
    type: execution
    template: execute.md
    generates: "**/*"
    requires: [tasks]
    agents: [executor]
    gates: [tests, lint, typecheck]

  - id: verification
    type: verification
    template: verify.md
    generates: summary.md
    requires: [implementation]
    agents: [verifier]
    gates: [uat]
```

---

## Built-in Workflows

### Quick (2 artifacts)
```
intent ──→ execution
```
For small, well-understood changes. Skip planning, trust the agent, verify with backpressure.

### Standard (6 artifacts)
```
intent ──→ spec ──→ design ──→ tasks ──→ execution ──→ verification
```
For medium features. The default when you run `metta propose`.

### Full (10 artifacts)
```
research ──→ intent ──→ spec ──→ design ──┬──→ architecture
                                          │
                                          ├──→ tasks
                                          │
                                          └──→ ux-spec
                                                  │
                            tasks + architecture ──┴──→ execution ──→ verification
```
For complex systems. Research informs intent. Architecture and UX run in parallel after design. Tasks depend on both.

### Custom
Users create their own workflows by writing YAML files in `.metta/workflows/`. The engine doesn't care about artifact names or types — it only cares about the dependency graph.

```yaml
# .metta/workflows/data-pipeline.yaml
name: data-pipeline
description: Custom workflow for data engineering
version: 1

artifacts:
  - id: schema-design
    type: design
    template: schema-design.md
    generates: schema.md
    requires: []
    agents: [data-architect]
    gates: [schema-lint]

  - id: migration
    type: execution
    template: migration.md
    generates: "migrations/**"
    requires: [schema-design]
    agents: [executor]
    gates: [migration-test]

  - id: pipeline
    type: execution
    template: pipeline.md
    generates: "src/pipelines/**"
    requires: [schema-design]
    agents: [executor]
    gates: [pipeline-test]
```

---

## Graph Operations

### Build Order (Topological Sort)

Kahn's algorithm with deterministic tie-breaking (alphabetical by ID):

```
Input:  intent → spec → design → tasks → execution → verification
Output: [intent, spec, design, tasks, execution, verification]

Input:  design → [architecture, tasks, ux-spec] → execution
Output: [design, architecture, tasks, ux-spec, execution]
        (architecture, tasks, ux-spec are parallelizable)
```

### Next Artifacts

Given current completion state, return artifacts whose dependencies are all complete:

```
Completed: [intent, spec, design]
Next:      [architecture, tasks, ux-spec]  ← all three ready in parallel
```

### Cycle Detection

Validated at workflow load time. If a cycle is detected, the workflow fails to load with a clear error message showing the cycle path.

### Partial Execution

Users can target a specific artifact: `metta build design`. The engine computes the minimal subgraph needed and only builds missing dependencies.

---

## Workflow Composition

Workflows can extend other workflows:

```yaml
# .metta/workflows/standard-with-research.yaml
name: standard-with-research
extends: standard
version: 1

artifacts:
  - id: research
    type: research
    template: research.md
    generates: research.md
    requires: []
    agents: [researcher]
    gates: []

overrides:
  - id: intent
    requires: [research]  # Now intent depends on research
```

This lets teams build on standard workflows without duplicating everything.

---

## Workflow Selection

### Automatic (default)
`metta propose` uses the workflow set in `.metta/config.yaml`:
```yaml
defaults:
  workflow: standard
```

### Explicit
```bash
metta propose --workflow full "payment processing system"
metta propose --workflow quick "fix typo in header"
```

### Per-Change Override
Each change records its workflow in `.metta.yaml`:
```yaml
workflow: standard
created: 2026-04-04T12:00:00Z
base_versions:
  auth/spec.md: "sha256:abc123"
```

---

## Artifact Types

Built-in types (extensible via plugins):

| Type | Purpose | Default Template |
|------|---------|-----------------|
| `research` | Market/domain/technical research | research.md |
| `intent` | What and why (proposal) | intent.md |
| `spec` | Requirements with scenarios | spec.md |
| `design` | Technical approach and decisions | design.md |
| `architecture` | ADRs, system design, standards | architecture.md |
| `ux-spec` | Wireframes, interactions, user flows | ux-spec.md |
| `tasks` | Implementation checklist | tasks.md |
| `execution` | Code implementation | execute.md |
| `verification` | Testing and validation | verify.md |

Custom types registered via workflow plugins:
```yaml
# .metta/plugins/data-artifacts/manifest.yaml
artifact_types:
  - id: schema-design
    template: schema-design.md
    description: Database schema design document
  - id: migration
    template: migration.md
    description: Database migration plan
```

---

## Status Tracking

Each artifact in an active change has a status:

| Status | Meaning |
|--------|---------|
| `pending` | Not started, dependencies may not be met |
| `ready` | Dependencies met, can be built |
| `in_progress` | Currently being worked on |
| `complete` | Artifact generated and gates passed |
| `failed` | Gates failed, needs rework |
| `skipped` | Explicitly skipped by user |

Status transitions are validated:
```
pending → ready       (automatic, when deps complete)
ready → in_progress   (when agent starts)
in_progress → complete (when gates pass)
in_progress → failed   (when gates fail)
failed → in_progress   (retry)
any → skipped          (user decision)
```

The workflow engine emits events on every transition, which hooks can observe.
