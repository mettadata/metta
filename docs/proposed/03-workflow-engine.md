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

  - id: research
    type: research
    template: research.md
    generates: research.md
    requires: [spec]
    agents: [researcher]
    gates: []

  - id: design
    type: design
    template: design.md
    generates: design.md
    requires: [research]
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

## Discovery Gate

Before any workflow proceeds to execution, the agent must fully understand what it's building. Discovery is not optional — it's a **framework-level gate** that applies to every workflow, every mode, every time. No guesswork, no assumptions, no "I'll figure it out as I go."

### Principle: Zero Ambiguity Before Execution

The agent does not write code until it can answer: what are the exact requirements, what are the scenarios, and what is out of scope? If it can't answer, it asks. If the user hasn't decided, the agent surfaces the decision — it doesn't make it.

### How Discovery Works

When any workflow artifact is being built (propose, spec, design), the assigned agent:

1. **Analyzes** the current state — description, existing specs, project context, codebase
2. **Identifies ambiguity** — missing requirements, undefined edge cases, unstated assumptions, unclear integration points
3. **Asks adaptive questions** — not from a template, but derived from what the AI actually doesn't know given the specific context
4. **Iterates** until no open questions remain
5. **Confirms** — presents a completeness assessment for user approval

Questions are scoped to what matters for that specific change:

- A payment system gets questions about idempotency, retry semantics, currency handling
- A UI component gets questions about responsive behavior, empty states, accessibility
- A database migration gets questions about backward compatibility, rollback strategy, data volume

### Completeness Check

Before an artifact clears its discovery gate, the agent runs a self-assessment:

```
Discovery completeness:
  ✓ All requirements have at least one scenario
  ✓ All scenarios have Given/When/Then
  ✓ No TODO/TBD markers in spec
  ✓ No ambiguous RFC 2119 keywords (SHOULD without rationale)
  ✓ Edge cases addressed for each requirement
  ✓ Integration points identified with existing code
  ✓ Out-of-scope explicitly declared
```

If any check fails, the agent must resolve it before proceeding — either by asking the user or by deriving the answer from project context and confirming.

### Discovery Across Workflows

Discovery applies at different depths depending on the workflow:

```
Quick:     Light discovery during intent (scope + edge cases)
Standard:  Full discovery during propose + spec (requirements + scenarios + integration)
Full:      Deep discovery during domain-research + propose + spec (domain + requirements + architecture)
```

Even `metta quick` asks enough questions to know what it's building. The difference is depth, not whether discovery happens.

### Discovery Modes

```bash
# Interactive (default): agent asks questions conversationally
metta propose "add user profiles"

# Batch: agent presents all questions at once
metta propose --discovery batch "add user profiles"

# Review: agent generates spec draft, user reviews and approves
metta propose --discovery review "add user profiles"
```

### Why This Matters

Without discovery, agents guess. Guesses compound — a wrong assumption in the spec becomes a wrong design, wrong tasks, wrong code, wrong tests that pass against the wrong behavior. Discovery is the cheapest place to catch mistakes. Execution is the most expensive.

---

## Implementation Research

After the spec is locked (requirements and scenarios defined), there are often multiple ways to fulfill those requirements. The research phase explores technical approaches, evaluates tradeoffs, presents options to the user, and **produces concrete technical artifacts** that design and execution depend on.

Research is not just a decision document — it produces the API contracts, data models, schemas, and diagrams that the spec agent validates against and the executor builds from.

### What Research Does

The researcher agent:

1. **Reads the spec** — understands what needs to be built
2. **Scans the codebase** — what patterns, libraries, and infrastructure already exist
3. **Explores approaches** — identifies 2-4 viable implementation strategies
4. **Evaluates tradeoffs** — complexity, performance, maintainability, consistency with existing code
5. **Presents options** — structured questions via AskUserQuestion with clear recommendations
6. **Produces technical artifacts** — API contracts, data models, schemas, diagrams based on the chosen approach

### Example

```
Spec: "The system MUST support real-time notifications for order updates"

Researching implementation approaches...

Codebase analysis:
  - SSE already used in src/app/api/events/ for dashboard updates
  - No WebSocket infrastructure exists
  - Notification model exists in Prisma schema

Options:

[1] Server-Sent Events (Recommended)
    Consistent with existing SSE in src/app/api/events/.
    One-way push is sufficient for notifications.
    No new infrastructure needed.

[2] WebSockets (socket.io)
    Full duplex — overkill for notifications but enables future chat.
    Adds socket.io server dependency and connection management.

[3] Polling (5s interval)
    Simplest. No new server infrastructure.
    Higher latency (up to 5s delay). More database load.

Which approach?
```

The user's choice is recorded in the research artifact and becomes a constraint for the design phase.

### Research Output

Research produces a subdirectory of technical artifacts within the change:

```
spec/changes/add-notifications/
  research/
    research.md              # Decision + rationale + approaches considered
    contracts/
      notification-api.md    # API contract (endpoints, request/response shapes)
      sse-events.md          # Event schema (event types, payload shapes)
    schemas/
      notification.md        # Data model (DB schema, type definitions)
    diagrams/
      notification-flow.md   # Architecture/sequence diagrams
```

