# OpenSpec vs. Metta: Deep-Dive Research

**Date:** 2025-04-15 | **Comparison:** OpenSpec (v1.3.0) → metta (v0.1.0)

---

## What is OpenSpec?

OpenSpec is a lightweight, spec-driven framework for AI-native development built around **fluid, iterative workflows** rather than rigid phase gates. Its philosophy: *fluid not rigid, iterative not waterfall, easy not complex, brownfield-first.* The core innovation is **delta-based specs** — changes describe what's being added/modified/removed relative to a living source-of-truth in `openspec/specs/`, avoiding the burden of restating entire specifications. The system uses **YAML-defined schemas** to define artifact types and dependencies as a directed acyclic graph (DAG), allowing custom workflows. OpenSpec works with 25+ tools (Claude Code, Cursor, etc.) via generated Markdown skills and has two command profiles: a lightweight "core" (`propose → apply → archive`) and an expanded workflow with granular steps (`new → continue → ff → apply → verify → sync → archive`). Stack: TypeScript/Node.js, Commander.js CLI, external templates, flat file persistence.

---

## Metta Context

Metta is a spec-driven framework emphasizing **composable, validated state** and **full ceremony scaling**. It orchestrates a 6-phase lifecycle: propose → plan → execute → verify → finalize → ship. Skills live in `.claude/skills/`, state is stored in `.metta/` and `spec/` directories, and artifacts are validated with Zod on every read/write. Metta includes discovery-driven questioning (mandatory before any spec writing), parallel fan-out patterns (research, review, verification), git worktree isolation, and explicit agent definitions (8 agents with colored banners). Stack: TypeScript strict mode, Node.js ≥22, ESM-only, Zod validation, YAML persistence, Anthropic SDK, remark-parse for spec parsing.

---

## Strengths of OpenSpec

1. **Lightweight schema-driven customization** — Schemas are external YAML files (`schemas/<name>/schema.yaml` + templates) with artifact IDs, glob patterns, and dependency definitions. This lets teams define custom workflows without recompiling. Metta hardcodes workflows (quick/standard/full) in code; OpenSpec lets users fork existing schemas or create new ones via `openspec schema init`. (/home/utx0/Code/metta/referrences/OpenSpec/schemas/spec-driven/schema.yaml, docs/opsx.md:624–645)

2. **Delta specs as first-class construct** — OpenSpec normalizes brownfield work by making delta specs (ADDED/MODIFIED/REMOVED) the standard artifact format. This reduces noise in reviews and prevents copy-paste errors from restating unchanged context. Metta stores specs as full markdown but doesn't yet have explicit delta merge strategies. (/home/utx0/Code/metta/referrences/OpenSpec/docs/concepts.md:346–405)

3. **Fluid actions over phases** — OpenSpec's philosophy rejects phase-locked workflows. `/opsx:continue`, `/opsx:ff`, `/opsx:apply` are actions, not phases; dependencies are enablers, not gates. Real work backtracking is natural (edit specs mid-implementation). Metta's phases feel more linear despite attempting composability. (/home/utx0/Code/metta/referrences/OpenSpec/docs/opsx.md:318–360)

4. **Project configuration injection** — OpenSpec's `openspec/config.yaml` injects tech context and per-artifact rules into all skill instructions. This gives AI tools consistent guidance without copy-paste. Metta generates `CLAUDE.md` for context but doesn't yet support injected per-artifact rules. (/home/utx0/Code/metta/referrences/OpenSpec/docs/opsx.md:60–155)

5. **Progressive rigor** — OpenSpec explicitly encourages lightweight specs ("lite" mode by default) for low-risk changes and full specs only when needed (cross-team, API changes, security). Metta's artifacts feel more formal by design. (/home/utx0/Code/metta/referrences/OpenSpec/docs/concepts.md:155–169)

---

## Weaknesses of OpenSpec

