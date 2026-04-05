# 02 — Architecture Overview

## System Layers

```
┌─────────────────────────────────────────────────────┐
│                    CLI / MCP / API                    │  ← User-facing
├─────────────────────────────────────────────────────┤
│                  Command Delivery                    │  ← Multi-tool adapters
├──────────┬──────────┬───────────┬───────────────────┤
│ Workflow │ Context  │  Agent    │    Execution       │  ← Core engines
│ Engine   │ Engine   │  System   │    Engine          │
├──────────┴──────────┴───────────┴───────────────────┤
│                   Plugin System                      │  ← Extension points
├──────────┬──────────┬───────────┬───────────────────┤
│ Artifact │  State   │ Provider  │     Gate           │  ← Data & services
│ Store    │  Store   │ Registry  │     Registry       │
├──────────┴──────────┴───────────┴───────────────────┤
│                  File System / Git                    │  ← Persistence
└─────────────────────────────────────────────────────┘
```

---

## Layer Responsibilities

### 1. CLI / MCP / API

Three entry points, one core:

**CLI** (`metta` command): Human-facing. Commands map 1:1 to workflow operations. Commander.js with rich output (colors, tables, progress). Shell completion for Bash/Zsh.

**MCP Server**: Machine-facing. Tiered tool loading (core/standard/extended) to optimize context usage. FastMCP wrapper. Exposes all workflow operations as MCP tools.

**API** (programmatic): Library-facing. The `Metta` class exposes the same operations as CLI/MCP for embedding in custom tools, CI pipelines, or dashboards.

All three call the same core engines. No logic duplication.

### 2. Command Delivery

Generates and installs slash commands/skills for AI tools. Adapter pattern with one interface:

```typescript
interface ToolAdapter {
  id: string
  skillsDir(root: string): string
  commandsDir(root: string): string
  formatSkill(content: SkillContent): string
  formatCommand(content: CommandContent): string
}
```

Adapters for: Claude Code, Cursor, Copilot, Codex, Gemini, Windsurf, OpenCode, and a `GenericAdapter` for anything else. Adding a new tool = ~50 lines implementing the interface.

Commands are **external markdown/YAML files** in `templates/commands/`, never string literals in code. The delivery layer processes templates (placeholder substitution, path rewriting, format conversion) and writes to tool-specific locations.

### 3. Workflow Engine

Manages the artifact dependency graph. Given a workflow definition (YAML), computes build order, tracks completion status, and determines what's ready to build next.

```
WorkflowEngine
  ├── loadWorkflow(name) → WorkflowGraph
  ├── getStatus(change) → ArtifactStatus[]
  ├── getNext(change) → Artifact[]
  ├── markComplete(artifact) → void
  └── validate(change) → ValidationResult
```

No hardcoded phases. The engine operates on any DAG of artifacts. "Quick mode" and "full ceremony" are just different workflow YAML files.

See [03-workflow-engine.md](03-workflow-engine.md).

### 4. Context Engine

Determines what context to load for a given operation. Enforces context budgets. Handles truncation, extraction, and freshness.

```
ContextEngine
  ├── resolve(phase, artifact) → ContextManifest
  ├── load(manifest) → LoadedContext
  ├── budget(agent) → TokenBudget
  ├── truncate(content, budget) → TruncatedContent
  └── extract(content, section) → ExtractedContent
```

See [04-context-engine.md](04-context-engine.md).

### 5. Agent System

Manages agent personas, capabilities, and subagent orchestration.

```
AgentSystem
  ├── resolve(capability) → Agent
  ├── spawn(agent, task, context) → SubagentHandle
  ├── fanOut(agents[], tasks[]) → Promise<Result[]>
  └── scopeTools(agent) → AllowedTools
```

See [05-agent-system.md](05-agent-system.md).

### 6. Execution Engine

Handles the actual running of work: batch-based parallelism, backpressure gates, deviation rules, and worktree isolation.

```
ExecutionEngine
  ├── plan(tasks[]) → BatchPlan
  ├── execute(batch) → BatchResult
  ├── gate(artifact, gates[]) → GateResult
  └── deviate(rule, context) → DeviationDecision
```

See [07-execution-engine.md](07-execution-engine.md).

### 7. Plugin System

Five extension points, each with a registry and manifest contract:

```
PluginSystem
  ├── WorkflowPluginRegistry   → custom artifact types
  ├── AgentPluginRegistry      → custom personas
  ├── ProviderPluginRegistry   → custom AI backends
  ├── GatePluginRegistry       → custom verification checks
  └── HookPluginRegistry       → before/after event handlers
```

See [08-plugins.md](08-plugins.md).

### 8. Data Layer

**Artifact Store**: Manages spec files, proposals, designs, tasks, and archives. Handles versioning with content hashes. Supports delta operations (ADDED/MODIFIED/REMOVED) at requirement and scenario level.

**State Store**: Typed, schema-validated state with optimistic locking. Every read validates against Zod schema. Every write validates before persisting. Migrations handle schema evolution.

**Provider Registry**: Dynamic AI provider registration. Dependency-injected (not singleton). Role-based model selection (main/research/fallback). Retry with exponential backoff.

**Gate Registry**: Verification gates (test runners, linters, type-checkers, custom validators). Each gate produces a typed result that feeds back into the execution loop.

---

## Directory Structure

### Principle: Global is the Default, Local is the Override

Global (`~/.metta/`) contains everything needed to use Metta in any project — config, workflows, agents, gates, templates. A fresh `metta init` in a project creates a minimal `.metta/` with only project-specific context (name, stack, conventions). You should never need to configure anything locally to start working.

