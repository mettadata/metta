# mettā | *A Meta-Programming SDD Framework* 
**(Under Active Development)**

A composable, spec-driven development framework for AI-native software engineering.

Metta orchestrates the full change lifecycle — propose, plan, execute, verify, ship — with structured specs as the source of truth and quality gates as the control mechanism. It works with any AI coding tool (Claude Code, Cursor, Copilot, Codex, etc.) and scales from a one-line bug fix to a complex feature with full design ceremony.

## Why Metta Exists

Every spec-driven development framework makes the same bet: structured specs produce better AI-generated code than raw prompts. They're right. But each makes unnecessary tradeoffs — hardcoded phases, no parallel change safety, unvalidated state, heavyweight ceremony with no escape hatch.

Metta takes the position that these tradeoffs aren't inherent. They're artifacts of frameworks that grew organically rather than being designed holistically:

- **Ceremony scales with complexity** — quick mode for a bug fix, full ceremony for complex features, same engine underneath
- **Specs are living documents** — delta-based evolution with content-hash versioning and requirement-level conflict detection
- **Gates steer behavior** — typed, pluggable quality gates (tests, lint, typecheck) run automatically and feed back into the execution loop
- **Context is budgeted** — load only what the current phase needs, not the entire project history
- **Parallel changes are safe** — no silent overwrites, no collision bugs
- **Everything is validated** — Zod schemas on every state read/write, fail-fast not fail-silent

## Quick Start

### 1. Install

```bash
npm install -g @mettadata/metta
```

Requires Node.js >= 22.

### 2. Scaffold a Project

```bash
cd your-project
metta install
```

This scaffolds the metta directory structure, detects your environment, and installs slash commands for your AI tools. It creates:

- `.metta/config.yaml` — project configuration
- `spec/` — specs, active changes, and completed archive
- `spec/project.md` — project constitution template
- `.claude/skills/` — 11 slash commands for Claude Code
- `.claude/agents/` — 8 metta agent definitions (proposer, researcher, architect, planner, executor, reviewer, verifier, discovery)

### 3. Start Your AI Coding Agent and Run Discovery

Open your AI coding tool (Claude Code, Cursor, etc.) and run the init skill:

```
/metta:init
```

The AI agent takes over from here — it runs interactive discovery to understand your project, asking adaptive questions about your stack, conventions, constraints, and quality standards. For brownfield projects, it scans the codebase first and infers what it can before asking.

The result is a completed project constitution (`spec/project.md`) and a generated context file (`CLAUDE.md`) that gives every future AI interaction full project awareness.

### 4. Start Working

From your AI coding tool, use metta slash commands:

**Quick mode** — small, well-understood changes:
```
/metta:quick add dark mode toggle
```

**Standard mode** — features that need a spec:
```
/metta:propose user profile system
/metta:plan
/metta:execute
/metta:verify
/metta:ship
```

**Auto mode** — spec it and walk away:
```
/metta:auto build payment processing system
```

You can also drive the lifecycle from the terminal directly:
```bash
metta propose "user profile system"
metta plan
metta execute
metta verify
metta ship
```

### Check Status

```bash
metta status              # where am I? what's next?
metta status --json       # machine-readable for AI tools
```

## How It Works

```
  +-----------------------------+
  |           propose           |
  |                             |
  |  description -> discovery   |
  |  (ask questions until zero  |
  |   ambiguity) -> intent +   |
  |   spec with answers         |
  +-------------+---------------+
                |
  +--------+   +----------+   +--------+   +----------+   +------+
  |  plan  |-->|  execute |-->| review |-->|  verify  |-->| ship |
  |        |   |          |   |        |   |          |   |      |
  |research|   | batch 1  |   | 3x     |   | 3x       |   |finalize
  |design  |   |  gates   |   |parallel|   | parallel |   |merge |
  |tasks   |   | batch 2  |   |review  |   | verify   |   |      |
  |        |   |  gates   |   |        |   |          |   |      |
  +--------+   +----------+   +---+----+   +----+-----+   +------+
                                   |             |
                              issues found?  gates fail?
                              fix -> re-review  fix -> re-verify
```

**Workflows are composable DAGs**, not hardcoded pipelines. Three built-in:

| Workflow | Artifacts | Best For |
|----------|-----------|----------|
| Quick | 3 (intent, execution, verification) | Bug fixes, small features |
| Standard | 7 (+ spec, research, design, tasks) | Most features |
| Full | 10 (+ domain-research, architecture, ux-spec) | Complex features |

## Architecture

```
+-----------------------------------------------------+
|                  CLI / MCP / API                     |  User-facing
+-----------------------------------------------------+
|                Command Delivery                      |  Multi-tool adapters
+----------+----------+-----------+--------------------+
| Workflow | Context  |  Agent    |    Execution        |  Core engines
| Engine   | Engine   |  System   |    Engine           |
+----------+----------+-----------+--------------------+
|                  Plugin System                        |  Extension points
+----------+----------+-----------+--------------------+
| Artifact |  State   | Provider  |     Gate            |  Data & services
| Store    |  Store   | Registry  |     Registry        |
+----------+----------+-----------+--------------------+
|                File System / Git                      |  Persistence
+-----------------------------------------------------+
```

**Key design decisions:**
- ESM-only TypeScript (no CommonJS)
- Dependency injection over singletons
- Templates as external YAML/markdown files
- Schema validation on every state transition
- Git worktree isolation for all execution

## Project Structure

```
spec/                    # Working artifacts (committed, shared)
  project.md             # Project constitution
  specs/                 # Living specifications
  changes/               # Active changes
  archive/               # Completed changes

.metta/                  # Framework state (hidden)
  config.yaml            # Project config
  state.yaml             # Execution state (gitignored)
  workflows/             # Custom workflow definitions
  agents/                # Custom agent definitions
  gates/                 # Custom gate definitions
```

