# Taskmaster AI (Claude Task Master) Analysis

**Repo**: `referrences/claude-task-master/`
**By**: Eyal Toledano
**Stack**: Node.js/TypeScript monorepo (pnpm workspaces), Zod, Commander.js, FastMCP
**Philosophy**: AI-powered task decomposition and sequencing for agent-driven development

---

## Architecture

### Monorepo Layout
- `/src/` — Core domain logic (shared across CLI and MCP)
- `/apps/cli/` — TypeScript CLI (Commander.js)
- `/apps/mcp/` — MCP server implementation
- `/mcp-server/` — FastMCP server wrapper with Sentry instrumentation
- `/scripts/modules/` — Legacy task management functions (CommonJS)
- `/packages/` — Internal packages (@tm/core, @tm/cli, @tm/mcp, AI provider SDKs)

### Core Modules

**Task Manager** (`scripts/modules/task-manager/`): CRUD, expansion, complexity analysis, subtask generation, dependency resolution with circular dependency detection, tag-based multi-context support.

**Provider Registry** (Singleton): Dynamic AI provider registration supporting 20+ providers (Anthropic, OpenAI, Google, Perplexity, xAI, Groq, Bedrock, Azure, Mistral, Ollama, LM Studio, OpenRouter, etc.). Providers implement `BaseAIProvider` with `generateText()`, `streamText()`, `generateObject()`.

**AI Services Unified**: Abstraction layer with role-based model config (main, research, fallback). Automatic retry with exponential backoff (429, 5xx, timeout). Cost calculation from token counts.

**Schema Layer** (`src/schemas/`): Zod-based with `.strict()` for OpenAI compatibility. Strict JSON schema generation for AI structured outputs.

### MCP Server (Tiered Tool Loading)
```
FastMCP Server
  ├─ Core: 7 tools (get_tasks, next_task, set_status, etc.)
  ├─ Standard: 14 tools (+ initialize, analyze, expand_all, etc.)
  └─ Extended: 36+ tools (research, autopilot, dependencies, etc.)
```
Controlled via `TASK_MASTER_TOOLS` env var. LRU cache with 5-min TTL prevents redundant API calls.

---

## Core Workflow

### 1. Initialize
```bash
task-master init
```
Creates `.taskmaster/config.json`, `state.json`, `tasks/tasks.json`, `docs/`, `reports/`.

### 2. Generate Tasks from PRD
```bash
task-master parse-prd <prd-file>
```
Sends PRD to AI model -> generates structured task list (title, description, details, testStrategy, dependencies, priority) -> validates with Zod -> assigns numeric IDs -> resolves dependencies -> writes to `tasks.json`.

### 3. Expand & Decompose
```bash
task-master expand --id=<id> --research
```
Fetches task, optionally calls research model for context, builds dependency graph, AI generates 3-5 subtasks, validates with `SubtaskSchema`, assigns dot-notation IDs (1.1, 1.2, 1.3).

### 4. Implementation Loop
```bash
task-master next          # Find next available task (deps satisfied, pending)
task-master show <id>     # Display task with dependencies, details, test strategy
task-master set-status --id=<id> --status=in-progress
# ... implement ...
task-master set-status --id=<id> --status=done   # Auto-marks subtasks done
```

### Task Sequencing Algorithm
1. Filter: pending status only
2. Check: all dependencies completed
3. Filter: no blocking dependencies
4. Sort: by priority (high -> low), then by ID
5. Return: first available task

### Data Model
```json
{
  "id": 1,
  "title": "Implement user authentication",
  "description": "Set up JWT-based auth",
  "status": "pending|in-progress|blocked|done|cancelled|deferred",
  "priority": "low|medium|high|critical",
  "dependencies": [1, 2],
  "details": "Use bcrypt for hashing...",
  "testStrategy": "Unit tests for auth functions...",
  "subtasks": [{ "id": 1, "title": "...", ... }]
}
```

Tagged format for multi-context: `{ master: { tasks: [...] }, "feature-branch": { tasks: [...] } }`

---

## Strengths

### Task Decomposition
- Excellent recursive decomposition with AI-guided depth
- Dependency tracking with full graph traversal
- Circular dependency detection
- Smart complexity analysis with effort estimation
- Multi-level support: tasks, subtasks, sub-subtasks (dot notation)

### Multi-Model Support
- 20+ AI providers through unified interface
- Role-based config: main (fast), research (thorough), fallback (if either fails)
- Automatic retry with exponential backoff
- Cost tracking per provider/model
- Provider abstraction: same interface regardless of backend

### MCP Integration
- Tiered tool loading (7/14/36+) reduces token usage — most innovative feature
- FastMCP wrapper with Sentry instrumentation
- Session management with sampling capabilities
- LRU caching with TTL prevents redundant calls

### Developer Experience
- Rich CLI: colors, tables, progress indicators (ora, chalk, cli-table3)
- Interactive prompts (Inquirer)
- Detailed error messages with remediation suggestions
- Silent mode for programmatic usage
- 217 total tests (136 JS, 81 TS)

---

## Weaknesses / Gaps

### Architecture Debt
- **Mixed paradigms**: Legacy CommonJS in `/scripts` alongside modern ESM in `/apps`. Duplicated logic (task ID parsing exists in multiple places).
- **Tight coupling**: AI services coupled to file I/O (reads tasks.json during generation). Config manager reads files directly instead of injecting config.
- **No domain service layer**: Business logic leaks into presentation. CLI and MCP both duplicate task display logic.

### Error Handling
- Inconsistent reporting (some logged to console, some returned as objects, no standardized error codes)
- Silent failures: dependency validation warns but continues, invalid task IDs resolve to null
- No guidance on fixing circular dependencies
- Task generation may partially succeed without rollback

### Performance
- No pagination — all tasks loaded into memory
- Synchronous file I/O potential blocking on large task files
- Repeated graph traversal (no memoization for dependency checks)
- No indexing for quick task lookup by ID

### Missing Features
- No task templates for reusable patterns
- No task history/evolution tracking
- No task attachments (can't link files/PRs)
- No team collaboration (single user only)
- No time tracking or velocity analytics
- No undo/rollback for any operation
- No audit trail

### State Management
- State scattered across config.json, state.json, tasks.json
- No transaction support (partial failures leave inconsistent state)
- File-based persistence has locking issues with concurrent modifications
- Tag system always defaults to 'master'

### Extensibility
- Hard-coded provider list (adding providers requires source modification)
- Fixed tool registry (tools hardcoded in tool-registry.js)
- No plugin system for custom commands
- No way to extend task schema

### Documentation
- No architecture overview docs
- Missing JSDoc on many functions
- Config system poorly documented
- No migration guide (legacy vs new format)
- Some examples reference old commands

---

## Key Design Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Provider Registry (Singleton) | Runtime registration for MCP | Hides dependencies, harder to test |
| Zod with `.strict()` | OpenAI-compatible JSON schemas | Tight coupling to Zod |
| Tag-based multi-context | Support parallel task contexts | Complex migration from legacy format |
| Tiered MCP tool loading | Optimize context window | Users must know available tiers |
| Role-based model config | Right model for right task | Many API keys needed |
| Direct Functions for MCP | Each tool has corresponding function | Logic duplication across layers |
| DAG for dependencies | Prevents impossible task sequences | No conditional/optional dependencies |
| File-based persistence | Version-controllable, human-readable | Locking issues, no native querying |