1. **Limited state machine rigor** — OpenSpec's state is filesystem-based (artifact existence) with no atomic validation or conflict detection during multi-change scenarios. Metta uses Zod on every state transition and detects spec merges via content hashing. Risk: silent conflicts in parallel changes. (/home/utx0/Code/metta/referrences/OpenSpec/schemas/spec-driven/schema.yaml has no validation layer; compare metta's state-store.ts and artifact-store.ts)

2. **Schema design is loose** — Artifact IDs are strings without namespacing; templates are markdown files without type information. If a template expects certain context keys, there's no contract enforcement. Metta's Zod schemas define exact contracts. (/home/utx0/Code/metta/referrences/OpenSpec/docs/opsx.md:590–607)

3. **Archive merging is manual/error-prone** — When archiving, delta specs merge into main specs via string replacement of requirement blocks. The algorithm relies on exact header matching; whitespace sensitivity and missing requirements can silently corrupt specs. Metta's planned spec-merger uses requirement-level hashing and conflict detection. (/home/utx0/Code/metta/referrences/OpenSpec/docs/concepts.md:543–557)

4. **No parallel change safety** — OpenSpec's "parallel changes" pattern works, but conflicts are a user concern (Bulk Archive inspects codebase to resolve). Metta's spec model includes parallel change detection and per-requirement conflict markers. (/home/utx0/Code/metta/referrences/OpenSpec/docs/workflows.md:149–220)

5. **Agent orchestration is implicit** — OpenSpec generation is tool-agnostic (produces markdown skills) but doesn't define how AI agents coordinate across multi-step workflows. No explicit agent types or inter-agent contracts. Metta defines 8 explicit agent types (proposer, researcher, architect, etc.) with colored banners and structured pass-through contracts. (/home/utx0/Code/metta/referrences/OpenSpec has no agent definitions; metta has `.claude/agents/`)

---

## Comparison with Metta

| Dimension | OpenSpec | Metta |
|-----------|----------|-------|
| **Workflow model** | Fluid actions, no phases | Composable DAG, 6 explicit phases |
| **Customization** | Schema files (YAML + templates) | Hardcoded workflows (quick/standard/full) |
| **Spec format** | Delta-first (ADDED/MODIFIED/REMOVED) | Full markdown, no delta abstraction |
| **State validation** | Filesystem existence only | Zod schemas on every read/write |
| **Conflict detection** | Manual (bulk-archive inspects code) | Content-hash based, requirement-level |
| **Agent orchestration** | Implicit (tool-agnostic markdown) | Explicit (8 agent types, colored banners) |
| **Discovery gate** | Optional | Mandatory (discovery phase in propose) |
| **Parallel execution** | Patterns documented, user manages | Built-in fan-out (research, review, verify) |
| **Archive strategy** | String-based requirement matching | Planned: requirement-level hashing |
| **Git safety** | Not mentioned | Worktree isolation per subagent |
| **Config injection** | `config.yaml` + rules per artifact | CLAUDE.md static generation |

**RFC 2119 usage:** Both use SHALL/MUST/SHOULD in spec scenarios, but OpenSpec documents this normatively in concepts.md; metta follows RFC 2119 implicitly via schemas.

---

## Recommended Improvements for Metta

### 1. **Adopt external schema-driven workflows**
   - **Source:** OpenSpec's `schemas/<name>/schema.yaml` + template pattern (docs/opsx.md:590–607, schemas/spec-driven/schema.yaml)
   - **Why:** Teams can customize artifact types, dependencies, and instructions without rebuilding metta. Lowers barrier to experimentation.
   - **Implementation idea:** Migrate `.metta/workflows/` from hardcoded TypeScript to YAML schema definitions. Keep the three built-in workflows (quick/standard/full) as schema templates. Add `metta schema init` and `metta schema validate` commands. Store project schemas in `spec/schemas/` (versioned) and global in `~/.metta/schemas/`.

