# Get Shit Done (GSD) Analysis

**Repo**: `referrences/get-shit-done/`
**By**: TACHES / gsd-build
**Stack**: Node.js/TypeScript, esbuild for hooks, markdown workflows
**Philosophy**: No enterprise theater. Context engineering that just works.

---

## Architecture

Three layers:

### 1. CLI Layer (`bin/install.js`, `bin/gsd-tools.cjs`)
900+ line installer supporting 10+ runtimes (Claude Code, OpenCode, Gemini, Kilo, Codex, Copilot, Cursor, Windsurf, Antigravity, Augment). Handles WSL detection, cross-platform paths, multi-select runtime installation.

### 2. SDK Layer (`sdk/src/`)
TypeScript library for headless execution:
- `GSD` class, `PhaseRunner` state machine, `ContextEngine`, `PlanParser`, `PromptFactory`
- `GSDEventStream` for monitoring (CLI, WebSocket transports)
- Structured types: `ParsedPlan`, `PlanTask`, `PhaseRunnerResult`, `SessionOptions`

### 3. Workflow/Command Layer (`commands/gsd/`, `get-shit-done/workflows/`)
65+ commands as markdown with YAML frontmatter. Workflows are detailed specs orchestrating subagents. State tracked via `STATE.md` (YAML + markdown).

### Context Engine (core innovation)
Phase-aware context loading — each phase gets only the files it needs:

| Phase | Required | Optional |
|-------|----------|----------|
| Execute | STATE.md, config.json | - |
| Research | STATE, ROADMAP, CONTEXT | REQUIREMENTS |
| Plan | STATE, ROADMAP, CONTEXT | RESEARCH, REQUIREMENTS |
| Verify | STATE, ROADMAP | REQUIREMENTS, PLAN, SUMMARY |

Additional strategies: milestone-aware roadmap extraction, 100KB+ file truncation (headings + first paragraph), atomic task design (2-3 tasks max per plan).

---

## Core Workflow

```
discuss -> research -> plan -> execute -> verify -> ship
```

### 1. New Project (`/gsd:new-project`)
Gathers goals/constraints/stack/timeline. Spawns 4 parallel research agents. Creates `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `.planning/research/`.

### 2. Discuss Phase (`/gsd:discuss-phase N`)
Analyzes scope, identifies gray areas by task type (UI -> layout/density/interactions). Outputs `N-CONTEXT.md` with locked decisions. Supports `--batch` and `--chain` flags.

### 3. Plan Phase (`/gsd:plan-phase N`)
Research gate blocks planning until open questions resolved. Creates 2-3 atomic XML tasks:
```xml
<task type="auto">
  <name>Create login endpoint</name>
  <files>src/app/api/auth/login/route.ts</files>
  <action>Use jose for JWT, validate credentials...</action>
  <verify>curl -X POST returns 200 + Set-Cookie</verify>
  <done>Valid credentials return cookie, invalid return 401</done>
