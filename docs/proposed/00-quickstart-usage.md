# 00 — Quick Start & Usage Guide

## Install

```bash
npm install -g @mettadata/metta
```

Metta installs globally. All default config, workflows, agents, gates, and templates live in `~/.metta/`. You configure once, use everywhere.

---

## Initialize a Project

```bash
cd your-project
metta init
```

This runs discovery to build your project constitution:

```
Detecting AI tools... found Claude Code, Cursor

Setting up project constitution...

? What does this project do?
> E-commerce platform for handmade goods

? What's the tech stack?
> Next.js 15, Prisma, PostgreSQL, Tailwind

? What coding conventions matter most?
> Server components by default, all API routes in src/app/api/

? Any architectural constraints?
> No ORMs besides Prisma, keep bundle under 200KB

? Quality standards?
> 80% test coverage, WCAG 2.1 AA accessibility

? What's off-limits?
> No eval(), no secrets in code, no console.log in production
```

Metta creates:
- `spec/project.md` — your project constitution (single source of truth)
- `.metta/config.yaml` — minimal project config (overrides only)
- `CLAUDE.md`, `.cursorrules`, etc. — lightweight pointer files for detected AI tools
- Slash commands/skills installed for each detected tool

You're ready to work.

---

## Brownfield Projects (Existing Code)

`metta init` detects existing code and switches to brownfield mode automatically. Instead of asking everything from scratch, it **reads the codebase first and infers** conventions, stack, patterns, and quality standards.

```bash
cd existing-project
metta init
```

```
Detected existing project (brownfield mode):

Scanning codebase...
  Language:    TypeScript (strict mode)
  Framework:   Next.js 15 (App Router)
  ORM:         Prisma (47 models)
  Testing:     Vitest (347 tests, 82% coverage)

Analyzing conventions...
  ✓ Server components dominant (89%)
  ✓ API routes in src/app/api/
  ✓ Prisma for all DB access (no raw SQL)
  ✓ Named exports preferred (94%)

Generating constitution draft from codebase...

? Anything to add or correct?
> We're migrating away from barrel exports — don't create new ones.

? Any constraints not visible in code?
> No client-side state management. Keep bundle under 200KB per route.
```

The constitution is inferred from evidence, corrected by you, and locked.

### `metta import` — Specs First, Then Code

`metta init` detects if existing framework artifacts or code exist and prompts you to run `metta import`:

```
metta init

Detected existing project (brownfield mode):
  ✓ GSD artifacts found (.planning/)
  ✓ Codebase found (TypeScript, Next.js, Prisma)

Run metta import to generate specs? [Y/n]
```

`metta import` is one command that handles everything — ingesting specs from other frameworks, analyzing code, and reconciling the two:

```bash
metta import                     # Auto-detect everything (specs + code)
metta import auth                # Import a specific capability
metta import --all               # Import entire codebase
```

It finds existing specs first (the claims), then analyzes code (the evidence), then reconciles. The output is verified spec drafts plus a **gaps report** (`spec/gaps/`) showing what's claimed but not built, what's built but not documented, and what diverges.

Gaps can be promoted into new specs and changes:

```bash
metta propose --from-gap "payments-partial-refunds"
metta propose --from-gaps           # Interactive: pick gaps to address
```

### Incremental Adoption

You don't have to import everything. Adopt gradually:

| Level | What | Command |
|-------|------|---------|
| 0 | Constitution only — better AI context immediately | `metta init` |
| 1 | Import what you're about to touch, build on top | `metta import payments` then `metta propose` |
| 2 | Full coverage — import everything, review over time | `metta import --all` |
| 3 | Full ceremony for major changes | `metta auto --workflow full` |

See [11-brownfield.md](11-brownfield.md) for the full brownfield adoption guide.

---

## Three Ways to Work

### 1. Quick Mode — Small, Well-Understood Changes

```bash
metta quick "add dark mode toggle"
```

Light discovery (a few scoping questions), then straight to execution. Best for bug fixes, small features, and changes where you already know what you want.

