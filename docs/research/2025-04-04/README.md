# Spec-Driven Development Framework Research

Comparative analysis of six SDD frameworks as reference material for building our own.

## Individual Analyses

- [OpenSpec](openspec.md) — Lightweight iterative spec framework (Fission AI)
- [Spec Kit](spec-kit.md) — Phase-gated spec toolkit (GitHub)
- [Get Shit Done](get-shit-done.md) — Context engineering & meta-prompting (GSD)
- [BMAD-METHOD](bmad-method.md) — Multi-agent SDLC orchestration
- [Taskmaster AI](claude-task-master.md) — Task decomposition & sequencing
- [Ralph Wiggum Loop](ralph-wiggum.md) — Loop-until-green execution pattern

---

## Comparative Matrix

| Dimension | OpenSpec | Spec Kit | GSD | BMAD | Taskmaster | Ralph |
|-----------|---------|----------|-----|------|------------|-------|
| **Type** | Framework | Toolkit | System | Orchestrator | Task Manager | Pattern |
| **Stack** | TS/Node | Python | TS/Node | Markdown/YAML | TS/Node | Bash |
| **Agent Integrations** | 25+ | 26 | 10+ | 6+ | MCP (any) | CLI-agnostic |
| **Workflow Model** | Artifact DAG | Phase-gated | Wave-parallel | Multi-agent SDLC | Task DAG | Loop-until-done |
| **Context Management** | Per-artifact | Per-phase | Phase-aware loading | Full file reload | LRU cache | Fresh per iteration |
| **Extensibility** | Custom schemas | Extensions+Presets | Hardcoded phases | Modules+Skills | Fixed tools | Manual adaptation |
| **Testing** | 12,964 LOC | 40+ files | 90+ files | None | 217 tests | None |
| **Solo Dev UX** | Good | Heavyweight | Good | Verbose | Good | Minimal |
| **Team Support** | Weak (collision bug) | Basic | Single-user | Single-session | Single-user | Single-agent |

---

## What Each Does Best

### OpenSpec — Artifact Dependency Graphs
The DAG-based workflow model is the most flexible. Artifacts declare dependencies, topological sort determines build order. Custom schemas let teams define their own workflows. Delta-based spec evolution (ADDED/MODIFIED/REMOVED) handles brownfield projects well.

### Spec Kit — Extensibility Architecture
Extensions, presets, hooks, layered configuration, catalog support with priority stacking. The most composable and extensible system. Hash-based safe uninstall is a nice touch. The integration registry with mixins (Markdown/TOML/Skills) is clean.

### GSD — Context Engineering
Phase-aware context loading is the standout innovation. Each phase gets only the files it needs. Wave-based parallel execution with intra-wave file overlap detection. Thin orchestrator + heavy executor pattern keeps the main context lean. Quality gates (schema drift, security enforcement, scope reduction) are practical.

### BMAD — Multi-Agent Persona Orchestration
True persona separation with subagent independence produces genuine disagreement and catches blind spots. Lossless distillation captures information summaries would lose. The brainstorming system (62 CSV-driven techniques with anti-bias rotation) is unique. Full SDLC coverage from brainstorming through retrospective.

### Taskmaster — Multi-Model Provider Abstraction
20+ AI providers through a unified interface with role-based model selection (main/research/fallback). Tiered MCP tool loading (7/14/36+ tools) optimizes context window. Task decomposition with recursive subtask generation and circular dependency detection is solid.

### Ralph — Simplicity & Context Purity
Dumb bash loop + file I/O = zero orchestration complexity. Fresh context per iteration prevents all context degradation. Backpressure as primary control mechanism (tests/lints steer behavior). Plan is disposable — regenerate cheaply. The purest expression of "context is everything."

---

## Common Weaknesses Across All

1. **No team collaboration** — All assume single user or single session. No async handoffs, no conflict resolution, no approval workflows, no integration with project management tools.

2. **Error recovery** — Partial failures leave inconsistent state across the board. No transaction semantics. Limited or no retry logic.

3. **Testing gaps** — None have E2E tests for full workflow execution. Most mock AI interactions. Real multi-tool integration untested.

4. **Documentation** — All have good READMEs but lack troubleshooting guides, migration guides, and architecture decision records.

5. **Extensibility friction** — Even the most extensible (Spec Kit) has limits. Most have hardcoded assumptions that require forking to change.

---

## Patterns Worth Adopting

### From OpenSpec
- Artifact dependency graphs (DAGs) for flexible workflow ordering
- Delta-based spec evolution for brownfield support
- Adapter pattern for multi-tool command delivery (~50 lines per tool)

### From Spec Kit
- Extension/preset plugin architecture with manifest validation
- Hash-based safe uninstall tracking
- Layered configuration (defaults -> project -> local -> env)
- Hook system (before/after core workflows)

### From GSD
- Phase-aware context loading (don't load everything, load what this phase needs)
- Wave-based parallel execution with overlap detection
- Thin orchestrator + heavy executor separation
- Quality gates (schema drift, scope reduction, security enforcement)
- XML task format with explicit verify + done criteria

### From BMAD
- True subagent independence (not roleplay) for genuine diverse perspectives
- Lossless distillation over lossy summarization
- Mode system (guided/yolo/autonomous) for different oversight cadences
- CSV-driven technique libraries separating data from logic

### From Taskmaster
- Tiered tool loading for MCP (reduce token usage by only loading what's needed)
- Role-based model configuration (main/research/fallback)
- Provider registry with unified interface across 20+ AI backends
- Zod schemas with `.strict()` for AI-compatible structured outputs

### From Ralph
- Fresh context per iteration (prevent context degradation)
- Backpressure as primary control (tests/lints steer, not prescriptive prompts)
- Plan as disposable artifact (cheap to regenerate)
- Sandbox as security boundary (full permissions inside, containment outside)

---

## Anti-Patterns to Avoid

1. **Hardcoded phase types** (GSD) — Make phases configurable from the start
2. **Templates as TypeScript string literals** (OpenSpec) — Keep templates as external files
3. **Regex-based markdown parsing** (OpenSpec, Spec Kit) — Use proper parsers or structured formats
4. **Singleton provider registries** (Taskmaster) — Prefer dependency injection for testability
5. **Mixed CommonJS/ESM** (Taskmaster) — Pick one module system and commit
6. **Honor-system test verification** (BMAD) — Enforce test gates programmatically
7. **50KB+ READMEs** (GSD) — Keep docs modular and discoverable
8. **No schema validation on state files** (GSD, Ralph) — Validate state on read/write
9. **Silent parallel change collisions** (OpenSpec) — Design for concurrent changes from day one
10. **Mandatory heavyweight process** (Spec Kit) — Always provide a quick-start escape hatch