</task>
```
Plan checker validates quality. Creates `N-RESEARCH.md`, `N-{1,2,3}-PLAN.md`.

### 4. Execute Phase (`/gsd:execute-phase N`)
**Wave-based parallel execution**:
- Groups plans by dependencies (Wave 1 = no deps, Wave 2 = depends on Wave 1, etc.)
- Intra-wave file overlap detection prevents parallel conflicts
- Each wave spawns `gsd-executor` subagents with `isolation="worktree"`
- Executors: read fresh files, execute tasks, commit atomically, create SUMMARY.md
- Orchestrator updates STATE.md after all waves complete

**Deviation Rules** (auto-fix during execution):
- Rule 1: Auto-fix discovered bugs
- Rule 2: Add critical missing features
- Rule 3: Fix blockers
- Rule 4: STOP for architectural decisions (escalate to user)

### 5. Verify Work (`/gsd:verify-work N`)
Extracts testable deliverables, interactive walkthrough, debugger agents for failures. Creates UAT.md.

### 6. Ship (`/gsd:ship N`, `/gsd:complete-milestone`)
Auto-generated PR body. Archive milestone, tag release.

---

## Strengths

### Context Engineering (primary innovation)
- **Phase-aware loading** prevents context rot (quality degradation as window fills)
- **Research gate** blocks planning on incomplete understanding
- **Intra-wave overlap detection** prevents worktree conflicts at the source
- **Milestone extraction** narrows ROADMAP to current milestone only
- **Strategic truncation** preserves structure while dropping detail

### Orchestration Pattern
- **Thin orchestrators + heavy executors**: Orchestrator uses 10-15% of context (stays fast), each executor gets fresh 200K (detailed work)
- **Wave-based parallelism**: Simpler than fine-grained task DAGs, naturally prevents conflicts
- **Atomic commits**: Each task independently revertable, git bisect friendly

### Quality Gates
- **Schema drift detection**: Detects Prisma/Drizzle/Payload/Supabase/TypeORM changes, verifies migrations ran
- **Security enforcement**: Threat model reference in executor, prompt injection guards
- **Scope reduction detection**: Verifies phases deliver what roadmap promised
- **Plan checker**: Reviews quality before execution

### Multi-Tool Support
- 10+ runtimes with runtime-specific adaptations
- Tool name mapping (Claude's "Read" -> Copilot's "read")
- MCP integration ready
- Fallback mechanisms (Copilot subagent signals unreliable -> force sequential)

### Developer Experience
- Hooks as first-class citizens (PostToolUse, PreToolUse, phase boundaries)
- Statusline integration (35% WARNING, 25% CRITICAL context usage)
- 65+ commands covering full lifecycle
- Forensics command for diagnosing stuck loops

---

## Weaknesses / Gaps

### Extensibility
- **Hardcoded phase types**: PhaseType enum (Discuss/Research/Plan/Execute/Verify) — adding new phases requires SDK changes
- **Model profiles hardcoded** in gsd-tools.cjs
- **Agent type registry implicit** (12 types listed in markdown, not enforced at runtime)
- **No workflow versioning** — changes break existing handoffs

### Error Recovery
- Hook timeout issues on Windows/Git Bash (10s hangs)
- Incomplete worktree recovery on mid-wave failures
- Stale metrics in context monitor (60s threshold may miss long phases)
- No retry mechanism for failed steps
- Copilot subagent completion signals unreliable

### Documentation
- README is 50KB+ — getting started unclear for non-Claude users
- Workflow specs underdocumented (detailed but no tutorials)
- Agent deviation rules (Rule 1-4) documented in markdown, not enforced programmatically
- CLI help doesn't show all flags (`--batch`, `--chain`, `--gaps-only` only in command files)

### Testing
- No integration tests across runtimes
- Tests mock subagent behavior; real orchestration untested
- No E2E "new-project -> plan -> execute -> verify" test
- Flaky concurrency tests using filesystem timing

### Assumptions
- Git required (no fallback)
- Unix paths assumed (normalization exists but not bulletproof)
- Node.js 20+ only
- Claude-optimized (other runtimes are second-class)
- `.planning/` in project root assumed writable

---

## Key Design Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Wave-based parallelism | Simpler than task DAGs, prevents conflicts | Slow plans block entire wave |
| Orchestrator != Executor | Keeps main context lean | Requires subagent spawning support |
| Meta-prompting via markdown | Self-documenting, version-controlled, composable | 500-1000 line workflows hard to maintain |
| STATE.md (YAML + markdown) | Readable by agents AND parseable by tools | No schema validation, field drift |
| Deviation rules as auto-fixes | Reduces planning overhead, improves quality | "Critical feature" is subjective |
| XML task format | Optimized for Claude parsing | Less natural for other models |
| Threat model in plan frontmatter | Security-aware planning | Must be manually maintained |