Project `.metta/` exists for **customization only** — a different default workflow, custom agents, project-specific gates, template overrides. Anything not overridden locally is inherited from global.

### Global Installation (`~/.metta/`)
```
~/.metta/
  config.yaml              # User defaults (workflow, mode, providers, tools)
  providers.yaml           # AI provider credentials
  workflows/               # Built-in workflow definitions
    quick.yaml
    standard.yaml
    full.yaml
  agents/                  # Default agent definitions
  gates/                   # Default gate definitions
  plugins/                 # Global plugins
  templates/               # Default artifact templates
```

### Project Layout

`.metta/` is for **framework state only** — config, state, workflows, agents, gates, plugins, templates. Nothing human-readable lives here.

`docs/` (configurable) is for **project documents** — constitution, specs, generated docs, change artifacts. Everything a human or AI would read.

```
.metta/                            # Framework state (hidden)
  config.yaml              # Project overrides (only what differs from global)
  local.yaml               # Personal overrides, gitignored
  workflows/               # Custom workflows (extends or replaces global)
  agents/                  # Custom agents (extends or replaces global)
  gates/                   # Custom gates (extends or replaces global)
  plugins/                 # Project plugins
  templates/               # Template overrides
  state.yaml               # Current state (schema-validated)

docs/                              # Project documents (configurable path)
  project.md               # Project constitution (source of truth for AI context)
  specs/                   # Living specifications
    <capability>/
      spec.md              # Current spec
      spec.lock            # Content hash + version
  changes/                 # Active changes
    <change-name>/
      .metta.yaml          # Change metadata (workflow, base versions)
      intent.md            # What and why
      spec.md              # Delta spec (ADDED/MODIFIED/REMOVED)
      design.md            # Technical approach
      tasks.md             # Implementation checklist
      summary.md           # Post-execution summary
  archive/                 # Completed changes
    YYYY-MM-DD-<name>/
  gaps/                    # Reconciliation gaps (one file per gap)
    <gap-name>.md          # Auto-removed when resolved
  architecture.md          # Generated — system design and ADRs
  api.md                   # Generated — public API documentation
  changelog.md             # Generated — what changed and why
  getting-started.md       # Generated — setup and usage
```

---

## Data Flow

### Happy Path (Standard Workflow)

```
User: metta propose "add payment processing"
  │
  ├── WorkflowEngine.loadWorkflow("standard")
  ├── ArtifactStore.createChange("add-payment-processing")
  ├── ContextEngine.resolve(phase: "propose", artifact: "intent")
  ├── AgentSystem.resolve(capability: "propose")
  ├── CommandDelivery.generateInstructions(agent, context, template)
  │
  └── AI Tool executes instructions
      ├── Reads: metta status --json
      ├── Reads: metta instructions intent --json
      ├── Writes: docs/changes/add-payment-processing/intent.md
      └── Writes: docs/changes/add-payment-processing/spec.md
  │
User: metta plan
  │
  ├── WorkflowEngine.getNext() → [design, tasks] (spec is done)
  ├── ContextEngine.resolve(phase: "plan", artifact: "design")
  ├── ContextEngine.load() → intent.md + spec.md + relevant specs/
  │
  └── AI Tool produces design.md + tasks.md
  │
User: metta execute
  │
  ├── ExecutionEngine.plan(tasks) → BatchPlan { batches: [[1,2], [3]] }
  ├── For each batch:
  │   ├── ExecutionEngine.checkOverlap(tasks) → safe to parallelize?
  │   ├── AgentSystem.fanOut(executors, tasks, worktrees)
  │   ├── Each executor: fresh context, scoped tools, atomic commits
  │   └── GateRegistry.run(gates) → pass/fail
  ├── StateStore.update(progress)
  │
User: metta verify
  │
  ├── GateRegistry.runAll(change) → GateResults
  ├── AgentSystem.resolve(capability: "verify")
  ├── Interactive walkthrough of deliverables
  │
User: metta ship
  │
  ├── ArtifactStore.archive(change)
  ├── ArtifactStore.mergeSpecs(deltas, baseVersions) → conflict check
  └── Git: commit, tag, optional PR creation
```

---

## Key Architectural Decisions

### ADR-001: ESM Only
No CommonJS. No mixed module systems. All code is ESM TypeScript. This avoids Taskmaster's technical debt.

### ADR-002: Dependency Injection Over Singletons
Provider Registry, Gate Registry, and Agent System are instantiated and injected, not global singletons. This enables testing without mocks and parallel execution without shared state.

### ADR-003: Templates as External Files
All command templates, skill templates, and artifact templates live as markdown/YAML files in `templates/`. Never as string literals in TypeScript. This avoids OpenSpec's customization friction.

### ADR-004: Schema Validation on Every State Transition
Every read from and write to the State Store goes through Zod validation. This prevents the silent corruption that plagues GSD and Ralph.

### ADR-005: Conflict Detection at Merge Time
Changes declare their base spec versions (content hashes). When archiving/merging, the framework detects if the base has changed and surfaces conflicts interactively. This solves OpenSpec's critical parallel collision bug.

### ADR-006: Git-Aware as a Config Toggle
Git integration is controlled by `git.enabled` in config. When enabled (default), Metta manages commits (following Conventional Commits by default), worktree isolation, branch protection, and merge safety. When disabled, Metta operates purely on the filesystem — no commits, no worktrees, sequential execution only. The Artifact Store and State Store abstract over persistence so both modes use the same core engines. See [07-execution-engine.md § Git Configuration](07-execution-engine.md) for details.
