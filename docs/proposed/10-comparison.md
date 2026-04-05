# 10 — How Metta Compares

> Comparisons reflect framework state as of April 2026. Capabilities may have changed since this analysis.

## Feature Matrix

| Feature | OpenSpec | Spec Kit | GSD | BMAD | Taskmaster | Ralph | **Metta** |
|---------|---------|----------|-----|------|------------|-------|-----------|
| Workflow model | Artifact DAG | Phase-gated | Batch-parallel | Multi-agent SDLC | Task DAG | Loop | **Composable artifact DAG** |
| Custom workflows | Custom schemas | Extensions | No (hardcoded) | Modules | No | Manual | **YAML graphs, extensible** |
| Context management | Per-artifact | Per-phase | Phase-aware | Full reload | LRU cache | Fresh/iteration | **Budget-enforced, phase-aware** |
| Agent system | None | None | Tool-scoped | 7 personas | Provider roles | None | **Pluggable personas + scoping** |
| Parallel execution | No | No | Batches + worktrees | Subagent fan-out | No | Loop | **Batches + worktrees + overlap detect** |
| Backpressure gates | Validation only | Checklist | Quality gates | Honor system | None | Tests steer | **Typed gates, pluggable** |
| Spec evolution | Delta (4 ops) | Replace | N/A | Manual | N/A | Manual | **Delta (6 ops) + conflict detect** |
| Plugin system | Custom schemas | Extensions+presets | Hooks | Modules | None | None | **5 extension points** |
| Multi-tool support | 25+ adapters | 26 integrations | 10+ runtimes | 6+ IDEs | MCP | CLI-agnostic | **Adapter pattern + MCP** |
| MCP server | No | No | No | No | Tiered (7/14/36) | No | **Tiered (7/14/25+)** |
| State validation | Zod (partial) | None | None | None | Zod (schemas) | None | **Zod on every read/write** |
| Parallel change safety | Broken (known bug) | None | None | None | None | None | **Content-hash versioning** |
| Quick-start path | Profile switch | No | Quick mode | Quick Dev | parse-prd | N/A | **Default is quick path** |
| Error recovery | Partial | None | Limited | None | None | Loop retries | **Resume from checkpoint** |
| Testing | 12,964 LOC | 40+ files | 90+ files | None | 217 tests | None | **E2E + unit + integration** |

---

## What Metta Takes From Each

### From OpenSpec
**Adopted**: Artifact dependency graphs, delta-based spec evolution, adapter pattern for multi-tool delivery, topological sort for build order, profile/workflow selection.

**Improved**: Fixed parallel change collision (content-hash versioning), moved templates from TypeScript strings to external files, added scenario-level delta operations, added dry-run for merges.

### From Spec Kit
**Adopted**: Extension/preset plugin architecture, hash-based safe uninstall, layered configuration (defaults -> project -> local -> env), hook system for workflow events, integration registry pattern.

**Improved**: Removed mandatory heavyweight process (quick path is default), made it scripting-friendly (no interactive-only flows), added template composition, reduced to one language (TypeScript vs Python).

### From GSD
**Adopted**: Phase-aware context loading, batch-based parallel execution with worktree isolation, intra-batch file overlap detection, thin orchestrator + heavy executor pattern, XML-like task format with verify/done criteria, deviation rules, statusline context warnings.

**Improved**: Made phase types configurable (not hardcoded enum), added schema validation on state, made deviation rules typed and logged, added formal gate results instead of ad-hoc quality checks.

### From BMAD
**Adopted**: True subagent independence (not roleplay), persona-based agent definitions, graceful degradation when subagents unavailable, mode system (interactive/autonomous/supervised), lossless context capture.

**Improved**: Made agents pluggable YAML definitions (not hardcoded personas), added tool scoping enforcement, added capability-based agent resolution, removed enterprise ceremony (no sprint planning, retrospectives).

### From Taskmaster
**Adopted**: Tiered MCP tool loading, role-based model configuration (main/research/fallback), provider registry with unified interface, Zod schemas with `.strict()` for AI-compatible structured outputs, LRU caching for context.

**Improved**: Dependency injection over singleton registry, ESM-only (no CommonJS debt), separated persistence from business logic, added plugin system for custom providers.

### From Ralph
**Adopted**: Fresh context per task execution (no pollution), backpressure as primary control mechanism, plan as disposable artifact, sandbox security philosophy, simplicity over orchestration complexity.

**Improved**: Wrapped the pattern in a framework (not just a bash script), added typed state management, added formal gate infrastructure, kept the simplicity philosophy as the default (quick path).

---

## What Metta Deliberately Avoids

| Anti-Pattern | Source | Why We Avoid It |
|-------------|--------|-----------------|
| Hardcoded phase types | GSD | Workflows should be data, not code |
| Templates as code strings | OpenSpec | Users must customize without forking |
| Regex-based spec parsing | OpenSpec, Spec Kit | Fragile; use structured formats + conventions |
| Singleton registries | Taskmaster | Untestable; prefer dependency injection |
| Mixed CommonJS/ESM | Taskmaster | Technical debt from day one |
| Honor-system test verification | BMAD | Gates must be programmatic, not trust-based |
| 50KB+ READMEs | GSD | Docs should be modular and discoverable |
| Unvalidated state files | GSD, Ralph | Silent corruption causes downstream failures |
| Silent parallel collisions | OpenSpec | Design for concurrent changes from day one |
| Mandatory heavyweight process | Spec Kit | Quick path must be the default |
| No error recovery | All | Resume from checkpoint is table stakes |
| Sprint ceremonies | BMAD | Not a project manager; use Linear/Jira |

---

## Positioning

```
                    Lightweight ────────────────────── Heavyweight
                         │                                  │
  Ralph ─── Metta Quick ─── GSD ─── OpenSpec ─── Metta Full ─── Spec Kit ─── BMAD
                         │                                  │
                    Solo Dev ──────────────────────── Team/Enterprise
```

Metta spans the spectrum because workflow selection determines ceremony level:
- `metta quick` is lighter than GSD
- `metta propose` (standard) is comparable to OpenSpec
- `metta propose --workflow full` approaches Spec Kit/BMAD depth
- All use the same engine, same plugins, same agents

The key insight: **ceremony should scale with complexity, not be fixed by the framework.**