```
Flow: discovery → intent → execution → verification
```

### 2. Standard Mode — Features That Need a Spec

```bash
metta propose "user profile system"
```

Full discovery — adaptive questions until requirements are clear and complete. Then step through manually:

```bash
metta plan            # Design + task decomposition into batches
metta execute         # Batched execution with backpressure gates
metta verify          # Check deliverables against spec scenarios
metta finalize        # Archive, merge specs, generate docs, refresh
metta ship            # Merge worktree branch to main (or create PR)
```

```
Flow: discovery → intent → spec → design → tasks → execute → verify → finalize → ship
```

### 3. Auto Mode — Spec It and Walk Away

```bash
metta auto "build payment processing system"
```

Interactive discovery front-loads all questions. Once you approve the spec, the agent loops unattended:

```
Phase 0: Discovery (interactive)
  Agent asks adaptive questions until zero ambiguity remains.
  You approve: "this spec is complete, go build it."

Phase 1+: Build (unattended)
  Plan → Execute → Verify
    ↓
  Gaps found? → Re-plan gaps only → Execute → Verify
    ↓
  All green → Ship
```

Guardrails: max cycles (default 10), stall detection, architectural decisions halt the loop.

```bash
# Resume if interrupted
metta auto --resume

# Auto with full ceremony
metta auto --workflow full "rebuild auth system"

# Auto with a cycle cap
metta auto --max-cycles 5 "add search functionality"
```

---

## Lifecycle Overview

```
                   ┌─────────────────────────────────────────────┐
                   │              Discovery Gate                  │
                   │  (adaptive questions until zero ambiguity)   │
                   └──────────────────┬──────────────────────────┘
                                      │
  ┌─────────┐   ┌─────────┐   ┌──────▼──┐   ┌────────┐   ┌──────────┐   ┌──────┐
  │ propose │──▶│  plan   │──▶│ execute │──▶│ verify │──▶│ finalize │──▶│ ship │
  │         │   │         │   │         │   │        │   │          │   │      │
  │ intent  │   │ design  │   │ batch 1 │   │ test   │   │ archive  │   │merge │
  │ spec    │   │ tasks   │   │  gates  │   │ mapped │   │ merge    │   │safety│
  │         │   │         │   │ batch 2 │   │ AI     │   │ specs    │   │pipeln│
  └─────────┘   └─────────┘   │  gates  │   │ review │   │ docs     │   │      │
                               │  ...    │   │ user   │   └──────────┘   └──────┘
                               └─────────┘   │ check  │
                                             └───┬────┘
                                                 │
                               ┌─────────────────┘
                               │ gaps found?
                               ▼
                          re-plan gaps ──▶ execute ──▶ verify
                          (auto mode loops until all scenarios pass)

Gates fire: after each task (tests, lint, typecheck)
            after each batch (build)
            after all batches (spec-compliance)
            after merge to main (post-merge gates)
```

---

## Check Status Anytime

```bash
metta status              # Where am I? What's next?
metta status --json       # Machine-readable (for AI tools)
```

```
Change: add-user-profiles (standard workflow)
Status: executing

Artifacts:
  ✓ intent          complete
  ✓ spec            complete
  ✓ design          complete
  ✓ tasks           complete
  → implementation  in_progress (batch 2 of 3)
  · verification    pending

Batches:
  Batch 1: ✓ complete (2 tasks, all gates passed)
  Batch 2: → in_progress (task 2.1 executing)
  Batch 3: · pending
```

---

## Discovery Gate — No Guesswork

Every workflow passes through discovery before execution. The agent must fully understand what it's building — no assumptions, no "I'll figure it out."

Discovery asks adaptive questions based on the specific change:
- A payment system gets questions about idempotency and retry semantics
- A UI component gets questions about responsive behavior and accessibility
- A database migration gets questions about backward compatibility

