# Metta: A Meta-Programming SDD Framework

> Metta (Pali: loving-kindness) — a framework that treats your intent with care.

**Metta is a composable, context-aware, spec-driven development framework designed for AI-native software engineering.**

It synthesizes the best ideas from OpenSpec, Spec Kit, GSD, BMAD, Taskmaster, and Ralph into a unified system that is lightweight for solo devs and scalable for teams.

---

## Design Documents

0. [Quick Start & Usage Guide](00-quickstart-usage.md) — How to install and use Metta
1. [Philosophy & Principles](01-philosophy.md) — Why Metta exists and what it values
2. [Architecture Overview](02-architecture.md) — System design, layers, and data flow
3. [Workflow Engine](03-workflow-engine.md) — Composable phase DAGs, not rigid pipelines
4. [Context Engine](04-context-engine.md) — Phase-aware loading, budgets, and freshness
5. [Agent System](05-agent-system.md) — Personas, orchestration, and subagent patterns
6. [Spec & Artifact Model](06-spec-model.md) — Specs, deltas, schemas, and state
7. [Execution Engine](07-execution-engine.md) — Batch parallelism, backpressure, and deviation rules
8. [Plugin Architecture](08-plugins.md) — Extensions, presets, hooks, and providers
9. [CLI & Integration](09-cli-integration.md) — CLI design, multi-tool delivery, MCP
10. [Comparison](10-comparison.md) — How Metta differs from existing frameworks
11. [Brownfield Adoption](11-brownfield.md) — Onboarding into existing codebases

---

## Core Ideas (TL;DR)

**From research, six principles emerged:**

1. **Context is the bottleneck** — not planning, not prompting. Every design decision should minimize context waste and maximize signal per token.

2. **Workflows are data, not code** — Phases, artifacts, and dependencies are declarative YAML graphs that users compose and customize without touching framework source.

3. **Agents are specialists, not generalists** — True subagent independence produces better outcomes than one agent roleplaying multiple roles.

4. **Backpressure > Prescription** — Tests, lints, and type-checks steer agent behavior more reliably than longer prompts.

5. **Extensibility is table stakes** — Plugins, hooks, providers, and templates must be first-class from day one, not bolted on later.

6. **Quick-start to full-ceremony is a spectrum** — Solo devs shouldn't pay the cost of enterprise process. The framework should scale up, not force you to scale down.

---

## Quick Start (Proposed UX)

```bash
# Install
npm install -g @mettadata/metta

# Initialize in project
metta init

# Quick mode (solo dev, small feature)
metta quick "add dark mode toggle"

# Full ceremony (team, complex feature)
metta propose "payment processing system"
metta plan
metta execute
metta verify
metta ship
```

---

## Stack

- **Runtime**: Node.js 22+ (ESM only)
- **Language**: TypeScript (strict mode)
- **Validation**: Zod (with `.strict()` for AI-compatible schemas)
- **CLI**: Commander.js
- **Templating**: External YAML/Markdown files (never string literals in code)
- **State**: Structured YAML with schema validation on every read/write
- **Testing**: Vitest
- **MCP**: First-class MCP server with tiered tool loading
