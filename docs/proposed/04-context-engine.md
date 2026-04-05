# 04 — Context Engine

## Core Problem

Context is the scarcest resource in AI-assisted development. A 200K token window has ~176K usable tokens. Loading everything wastes budget. Loading too little produces hallucinations. The Context Engine manages this tradeoff systematically.

---

## Design

### Context Manifests

Each artifact type declares what context it needs:

```yaml
# Built into artifact type definitions
context_manifests:
  intent:
    required: []
    optional: [project_context, existing_specs]
    budget: 20000  # tokens

  spec:
    required: [intent]
    optional: [project_context, existing_specs, research]
    budget: 40000

  design:
    required: [intent, spec]
    optional: [architecture, project_context]
    budget: 60000

  tasks:
    required: [design, spec]
    optional: [architecture]
    budget: 40000

  execution:
    required: [tasks]
    optional: []
    budget: 10000  # Minimal — executor gets fresh context per task

  verification:
    required: [spec, tasks, summary]
    optional: [design]
    budget: 50000
```

### Budget Enforcement

The Context Engine tracks token usage against budgets:

```
ContextEngine.load(manifest) → LoadedContext
  1. Load required files (fail if missing)
  2. Measure tokens used
  3. Load optional files in priority order until budget reached
  4. If over budget, truncate lowest-priority content
  5. Return LoadedContext with token accounting
```

Budget overruns are warnings, not errors — the engine truncates gracefully rather than failing.

### Token Counting

Token counting uses a **character-based estimator** as the default: 4 characters ≈ 1 token. This is fast, has no dependencies, and is accurate enough for budget enforcement where the goal is "don't waste context," not "hit exactly 40,000 tokens." Model-specific tokenizers can be provided via the Provider Registry as an optional enhancement. Budgets in context manifests are approximate targets, not hard limits — the engine logs actual vs budget for tuning over time.

---

## Loading Strategies

### 1. Full Load
Load entire file. Used for small artifacts (intent, tasks).

### 2. Section Extraction
Load specific sections from larger files. Used when only part of a spec or design is relevant.

```typescript
contextEngine.extract(content, {
  sections: ["Requirements", "Scenarios"],
  exclude: ["Changelog", "Archive"]
})
```

### 3. Heading Skeleton
For files exceeding budget: load all headings + first paragraph per section. Preserves structure while dramatically reducing tokens. Used for large specs and architecture docs.

```
Full: 50,000 tokens
Skeleton: 3,000 tokens (94% reduction)
```

### 4. Milestone Scoping
For roadmap/planning files: extract only the current milestone's content. Eliminates noise from past and future milestones.

### 5. Delta-Only Loading
For spec changes: load only the ADDED/MODIFIED/REMOVED sections, not the full spec. Used during verification to check what changed.

---

## Context Freshness

### Problem
Agent conversations accumulate stale context. A spec modified 50 messages ago may no longer match what's on disk.

### Solution: Fresh Context Markers

Every loaded context block includes a freshness marker:

```xml
<context source="spec/specs/auth/spec.md" hash="sha256:abc123" loaded_at="2026-04-04T12:00:00Z">
  ... content ...
</context>
```

The execution engine can check freshness before acting:
```bash
metta context check  # Reports stale context in current session
```

### Solution: Per-Task Fresh Context (Ralph Pattern)

For execution, each task gets a fresh context load. The orchestrator spawns executors with clean windows. No accumulated context from previous tasks.

```
Orchestrator (lean, 15K tokens):
  └── Executor Task 1 (fresh 176K) → commit → exit
  └── Executor Task 2 (fresh 176K) → commit → exit
  └── Executor Task 3 (fresh 176K) → commit → exit
```

---

## Context Resolution Algorithm

```
resolve(phase, artifact, change) → ContextManifest:

1. Get artifact's declared context manifest
2. Resolve required files:
   a. For each required source:
      - If it's another artifact: load from change directory
      - If it's project_context: load from .metta/config.yaml → project_context path
      - If it's existing_specs: load from spec/specs/ (relevant capabilities only)
   b. Fail if any required source is missing

3. Calculate remaining budget after required files

4. Resolve optional files in priority order:
   a. Score each optional source by relevance to current artifact
   b. Load highest-scoring first
   c. Stop when budget is reached
   d. Truncate last file if it would exceed budget

5. Apply loading strategy per file:
   - < 5K tokens: full load
   - 5K-20K tokens: section extraction (if sections declared)
   - > 20K tokens: heading skeleton

6. Return ContextManifest with:
   - loaded files with content
   - token accounting (used / budget)
   - freshness markers
   - truncation report (what was cut and why)
```

---

## Agent-Specific Budgets

Different agents have different context needs:

```yaml
# .metta/agents/executor.yaml
context_budget: 10000   # Minimal — just the task and verify criteria

# .metta/agents/architect.yaml
context_budget: 80000   # Generous — needs broad system understanding

# .metta/agents/verifier.yaml
context_budget: 50000   # Moderate — specs + implementation summary
```

The Context Engine respects agent budgets when loading context for agent-specific operations.

### Budget vs Window

An agent's `context_budget` controls how many tokens the Context Engine loads into the agent's instructions — project context, specs, task details. This is **not** the agent's total context window.

When an executor spawns with `context_budget: 10000`, it receives ~10K tokens of framework-curated context inside a fresh ~176K token window. The remaining window is available for the AI to read code, think, and generate output.

The orchestrator's ~15K budget is higher because it needs the batch plan, gate results, and deviation log — coordination metadata that executors don't carry.

---

## Caching

### LRU Cache with Content-Hash Keys

```
Cache key: sha256(file_path + file_content_hash)
Cache value: { tokens: number, content: string, sections: Map }
TTL: 5 minutes (configurable)
```

If a file hasn't changed (same content hash), its parsed/tokenized form is reused. This prevents the re-parsing overhead that plagues OpenSpec and BMAD.

### Cache Invalidation

- File modification triggers cache eviction (via fs.watch)
- Git operations (checkout, merge, rebase) flush entire cache
- Manual: `metta cache clear`

---

## Instrumentation

The Context Engine reports usage metrics:

```bash
metta context stats
```

```
Current session:
  Total tokens loaded:  142,000
  Budget utilization:   78%
  Cache hit rate:       62%
  Truncations:          3 files
  Stale context:        0 files

Per-phase breakdown:
  propose:    18,000 / 20,000 (90%)
  spec:       35,000 / 40,000 (88%)
  design:     52,000 / 60,000 (87%)
  tasks:      28,000 / 40,000 (70%)
  execute:     9,000 / 10,000 (90%)
```

This helps users tune budgets and identify waste.