Before proceeding, the agent runs a completeness check:
- All requirements have scenarios (Given/When/Then)
- No TODO/TBD markers
- Edge cases addressed
- Integration points identified
- Out-of-scope declared

You approve the spec, then execution begins.

---

## Git Safety — Everything in Worktrees

When git-aware (default), all work happens in worktree branches. No agent ever commits directly to main.

```
Every operation:
  1. Checkout main, pull latest
  2. Create worktree branch from main HEAD
  3. Agent works in worktree
  4. Merge safety pipeline → main
  5. Clean up worktree
```

Before anything merges to main, it passes through a **7-step merge safety pipeline**: base drift check, dry-run merge, scope check, gate verification, snapshot, merge, post-merge gates. If post-merge gates fail, main is rolled back automatically and the worktree branch is preserved for diagnosis.

See [07-execution-engine.md](07-execution-engine.md) for the full pipeline specification.

No blind merges. No shortcuts. No exceptions.

### Non-Git Projects

If `metta init` detects no `.git` directory, it prompts:

```
No git repository detected.
  [1] Initialize git (git init) and continue with full git safety
  [2] Continue without git (file-only mode — no worktrees, no merge safety)
```

Choosing option 2 sets `git.enabled: false` in `.metta/config.yaml`. All workflows run sequentially with no worktree isolation.