#### research.md — Decision Document

```markdown
# Research: Real-Time Notifications

## Decision: Server-Sent Events

### Approaches Considered

1. **SSE** (selected) — consistent with existing patterns, no new deps
2. **WebSockets** — overkill for one-way notifications
3. **Polling** — too much latency and DB load

### Rationale
SSE already used in src/app/api/events/. One-way push matches the requirement.
No new infrastructure or dependencies needed.

### Artifacts Produced
- [API Contract: Notification API](contracts/notification-api.md)
- [API Contract: SSE Events](contracts/sse-events.md)
- [Data Model: Notification](schemas/notification.md)
- [Flow: Notification Pipeline](diagrams/notification-flow.md)
```

#### contracts/ — API Contracts

```markdown
# API Contract: Notification API

## POST /api/notifications/subscribe
Subscribe to notifications for the authenticated user.

**Request**: None (uses session cookie)
**Response**: SSE stream
**Content-Type**: text/event-stream

### Event: order-update
```json
{
  "type": "order-update",
  "orderId": "string",
  "status": "shipped | delivered | refunded",
  "timestamp": "ISO 8601"
}
```

### Event: notification-read
```json
{
  "type": "notification-read",
  "notificationId": "string"
}
```

## GET /api/notifications
List recent notifications for the authenticated user.

**Response**:
```json
{
  "notifications": [
    {
      "id": "string",
      "type": "order-update",
      "message": "string",
      "read": "boolean",
      "createdAt": "ISO 8601"
    }
  ],
  "unreadCount": "number"
}
```
```

#### schemas/ — Data Models

```markdown
# Data Model: Notification

## Prisma Schema
```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // order-update, system, promo
  message   String
  data      Json?    // type-specific payload
  read      Boolean  @default(false)
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id])

  @@index([userId, read, createdAt])
}
```

## TypeScript Types
```typescript
interface Notification {
  id: string
  userId: string
  type: 'order-update' | 'system' | 'promo'
  message: string
  data?: Record<string, unknown>
  read: boolean
  createdAt: Date
}
```
```

### How Research Artifacts Are Used

These artifacts are **consumed by downstream phases**, not just documentation:

| Consumer | What it uses | How |
|----------|-------------|-----|
| **Design** | All research artifacts | Design validates that contracts and schemas support all spec scenarios |
| **Tasks** | Contracts + schemas | Task decomposition references specific endpoints and models |
| **Executor** | Contracts + schemas | Build specification — the executor implements exactly what the contract defines |
| **Verifier** | Contracts + schemas | Verification checks that implementation matches the contract |
| **Context Engine** | research/ directory | Loads relevant research artifacts into context for downstream agents |

### Domain Research vs Implementation Research

| | Domain Research | Implementation Research |
|---|---|---|
| **When** | Before intent (full workflow only) | After spec, before design (standard + full) |
| **Purpose** | Understand the problem space | Explore how to solve it |
| **Questions** | Market, users, competitors, domain | Libraries, patterns, architecture, tradeoffs |
| **Output** | domain-research.md | research.md |
| **User input** | Optional (inform intent) | Required (choose approach) |

---

## Built-in Workflows

### Quick (3 artifacts)
```
intent ──→ execution ──→ verification
```
For small, well-understood changes. Skip planning, trust the agent, verify with backpressure gates.

### Standard (7 artifacts)
```
intent ──→ spec ──→ research ──→ design ──→ tasks ──→ execution ──→ verification
```
For medium features. Research explores technical approaches after spec is locked. The default when you run `metta propose`.

### Full (10 artifacts)
```
domain-research ──→ intent ──→ spec ──→ research ──→ design ──┬──→ architecture
                                                              │
                                                              ├──→ tasks
                                                              │
                                                              └──→ ux-spec
                                                                      │
                                                tasks + architecture ──┴──→ execution ──→ verification
```
For complex systems. Domain research informs intent. Implementation research informs design. Architecture and UX run in parallel after design. Tasks depend on both.

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

`metta plan` builds all planning artifacts in one pass. The engine computes the minimal subgraph needed and only builds missing dependencies.

---

## Workflow Composition

Workflows can extend other workflows:

```yaml
# .metta/workflows/standard-with-domain-research.yaml
name: standard-with-domain-research
extends: standard
version: 1

artifacts:
  - id: domain-research
    type: domain-research
    template: domain-research.md
    generates: domain-research.md
    requires: []
    agents: [researcher]
    gates: []

overrides:
  - id: intent
    requires: [domain-research]  # Now intent depends on domain research
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
| `domain-research` | Market/domain/technical research (full workflow) | domain-research.md |
| `research` | Implementation approach exploration | research.md |
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
any → skipped          (user decision — satisfies deps, downstream artifacts become ready)
```

A skipped artifact is treated as complete for dependency resolution. Downstream artifacts become `ready` immediately. This lets users skip optional artifacts (e.g., skip `architecture` in a full workflow) without blocking the rest of the graph.

> These are **artifact-level** statuses within a change. For the change's own lifecycle status, see [06-spec-model.md](06-spec-model.md).

The workflow engine emits events on every transition, which hooks can observe.