## Key Features

- **8 built-in agents** — discovery, proposer, researcher, architect, planner, executor, reviewer, verifier — each with colored banners and personas
- **Parallel fan-out** — research (2-4 approaches), review (correctness/security/quality), verification (tests/lint/spec) run concurrently
- **Pluggable quality gates** — tests, lint, typecheck, build run automatically during finalize
- **Git safety** — branch per change, worktree isolation for subagents, auto-commit, atomic archive
- **Discovery gate** — orchestrator asks structured questions before any code is written
- **Context budgeting** — token-aware context loading per phase and agent
- **Spec evolution** — delta operations (ADDED/MODIFIED/REMOVED) with requirement-level conflict detection
- **Self-healing pipeline** — reviewer finds issues → executor fixes → re-review, all automatic

## CLI Reference

```bash
# Lifecycle
metta install                     # Scaffold project, install skills + agents
metta propose <description>      # Start a change (standard workflow)
metta quick <description>        # Start a change (quick workflow)
metta auto <description>         # Full lifecycle loop
metta plan                       # Build planning artifacts
metta execute                    # Run implementation
metta verify                     # Check against spec
metta finalize                   # Run gates, archive, merge specs
metta ship                       # Merge branch to main

# Workflow State
metta status                     # Current change status
metta progress                   # Project-level dashboard
metta next                       # What to do next
metta complete <artifact>        # Mark artifact done, advance workflow
metta instructions <artifact>    # AI instructions for an artifact

# Specs
metta specs list                 # List capabilities
metta specs show <cap>           # Show a spec
metta specs diff <cap>           # Pending changes

# Organization
metta idea <description>         # Capture an idea
metta issue <description>        # Log an issue
metta changes list               # List active changes
metta backlog list               # List backlog items

# System
metta doctor                     # Diagnose environment
metta config get <key>           # Read configuration
metta gate run <name>            # Run a quality gate
metta context stats              # Context budget usage
metta update                     # Update metta
metta completion <shell>         # Shell completion (bash/zsh/fish)
```

## Development

```bash
git clone https://github.com/mettadata/metta.git
cd metta
npm install
npm run build
npm link          # makes `metta` available globally
npm test          # run test suite
npm run dev       # build + link in one step
```

## Roadmap

Metta is in active development (v0.1.0). The core engine is functional — you can propose, plan, execute, verify, and ship changes today. Here's what's built, what's in progress, and what's still ahead.

### Built

- **CLI with 30 commands** — full lifecycle from `metta install` through `metta ship`, plus `progress`, `next`, `complete`
- **11 slash commands** — `/metta:init`, `:propose`, `:plan`, `:execute`, `:verify`, `:ship`, `:quick`, `:auto`, `:status`, `:next`, `:progress`
- **8 agent definitions** — metta-discovery, metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier — each with colored banners
- **Workflow engine** — composable DAG with topological sort, three built-in workflows (quick/standard/full), custom workflow support
- **Context engine** — token-aware budgeting, per-phase loading strategies (full/section/skeleton), caching with staleness detection
- **Execution engine** — batch planning with file overlap detection, parallel task fan-out, git worktree isolation
- **Fan-out patterns** — parallel research (2-4 approaches), parallel review (correctness/security/quality), parallel verification (tests/lint/spec)
- **State store** — Zod-validated YAML persistence on every read/write
- **Artifact store** — change lifecycle tracking, short slugs (stop words stripped, 30 char max), checklist task format
- **Spec parser** — remark-based markdown parsing with requirement extraction and content hashing
- **Spec merger** — delta operations (ADDED/MODIFIED/REMOVED) with requirement-level conflict detection
- **Quality gates** — YAML-defined gates (tests, lint, typecheck, build) run during finalize, results persisted to archive
- **Discovery gate** — mandatory orchestrator-driven questioning via AskUserQuestion before spec writing
- **Git safety** — branch per change, auto-commit on complete/finalize, archive with atomic move
- **Colored CLI output** — traffic light colors per workflow phase, agent-specific banners with icons
- **Anthropic provider** — Claude API integration with text/object/stream generation and retry policy
- **Claude Code delivery** — skill + agent installation, CLAUDE.md generation with section markers
- **Shell completion** — bash, zsh, fish
- **Template engine** — placeholder rendering for artifacts, agents, skills
- **Ideas, issues, backlog stores** — on-demand directory creation, markdown-based capture

### Partial

- **Plugin system** — Zod schema for manifests defined, but no plugin loader or installation commands
- **Provider system** — interface and registry work, but only Anthropic implemented; no fallback chains or role-based routing
- **Multi-tool delivery** — adapter interface is generic but only Claude Code adapter exists
- **Merge safety pipeline** — 7-step structure in place, basic verification works, post-merge gate re-run is a stub

### Not Yet Built

- **MCP server** — tiered tool loading for native AI tool integration
- **Brownfield import** (`metta import`) — analyze existing code, generate specs, produce gap reports
- **Doc generation** (`metta docs generate`) — architecture, API, changelog from specs and archives
- **Roadmap commands** (`metta roadmap`) — milestone planning, feature ordering, activation
- **Schema migrations** — automatic state migration between framework versions
- **Orchestrator mode** — framework-driven AI execution (vs. current instruction mode)
- **Team features** — change ownership, concurrent change locking
- **Additional tool adapters** — Cursor, Copilot, Codex, Gemini, Windsurf, OpenCode

See [docs/proposed/](docs/proposed/) for the full design specifications.

## Tech Stack

TypeScript (strict, ES2022) | Node.js >= 22 | ESM | Commander.js | Zod | YAML | Anthropic SDK | Vitest

## License

MIT