All commits follow [Conventional Commits](https://www.conventionalcommits.org/) by default:
```
feat(add-profiles): implement user profile API
fix(add-profiles): null check in avatar upload discovered during implementation
docs(add-profiles): create intent and spec artifacts
chore(add-profiles): archive change and merge specs
```

---

## Backpressure Gates

Gates are verification checks that run after each task and batch. They're the primary control mechanism — tests steer agent behavior more reliably than longer prompts.

Built-in gates:

| Gate | Checks | Runs |
|------|--------|------|
| `tests` | Test suite passes | After each task |
| `lint` | Linter clean | After each task |
| `typecheck` | Type checker passes | After each task |
| `build` | Project builds | After each batch |
| `spec-compliance` | Implementation matches spec scenarios | After all batches |

Add custom gates:

```yaml
# .metta/gates/schema-drift.yaml
name: schema-drift
description: Detect ORM changes missing migrations
command: metta gate schema-drift
timeout: 30000
required: true
on_failure: stop
```

---

## Specs Are the Source of Truth

Specs use RFC 2119 keywords (MUST/SHOULD/MAY) with Given/When/Then scenarios:

```markdown
## Requirement: User Login

The system MUST allow registered users to authenticate with email and password.

### Scenario: Successful login
- GIVEN a registered user with email "user@example.com"
- WHEN they submit valid credentials
- THEN they receive a session token
- AND are redirected to the dashboard

### Scenario: Invalid password
- GIVEN a registered user
- WHEN they submit an incorrect password
- THEN they receive a 401 error
```

Changes are expressed as deltas (ADDED/MODIFIED/REMOVED) against existing specs. When you ship, deltas merge into the living specs with conflict detection at the requirement level.

```bash
metta specs list              # List all capabilities
metta specs show auth         # Show current auth spec
metta specs diff auth         # Show pending changes
metta finalize --dry-run  # Preview doc generation
metta ship --dry-run          # Preview merge before applying
```

---

## Workflows Are Composable

Three built-in workflows, plus custom:

```
Quick (3 artifacts):
  intent ──→ execution ──→ verification

Standard (6 artifacts):
  intent → spec → design → tasks → execution → verification

Full (9 artifacts):
  research → intent → spec → design ──┬→ architecture
                                      ├→ tasks
                                      └→ ux-spec
                        tasks + arch ──┴→ execution → verification
```

Select per-command:
```bash
metta propose --workflow full "payment processing"
metta quick "fix typo"
metta auto --workflow standard "add dark mode"
```

Create custom workflows as YAML in `.metta/workflows/`:
```yaml
name: data-pipeline
artifacts:
  - id: schema-design
    requires: []
    agents: [data-architect]
    gates: [schema-lint]
  - id: migration
    requires: [schema-design]
    agents: [executor]
    gates: [migration-test]
```

---

## Configuration

### Principle: Global is the Default, Local is the Override

Everything lives in `~/.metta/` by default. You only create project-level config for what's different.

```bash
# A minimal project config — just project context:
cat .metta/config.yaml
```
```yaml
project:
  name: "My App"
  description: "E-commerce platform"
  stack: "Next.js 15, Prisma, PostgreSQL"
```

Override anything from global:
```yaml
project:
  name: "My App"
  stack: "Next.js 15, Prisma, PostgreSQL"

defaults:
  workflow: full        # This project uses full ceremony

gates:
  tests:
    command: pnpm test  # Different test runner
```

Resolution order (highest wins):
```
Environment variables → .metta/local.yaml (gitignored) → .metta/config.yaml → ~/.metta/config.yaml
```

---

## Generated Docs and Context Files

Metta generates and maintains two kinds of output:

### Tool Context Files (CLAUDE.md, .cursorrules, etc.)

Lightweight pointer tables — conventions inlined, everything else is links. Agents follow links to load what they need. Never edit these directly — edit `spec/project.md` and run `metta refresh`.

### Project Documentation

After work is shipped, Metta generates docs from specs, designs, and archived changes:

```yaml
# .metta/config.yaml
docs:
  output: ./docs
  generate_on: finalize
  types: [architecture, api, changelog, getting-started]
```

```bash
metta docs generate            # Generate/update all doc types
metta docs generate api        # Generate only API docs
```

---

## Key Commands

```bash
# Workflow
metta init                         # Initialize project + constitution
metta propose <description>       # Start a change (standard workflow)
metta quick <description>         # Start a change (quick workflow)
metta auto <description>          # Full lifecycle loop
metta auto --resume               # Resume interrupted auto run
metta plan                        # Build planning artifacts
metta execute                     # Run implementation
metta verify                      # Check against spec
metta finalize                    # Archive, merge specs, generate docs
metta finalize --dry-run          # Preview what would change
metta ship                        # Merge worktree branch to main
metta ship --dry-run              # Preview merge

# Status
metta status                      # Current change status
metta instructions <artifact>     # Get AI instructions for an artifact

# Specs
metta specs list                  # List capabilities
metta specs show <capability>     # Show current spec
metta specs diff <capability>     # Pending changes

# Docs & Context
metta docs generate               # Generate project documentation
metta refresh                     # Regenerate all derived files
metta refresh --dry-run           # Preview changes

# Context
metta context stats               # Token budget usage
metta context check               # Check for stale context

# Project
metta config get <key>            # Read config
metta config set <key> <value>    # Set config
metta config edit constitution    # Edit project constitution

# Roadmap
metta roadmap                     # Show current roadmap status
metta roadmap add <feature>       # Add specced feature to milestone
metta roadmap reorder             # Interactive reordering
metta roadmap next                # Activate next feature into changes/

# Gates
metta gate run <name>             # Run a specific gate manually
metta gate list                   # List all configured gates
metta gate show <name>            # Show gate config and last result

# Plugins
metta plugin list                 # Installed plugins
metta plugin install <name>       # Install from registry

# Maintenance
metta cleanup                     # Clean orphaned worktrees and tags

# System
metta update                      # Update Metta framework
metta doctor                      # Diagnose issues
```

---

## For AI Tools

After `metta init`, your AI tool gets slash commands:

```
/metta:propose   → Start a new change
/metta:plan      → Build planning artifacts
/metta:execute   → Run implementation
/metta:verify    → Verify against spec
/metta:ship      → Archive and merge
/metta:auto      → Full lifecycle loop
```

Or use the MCP server for native integration:

```json
{
  "mcpServers": {
    "metta": {
      "command": "metta",
      "args": ["mcp-server"],
      "env": { "METTA_MCP_TOOLS": "standard" }
    }
  }
}
```

MCP tiers: core (7 tools), standard (14 tools), extended (25+ tools).
