# 05 — Agent System

## Core Concept

Agents are **pluggable specialist personas** with scoped capabilities. BMAD proved that true persona separation produces better outcomes than one agent roleplaying. Metta makes agents a first-class, configurable construct.

---

## Agent Definition

```yaml
# .metta/agents/architect.yaml
name: architect
description: Senior systems architect focused on simplicity and maintainability
version: 1

persona: |
  You are a senior systems architect. You value simplicity over cleverness,
  explicit over implicit, and proven patterns over novel approaches. You
  document decisions as ADRs with clear rationale and tradeoffs.

capabilities:
  - design
  - review
  - adr
  - architecture

tools:
  - Read
  - Grep
  - Glob
  - Bash

context_budget: 80000

rules:
  - Always document the "why" behind decisions, not just the "what"
  - Prefer composition over inheritance
  - Flag any decision that creates vendor lock-in
```

---

## Built-in Agents

| Agent | Capabilities | Budget | Tools |
|-------|-------------|--------|-------|
| `proposer` | propose, intent | 20K | Read, Grep, Glob |
| `specifier` | spec, requirements, scenarios | 40K | Read, Grep, Glob |
| `researcher` | research, analysis | 60K | Read, Grep, Glob, Bash, WebSearch |
| `architect` | design, review, adr | 80K | Read, Grep, Glob, Bash |
| `planner` | tasks, decomposition | 40K | Read, Grep, Glob |
| `executor` | implementation, code | 10K | Read, Write, Edit, Bash, Grep, Glob |
| `verifier` | verification, testing | 50K | Read, Bash, Grep, Glob |
| `reviewer` | code-review, quality | 60K | Read, Grep, Glob |

Users override or extend these by placing YAML files in `.metta/agents/` or `~/.metta/agents/`.

---

## Agent Resolution

When the Workflow Engine needs an agent for an artifact, it resolves by capability:

```
artifact.agents: [architect]
  → AgentSystem.resolve("architect")
  → Search order:
    1. .metta/agents/architect.yaml (project)
    2. ~/.metta/agents/architect.yaml (global)
    3. Built-in agents (framework default)
  → Return first match
```

If an artifact declares multiple agents, the system selects based on the current operation:
- `agents: [architect, reviewer]` → architect for creation, reviewer for gate

---

## Tool Scoping

Each agent declares which tools it can use. The framework enforces this when generating instructions:

```yaml
# Executor: full write access
tools: [Read, Write, Edit, Bash, Grep, Glob]

# Verifier: read + run tests only
tools: [Read, Bash, Grep, Glob]

# Reviewer: read only
tools: [Read, Grep, Glob]
```

This prevents verification agents from accidentally modifying code (a problem in GSD and BMAD where tool scoping is documented but not enforced).

Tool scoping is enforced at the instruction level — the generated skill/command only lists the allowed tools. The AI tool's own permission system provides the runtime enforcement.

---

## Subagent Orchestration

### Fan-Out Pattern

For operations that benefit from multiple perspectives (review, research, brainstorming):

```typescript
agentSystem.fanOut([
  { agent: "skeptic", task: "Find gaps and untested assumptions", context },
  { agent: "optimizer", task: "Identify performance concerns", context },
  { agent: "security", task: "Flag security implications", context },
])
// → Spawns 3 parallel subagents
// → Each produces structured JSON output
// → Results merged by orchestrator
```

### Executor Pattern

For implementation (one task per fresh context):

```typescript
agentSystem.spawn("executor", {
  task: parsedTask,
  isolation: "worktree",  // Git worktree for parallel safety
  context: contextEngine.load(executionManifest),
  gates: ["tests", "lint"],
})
// → Fresh context window
// → Scoped to one task
// → Atomic commit on success
// → Gate verification before merge
```

### Graceful Degradation

If the AI tool doesn't support subagent spawning:
1. Fan-out falls back to sequential execution by the main agent
2. Executor pattern falls back to inline execution (no worktree isolation)
3. A warning is emitted so the user knows parallelism is unavailable

This mirrors BMAD's graceful degradation but makes it explicit and logged.

---

## Agent Modes

Three execution modes (from BMAD, refined):

### Interactive (default)
Human checkpoints at key decisions. Agent presents findings, asks for confirmation before proceeding. Best for: learning the system, critical decisions.

### Autonomous
Agent executes without checkpoints. Backpressure gates (tests, lints) provide the safety net. Best for: experienced users, well-tested codebases.

### Supervised
Agent runs autonomously but surfaces a summary after each artifact for human review before proceeding to the next. Best for: teams, code review workflows.

Mode is set globally or per-operation:
```bash
metta execute --mode autonomous
metta verify --mode interactive
```

```yaml
# .metta/config.yaml
defaults:
  mode: supervised
```

---

## Custom Agents

### Adding a Domain Expert

```yaml
# .metta/agents/data-engineer.yaml
name: data-engineer
description: Specialist in data pipelines, schema design, and query optimization
version: 1

persona: |
  You are a senior data engineer. You think in terms of data flows,
  schema evolution, and query performance. You always consider backward
  compatibility when changing schemas.

capabilities:
  - schema-design
  - migration
  - pipeline

tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob

context_budget: 60000

rules:
  - Every schema change must have a reversible migration
  - Prefer additive changes over destructive ones
  - Always test with realistic data volumes
```

### Adding a Review Persona

```yaml
# .metta/agents/security-reviewer.yaml
name: security-reviewer
description: Security-focused code reviewer
version: 1

persona: |
  You review code exclusively through a security lens. You check for
  OWASP Top 10, injection vulnerabilities, auth/authz gaps, and
  sensitive data exposure. You don't comment on style or performance.

capabilities:
  - security-review

tools:
  - Read
  - Grep
  - Glob

context_budget: 40000
```

Then reference it in a workflow:
```yaml
artifacts:
  - id: security-review
    type: verification
    template: security-review.md
    generates: security-review.md
    requires: [implementation]
    agents: [security-reviewer]
    gates: []
```

---

## Agent Communication

Agents communicate through **artifacts on disk**, not through direct message passing. This is intentional:

1. **Composability** — Any agent can read any artifact. No coupling between agents.
2. **Resumability** — If a session ends, artifacts persist. The next session picks up where the last left off.
3. **Auditability** — Every inter-agent communication is a file that can be reviewed, diffed, and versioned.
4. **Tool-agnostic** — Works whether agents are in the same process, different worktrees, or different machines.

The tradeoff is latency (file I/O vs in-memory), but for the kinds of operations in SDD (minutes, not milliseconds), this is acceptable.
