# claude-task-master vs metta

## 1. What is claude-task-master?

Claude-task-master is a **multi-provider AI task management system** that parses product requirements into structured JSON task hierarchies and exposes them across CLI, MCP, and extension interfaces. Philosophy: **PRDs → Tasks → Subtasks → Status tracking** with AI-powered complexity analysis, dependency resolution, and cross-provider model switching. Monorepo (11+ packages) with providers for Anthropic, OpenAI, Gemini, Perplexity, xAI, Groq, and CLI bridges. Boasts 42+ MCP tools with tiered loading (core/standard/all). Focuses on specification decomposition and status flow, with research-backed task expansion and complexity reporting.

## 2. Metta Context & AI Integration Patterns

Metta is a spec-driven development orchestrator, not a task manager. Models **changes** (not tasks) through a 6-7 phase workflow. Core: specs as living documents with delta-based versioning, parallel safety, typed state (Zod), composable workflows. AI via Anthropic SDK only, instruction-based delivery to Claude Code (skills + agents), token-aware context budgeting.

- Task Master: multi-provider factory with CLI-configurable model selection; research model (Perplexity) as optional tier; prompts embedded in commands; streaming UX; MCP tool schemas.
- Metta: single provider (Anthropic) with SDK; YAML/markdown prompt templates in dist at build time; object generation with Zod parsing; 8-agent system with personas; skill delivery via markdown; per-phase context budgeting with staleness detection.
- Key difference: Task Master routes AI calls per command; Metta routes through agent system with role-based prompts and fan-out parallelism.

## 3. Strengths of claude-task-master

- **Multi-provider ecosystem:** 15+ model providers with CLI model switching; no vendor lock-in; different models per role (main/research/fallback).
- **Mature MCP server:** 42+ tools with tiered loading; reduces context window bloat.
- **Rich task metadata:** Hierarchical subtasks (1.1, 1.2, 1.1.1), dependencies, complexity scoring (1-10), priority, test strategies.
- **Research-backed generation:** Perplexity integration for fact-grounded task expansion; complexity analysis with AI recommendations.
- **Iterative refinement UX:** `/next`, cross-tag task movement, PRD re-parsing with --append, update-from-ID cascading.
- **VSCode/Cursor/Windsurf native:** Direct MCP installation, no CLI bridging required.

## 4. Weaknesses of claude-task-master

- **Task-centric, not change-centric:** No lifecycle beyond status (pending→done). No review, verification, or gates.
- **No git safety:** State in `.taskmaster/tasks/tasks.json`; no branch isolation, no conflict detection, no atomic archival.
- **JSON file-based state, no transactions:** Synchronous writes; no rollback, atomicity, locking. Crashes corrupt state.
- **Single-threaded prompting:** Sequential operations; no parallel research or review loops.
- **Limited spec evolution:** Tasks are mutable but specs are implicit (PRD → tasks, no formal spec model with versioning or deltas).
- **No pluggable gates:** No built-in tests/lint/typecheck automation.
- **Monolithic CLAUDE.md context:** Loads all task state; no budgeting per phase.

## 5. Comparison: Side-by-Side

| Dimension | claude-task-master | Metta |
|---|---|---|
| Unit of work | Task (hierarchical, status) | Change (phase-driven spec + artifacts) |
| Lifecycle | Linear (pending→done) | DAG workflow with feedback loops |
| State | JSON files | YAML + git branches |
| Spec model | Implicit (PRD input) | Explicit (markdown with markers, deltas, content hash) |
| AI providers | 15+ switchable | Anthropic only |
| AI decomposition | Per-command prompts | Per-agent prompts (proposer, architect, executor, verifier) |
| Parallelism | Sequential | Parallel fan-out (2-4 research, 3x review, 3x verify) |
| Quality gates | Manual | Pluggable YAML gates automated |
| Git safety | None | Per-change branch + worktree isolation + auto-commit |
| Conflict detection | None | Spec-level (content hash) |
| Delivery | MCP + CLI + VSCode | CLI + Claude Code skills + agents |
| Discovery | Manual PRD | Mandatory orchestrator-driven questioning |

## 6. Recommended Improvements for Metta

1. **Multi-provider flexibility** — Add provider registry with pluggable factory (OpenAI, Gemini, Perplexity fallback). Allow CLI flag `--model` to switch providers. Keep Anthropic as default but reduce lock-in.
2. **MCP server with tiered tool loading** — Add `mcp-server.ts` exposing core/standard/all tiers. Enables native Cursor/VS Code integration without CLI bridging.
3. **Complexity scoring + expansion** — `metta analyze-complexity` command to score phases and recommend subtask breakdown. JSON report integrated into planning.
4. **Research-model tier (Perplexity)** — Split providers into main (reasoning) vs. research (grounding). Use research model during discovery/architecture to fact-check stack choices, best practices, API changes.
5. **Lightweight task metadata in specs** — Optionally embed `<!-- task id="1.1" priority="high" -->` markers. Task Master's subtask hierarchy is more explicit than our checklists.
6. **Spec conflict resolution UI** — When re-parsing or merging, show diff of requirements (ADDED/MODIFIED/REMOVED) and prompt user on conflicts. Store deltas in change artifacts.
7. **Adaptive per-phase context budgeting** — Staleness detection, priority eviction, phase-specific loading strategies (skeleton/section/full).

---

**Key Insight:** Task Master excels at task orchestration and multi-provider flexibility; Metta excels at lifecycle governance and state safety. Hybrid: multi-provider prompting + spec-driven phases + parallel review/verify + pluggable gates + richer task metadata.
