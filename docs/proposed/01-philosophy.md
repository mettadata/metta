# 01 — Philosophy & Principles

## Why Metta Exists

Every existing SDD framework makes the same bet: **structured specs produce better AI-generated code than raw prompts.** They're right. But each framework also makes unnecessary tradeoffs:

- OpenSpec is flexible but has critical parallel change collision bugs
- Spec Kit is extensible but heavyweight — no escape hatch for simple work
- GSD has brilliant context engineering but hardcodes its phase types
- BMAD has great multi-agent orchestration but no automated validation
- Taskmaster has excellent provider abstraction but legacy architecture debt
- Ralph has the purest context model but is a pattern, not a framework

Metta takes the position that these tradeoffs are not inherent to spec-driven development. They're artifacts of frameworks that grew organically rather than being designed holistically.

---

## Design Principles

### 1. Context Budget Over Context Window

Every other framework thinks in terms of "context window" — how much fits. Metta thinks in terms of **context budget** — how much should you spend.

Each phase, each agent, each iteration has a declared budget. The Context Engine enforces it. If a spec is 50K tokens but the current phase only needs the requirements section, load only that section. If an agent is doing verification, it doesn't need implementation details.

**Derived from**: GSD's phase-aware loading + Ralph's fresh-context-per-iteration.

### 2. Workflows Are Graphs, Not Pipelines

No framework should hardcode the sequence of phases. A startup building an MVP has a different workflow than an enterprise migrating a legacy system. Metta represents workflows as **directed acyclic graphs of artifacts**, where:

- Each artifact declares its dependencies
- The engine computes build order via topological sort
- Users compose custom workflows from a library of artifact types
- The same engine handles "quick mode" (2 artifacts) and "full ceremony" (12 artifacts)

**Derived from**: OpenSpec's artifact DAG + Spec Kit's handoff pattern.

### 3. Agents Are Injected, Not Hardcoded

BMAD proves that persona separation produces better outcomes. But hardcoding 12 agent names is brittle. Metta treats agents as **pluggable specialists** registered through a manifest:

```yaml
# .metta/agents/architect.yaml
name: architect
persona: "Senior systems architect focused on simplicity and maintainability"
capabilities: [design, review, adr]
tools: [Read, Grep, Glob, Bash]  # scoped tool access
context_budget: 80000  # tokens
```

Users can add, remove, or modify agents without touching framework code.

**Derived from**: BMAD's persona system + GSD's tool scoping per agent type.

### 4. Backpressure Is Infrastructure

Ralph's insight is profound: tests steer agent behavior more reliably than prompts. But Ralph leaves this as a pattern. Metta makes it infrastructure:

- **Verification gates** are declared per-artifact in the workflow graph
- **Test runners** are registered as plugins (not assumed to be `npm test`)
- **Gate results** feed back into the execution loop automatically
- **Failure diagnosis** routes to the correct layer (intent vs spec vs code)

**Derived from**: Ralph's backpressure philosophy + GSD's quality gates + BMAD's Quick Dev diagnostics.

### 5. State Is Typed and Validated

Every framework stores state in markdown or JSON with no schema validation. This causes silent corruption, field drift, and stale reads. Metta treats state as a **typed, validated data layer**:

- Every state file has a Zod schema
- Every read validates against the schema (fail-fast, not fail-silently)
- Every write validates before persisting
- Migrations handle schema evolution between versions
- Optimistic locking prevents concurrent write corruption

**Derived from**: Taskmaster's Zod schemas + lessons from GSD/Ralph's unvalidated state.

### 6. The Quick Path Is the Default Path

Spec Kit requires constitution + specify + plan + tasks + implement for any work. That's fine for a new product. It's absurd for "add a loading spinner."

Metta's default is the **quick path**: describe what you want, get a lightweight spec, execute, verify. The full ceremony is opt-in, not opt-out. Each additional phase is a choice, not a requirement.

```
Quick:    intent -> execute -> verify
Standard: intent -> spec -> design -> tasks -> execute -> verify
Full:     research -> intent -> spec -> design -> architecture -> tasks -> execute -> verify -> ship
```

All three use the same engine. The difference is which artifacts are in the workflow graph.

**Derived from**: GSD's quick mode + BMAD's Quick Dev + Ralph's simplicity philosophy.

### 7. Parallel Changes Are First-Class

OpenSpec has a critical bug: parallel changes to the same spec silently overwrite each other. Every other framework ignores this entirely. Metta designs for concurrent changes from day one:

- Specs are versioned with content hashes
- Changes declare a base version
- Merge detects conflicts at the requirement level (not file level)
- Conflict resolution is interactive, not silent

**Derived from**: OpenSpec's parallel-merge-plan (the fix, not the bug).

### 8. Plugins Over Forks

If changing a behavior requires forking the framework, the framework failed. Metta provides five extension points, each with a clear contract:

1. **Workflow plugins** — add new artifact types and phases
2. **Agent plugins** — add new specialist personas
3. **Provider plugins** — add new AI model backends
4. **Gate plugins** — add new verification/quality checks
5. **Hook plugins** — run code before/after any framework event

**Derived from**: Spec Kit's extension architecture + GSD's hook system + Taskmaster's provider registry.

---

## Non-Goals

- **Not an IDE** — Metta works with any AI tool via command delivery. No VS Code fork.
- **Not a project manager** — No sprints, story points, or velocity tracking. Use Linear/Jira for that.
- **Not a CI/CD system** — Metta orchestrates local development. Deployment is out of scope.
- **Not model-specific** — Metta works with any LLM that can read instructions and produce structured output.