### 2. **Implement delta-first spec format with content hashing**
   - **Source:** OpenSpec's delta specs (docs/concepts.md:346–405) + metta's planned spec-merger with hashing
   - **Why:** Reduces noise in spec reviews, makes brownfield changes first-class, and enables safe concurrent edits via requirement-level hashing (not full-spec replacement).
   - **Implementation idea:** Introduce a `DeltaSpec` type in spec-model.ts. When creating spec artifacts in planning phase, generate deltas (ADDED/MODIFIED/REMOVED sections) instead of full specs. During finalize, run spec-merger with requirement-level content hashing to detect conflicts. Store hash of each requirement in spec metadata.

### 3. **Add project config injection per artifact**
   - **Source:** OpenSpec's `openspec/config.yaml` with `context` and `rules` (docs/opsx.md:60–155)
   - **Why:** Keeps skill instructions DRY and consistent. Tech context, conventions, and per-artifact rules are injected once, not repeated in 8+ skill files.
   - **Implementation idea:** Extend `.metta/config.yaml` with `context` (tech stack, conventions) and `rules` (keyed by artifact ID: proposal, spec, design, tasks, etc.). During CLAUDE.md generation and skill generation, prepend context and append matching rules as `<context>...</context>` and `<rules>...</rules>` tags. Validate artifact IDs against the active workflow schema.

### 4. **Make discovery gate optional and fluent**
   - **Source:** OpenSpec's "exploratory" workflow + optional discovery (docs/workflows.md:99–147)
   - **Why:** Metta's discovery is mandatory; teams shipping quick fixes or repeating patterns benefit from skipping it. OpenSpec's `/opsx:explore` lets users think-pair without scaffolding.
   - **Implementation idea:** Add a `--skip-discovery` flag to `metta quick` and `metta propose`. Keep discovery mandatory for `metta propose` by default but allow override. Add a new `metta explore` command that spawns a thinking partner (metta-discovery agent) without creating artifacts.

### 5. **Explicit agent type contracts and inter-agent passing**
   - **Source:** OpenSpec's implicit tool-agnostic design + metta's 8 agent types
   - **Why:** Currently metta agents are defined but the pass-through protocol (what proposer outputs → what researcher consumes) is informal. Explicit contracts reduce hallucination.
   - **Implementation idea:** Define agent input/output schemas in `.claude/agents/`. Each agent (proposer, researcher, architect, planner, executor, reviewer, verifier) has an `input.schema.json` and `output.schema.json` (Zod or JSON Schema). The orchestrator validates outputs before passing to the next agent. Store artifact contents as structured objects (not free text) where feasible.

### 6. **Parallel change conflict detection with requirement-level granularity**
   - **Source:** OpenSpec's bulk-archive pattern (docs/workflows.md:194–220) + metta's planned conflict detection
   - **Why:** Metta's current architecture can detect overlaps but doesn't yet support requirement-level merging. Two changes can safely modify different requirements in the same spec file without conflicts.
   - **Implementation idea:** Extend spec-merger to track changes at the requirement level (not just file level). When archiving multiple changes, compute a merge graph: requirements modified by change A vs. change B. If no overlap, merge both. If overlap, prompt user with requirement-level diffs and ask which version to keep. Store merge decisions in archive metadata.

### 7. **Progressive rigor mode for lightweight changes**
   - **Source:** OpenSpec's "lite spec" philosophy (docs/concepts.md:155–169)
   - **Why:** Metta's templates are formal; teams fixing bugs or adding small features may over-engineer. Lite mode: skip design and research, use shorter templates, expect shorter specs.
   - **Implementation idea:** Add a `lite` profile to workflows alongside `quick` and `standard`. Lite artifacts skip design/research, use abbreviated templates (proposal is 1 paragraph, spec has no scenarios), and bypass review loops for low-risk changes (fixes, docs, small features).

---

## Conclusion

OpenSpec excels at **lightweight customization and delta-based specs**; metta excels at **validated state and explicit agent orchestration**. The most impactful borrowings are (1) schema-driven workflows, (2) delta-first specs with content hashing, and (3) injected config rules. These give metta user customization power without sacrificing rigor.
