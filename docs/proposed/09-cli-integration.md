# 09 — CLI & Integration Model

## CLI Design

### Command Structure

```
metta init                          # Initialize project (auto-detects brownfield)
metta init --skip-scan             # Force greenfield-style init
metta propose <description>        # Start a new change (standard workflow)
metta propose --from-gap <gap>     # Create change from a gap in gaps report
metta propose --from-gaps           # Interactive: pick gaps to address
metta quick <description>          # Quick mode (skip planning)
metta auto <description>           # Full lifecycle loop (discover → build → verify)
metta auto --resume                # Resume interrupted auto run
metta plan                         # Build next planning artifacts
metta execute                      # Run implementation
metta verify                       # Run verification
metta verify --gaps                # Re-run reconciliation, update gaps report
metta ship                         # Archive change, merge specs
metta ship --dry-run               # Preview merge without applying

metta status                       # Show current change status
metta status --json                # Machine-readable status
metta instructions <artifact>      # Generate AI instructions for an artifact
metta instructions <artifact> --json

metta specs list                   # List all capabilities (shows draft/approved status)
metta specs show <capability>      # Show current spec
metta specs diff <capability>      # Show pending changes
metta specs history <capability>   # Show archive history
metta specs review <capability>    # Interactive review of a draft spec
metta specs approve <capability>   # Mark a draft spec as approved

metta import                        # Auto-detect everything (specs + code)
metta import <capability>           # Import a specific capability
metta import <directory>            # Import from a specific directory
metta import --all                  # Import entire codebase
metta import --dry-run              # Preview what would be generated

metta gaps list                    # List all gaps with status
metta gaps show <gap-name>         # Show a specific gap

metta changes list                 # List active changes
metta changes show <name>          # Show change details
metta changes abandon <name>       # Abandon a change

metta context stats                # Show context budget usage
metta context check                # Check for stale context

metta docs generate                # Generate/update project documentation
metta docs generate <type>         # Generate specific doc type (api, architecture, etc.)
metta docs generate --dry-run      # Preview what would change

metta plugin list                  # List installed plugins
metta plugin install <name>        # Install from registry
metta plugin remove <name>         # Safe uninstall

metta config get <key>             # Read config value
metta config set <key> <value>     # Set config value
metta config edit                  # Open config in editor

metta refresh                      # Regenerate all derived files from constitution
metta refresh --dry-run            # Show what would change without writing
metta update                       # Update Metta framework to latest version
metta doctor                       # Diagnose common issues
```

### Output Modes

**Human mode** (default): Rich terminal output with colors, tables, progress bars.

**JSON mode** (`--json`): Machine-readable output for AI tools and scripts. Every command that an AI tool might call supports `--json`.

**Quiet mode** (`--quiet`): Minimal output for CI/scripting.

### Shell Completion

Tab completion for Bash, Zsh, Fish:
```bash
metta completion bash >> ~/.bashrc
metta completion zsh >> ~/.zshrc
metta completion fish >> ~/.config/fish/completions/metta.fish
```

Dynamic completions for change names, capability names, and artifact IDs.

---

## Multi-Tool Command Delivery

### Adapter Interface

```typescript
interface ToolAdapter {
  id: string
  name: string
  detect(projectRoot: string): boolean           // Auto-detect tool presence
  skillsDir(root: string): string | null         // Where to write skills
  commandsDir(root: string): string | null       // Where to write commands
  contextFile(root: string): string | null       // Where to write context (e.g., "CLAUDE.md")
  formatSkill(content: SkillContent): string     // Tool-specific skill format
  formatCommand(content: CommandContent): string // Tool-specific command format
  formatContext(context: ProjectContext): string  // Tool-specific context format
}
```

### Built-in Adapters

| Tool | Skills Dir | Commands Dir | Context File | Format |
|------|-----------|-------------|-------------|--------|
| Claude Code | `.claude/skills/metta-*/SKILL.md` | `.claude/commands/metta/*.md` | `CLAUDE.md` | Markdown + YAML frontmatter |
| Cursor | `.cursor/skills/metta-*/SKILL.md` | `.cursor/commands/metta/*.md` | `.cursorrules` | Markdown + YAML frontmatter |
| Copilot | `.github/agents/metta.*.agent.md` | — | `.github/copilot-instructions.md` | Markdown + companion prompts |
| Codex | `.codex/skills/metta-*/SKILL.md` | — | `AGENTS.md` | Markdown + TOML config |
| Gemini | — | `.gemini/commands/metta.*.toml` | `.gemini/instructions.md` | TOML with multiline prompt |
| Windsurf | `.windsurf/skills/metta-*/SKILL.md` | — | `.windsurfrules` | Markdown + YAML frontmatter |
| OpenCode | — | `.config/opencode/commands/metta/*.md` | — | Markdown |
| Generic | — | User-specified | User-specified | Markdown |

### Adding a New Tool

Create `.metta/adapters/<tool>.ts` implementing `ToolAdapter`:

```typescript
export const myToolAdapter: ToolAdapter = {
  id: "my-tool",
  name: "My AI Tool",
  detect: (root) => existsSync(join(root, ".my-tool")),
  skillsDir: (root) => join(root, ".my-tool", "skills"),
  commandsDir: (root) => null,  // No commands, skills only
  formatSkill: (content) => formatMarkdownSkill(content),  // Use shared formatter
  formatCommand: () => "",
}
```

Register in `.metta/config.yaml`:
```yaml
adapters:
  - .metta/adapters/my-tool.ts
```

### Tool Auto-Detection

During `metta init`, the framework scans for tool markers:
```
Found: .claude/ → Install Claude Code skills? [Y/n]
Found: .cursor/ → Install Cursor skills? [Y/n]
Not found: .github/agents → Skip Copilot
```

During `metta refresh`, re-scan and offer to install/remove for detected tools.

---

## Command/Skill Content

### Slash Command Example (Claude Code)

```markdown
---
name: metta:propose
description: Start a new change with Metta
argument-hint: "<description of what you want to build>"
allowed-tools: [Read, Write, Grep, Glob, Bash]
---

You are starting a new change using the Metta spec-driven development framework.

## Steps

1. Run `metta propose "$ARGUMENTS" --json` to initialize the change
2. Read the output to understand the workflow and first artifact needed
3. Run `metta instructions intent --json` to get detailed guidance
4. Follow the instructions to create the intent artifact
5. Run `metta status --json` to check progress and see what's next

## Rules

- Always run `metta status --json` before and after creating artifacts
- Follow the template structure from `metta instructions`
- Don't skip ahead — build artifacts in dependency order
- Commit artifacts as you create them
```

### Key Design Choice: CLI as Bridge

Slash commands don't contain workflow logic. They tell the AI tool to call `metta` CLI commands, which return structured instructions. This means:

- **Single source of truth**: Logic lives in the framework, not in 8 tool-specific command files
- **Instant updates**: `metta refresh` regenerates skills without framework version bump
- **Consistent behavior**: All tools get identical instructions via `metta instructions --json`

---

## Project Constitution

### `docs/project.md` — The Single Source

The project constitution is the single source of truth for all AI context. It captures everything an agent needs to know about how this project works — principles, conventions, constraints, standards. Every tool-specific context file (CLAUDE.md, .cursorrules, etc.) is **derived from the constitution**, never edited directly.

### Generated During `metta init`

When initializing a project, Metta runs discovery to build the constitution:

```bash
metta init
```

```
Detecting AI tools... found Claude Code, Cursor
Setting up project constitution...

? What does this project do?
> E-commerce platform for handmade goods

? What's the tech stack?
> Next.js 15, Prisma, PostgreSQL, Tailwind

? What coding conventions matter most?
> Server components by default, all API routes in src/app/api/,
  Prisma for all DB access, no direct SQL

? Any architectural constraints?
> No ORMs besides Prisma, no client-side state management libraries,
  keep bundle under 200KB

? Quality standards?
> 80% test coverage, all public APIs documented, WCAG 2.1 AA accessibility

? What's off-limits?
> No eval(), no dynamic requires, no secrets in code, no console.log in production
```

Metta generates `docs/project.md`:

```markdown
# My Shop — Project Constitution

## Project
E-commerce platform for handmade goods.

## Stack
Next.js 15, Prisma, PostgreSQL, Tailwind CSS

## Conventions
- Use server components by default
- All API routes in src/app/api/
- Prisma for all database access — no direct SQL
- Named exports only, no default exports

## Architectural Constraints
- No ORMs besides Prisma
- No client-side state management libraries
- Keep bundle under 200KB

## Quality Standards
- 80% test coverage minimum
- All public APIs documented with JSDoc
- WCAG 2.1 AA accessibility compliance

## Off-Limits
- No eval() or dynamic requires
- No secrets in code
- No console.log in production code
```

The user reviews, edits if needed, and approves. This is the ground truth — everything else is derived from it.

### Constitution Feeds Everything

The constitution is loaded by the Context Engine and used across the framework:

- **Discovery Gate**: Validates new specs against project conventions and constraints
- **Agent instructions**: Agents receive relevant constitution sections as context
- **Tool context files**: CLAUDE.md, .cursorrules, etc. are generated from the constitution
- **Gates**: Quality standards inform gate expectations
- **Slash commands**: Commands include project conventions in their instructions

### Editing the Constitution

```bash
metta config edit constitution    # Open docs/project.md in editor
metta refresh                     # Regenerate all derived files
```

Direct edits to `docs/project.md` are the way to change project context. Never edit CLAUDE.md or .cursorrules directly — changes will be overwritten on the next refresh.

---

## `metta refresh`

Regenerates all derived files from the constitution and current project state.

### What Gets Regenerated

| Output | Source | When it goes stale |
|--------|--------|--------------------|
| Tool context files (CLAUDE.md, .cursorrules, etc.) | Constitution + pointers to docs | Constitution edited, docs updated |
| Slash commands/skills | Command templates + project context | Templates updated, tools added/removed |
| Project docs | Specs + designs + archived changes | After ship or verify |

### Tool Context Files — Lightweight Pointers

Generated context files are **lookup tables, not content dumps**. They give the AI tool enough orientation to know where to find detail — the agent follows the links to load what it needs rather than paying the token cost upfront.

Example generated `CLAUDE.md`:

```markdown
<!-- Generated by Metta from docs/project.md — do not edit directly -->
<!-- Run `metta refresh` to regenerate, or edit docs/project.md -->

# My Shop

Stack: Next.js 15, Prisma, PostgreSQL, Tailwind CSS

## Conventions
- Use server components by default
- All API routes in src/app/api/
- Prisma for all database access — no direct SQL
- No eval(), no dynamic requires, no console.log in production

## Reference
- [Project Constitution](docs/project.md) — full principles, constraints, quality standards
- [Active Specs](docs/specs/) — current requirements and scenarios
- [Active Changes](docs/changes/) — work in flight
- [Architecture](docs/architecture.md) — system design and ADRs
- [API Reference](docs/api.md) — public API documentation
- [Changelog](docs/changelog.md) — what changed and why

## Metta Commands
Run `metta status --json` for current state. Run `metta instructions <artifact> --json` for guidance.
```

Key conventions are inlined (agents need these immediately). Everything else is a pointer. This keeps context files under 1K tokens regardless of project size.

### Project Documentation

All project documents live in a configurable output directory (default `./docs`). This includes the constitution, specs, changes, archives, and generated docs. After work is built and verified, the framework writes human-readable docs from specs, designs, and archived changes.

```yaml
# .metta/config.yaml (or ~/.metta/config.yaml for global default)
docs:
  output: ./docs              # All project documents (constitution, specs, changes, generated docs)
  generate_on: ship           # ship | verify | manual
  types:
    - architecture            # From design artifacts + ADRs
    - api                     # From specs + implementation
    - changelog               # From archived changes
    - getting-started         # From constitution + specs
```

#### Doc Types

| Type | Generated From | Contains |
|------|---------------|----------|
| `architecture` | Design artifacts, ADRs | System design, component relationships, decisions with rationale |
| `api` | Specs, implementation code | Public API surface, endpoints, types, usage examples |
| `changelog` | Archived changes | What changed, when, why — grouped by capability |
| `getting-started` | Constitution, specs | Setup instructions, key concepts, quick examples |

#### When Docs Generate

- **`generate_on: ship`** (default) — docs update when a change is archived. Specs are merged, so docs reflect the new truth.
- **`generate_on: verify`** — docs update after verification passes. Useful if you want docs before the formal ship step.
- **`generate_on: manual`** — only via `metta refresh` or `metta docs generate`.

```bash
metta docs generate            # Generate/update all configured doc types
metta docs generate api        # Generate only API docs
metta docs generate --dry-run  # Preview what would change
```

#### Doc Headers

Every generated doc includes a header:

```markdown
<!-- Generated by Metta — do not edit directly -->
<!-- Source: docs/specs/auth/, docs/archive/2026-04-05-add-mfa/ -->
<!-- Run `metta docs generate` to regenerate -->
```

The source list makes it clear which specs and changes produced the doc, useful for tracing decisions.

### When to Refresh

```bash
metta refresh              # Manual — regenerate everything (context files + docs + skills)
metta refresh --dry-run    # Preview changes without writing
```

**Automatic refresh** runs after:
- `metta ship` — specs merged, context files and docs are stale
- `metta init` — initial generation
- `metta config edit constitution` — constitution changed

---

## MCP Server

### Tiered Tool Loading

Inspired by Taskmaster's approach — load only the tools needed:

**Core (7 tools)**: For minimal context usage
```
metta_status          → Current change status
metta_next            → What artifact to build next
metta_instructions    → Get instructions for an artifact
metta_complete        → Mark artifact as complete
metta_specs_list      → List capabilities
metta_specs_show      → Show a spec
metta_changes_list    → List active changes
```

**Standard (14 tools)**: Adds workflow operations
```
+ metta_propose       → Start new change
+ metta_plan          → Build planning artifacts
+ metta_execute       → Run implementation
+ metta_verify        → Run verification
+ metta_ship          → Archive and merge
+ metta_config_get    → Read config
+ metta_context_stats → Context budget usage
```

**Extended (25+ tools)**: Full control
```
+ metta_specs_diff    → Show pending changes
+ metta_specs_history → Archive history
+ metta_changes_show  → Change details
+ metta_changes_abandon → Abandon change
+ metta_plugin_list   → Installed plugins
+ metta_doctor        → Diagnose issues
+ metta_gate_run      → Run specific gate
+ metta_update        → Refresh tool artifacts
...
```

Tier selection via environment variable:
```
METTA_MCP_TOOLS=core     # Minimal
METTA_MCP_TOOLS=standard # Default
METTA_MCP_TOOLS=extended # Full
```

### MCP Server Config

```json
// .mcp.json
{
  "mcpServers": {
    "metta": {
      "command": "metta",
      "args": ["mcp-server"],
      "env": {
        "METTA_MCP_TOOLS": "standard"
      }
    }
  }
}
```

---

## Configuration

### Principle: Global is the Default, Local is the Override

Global (`~/.metta/`) ships everything needed to work in any project. Project `.metta/` only contains what's different. You should be able to `metta init` and immediately `metta quick "something"` without configuring anything locally.

Resolution order (highest wins):
```
Environment variables         METTA_GATE_TIMEOUT=60000
  ↓ overrides
Local config (gitignored)     .metta/local.yaml
  ↓ overrides
Project config (committed)    .metta/config.yaml
  ↓ overrides
Global config                 ~/.metta/config.yaml
```

### Global (`~/.metta/config.yaml`) — The Defaults

Everything lives here. Workflows, agents, gates, providers, tool preferences. This is what you configure once and use everywhere.

```yaml
# User preferences
defaults:
  workflow: standard
  mode: supervised

# AI provider config
providers:
  main:
    provider: anthropic
    model: claude-opus-4-6-20250415
  research:
    provider: anthropic
    model: claude-sonnet-4-6-20250414
  fallback:
    provider: openai
    model: gpt-4.1

# Tool delivery
tools:
  - claude-code
  - cursor

# Gate defaults (used when project doesn't specify)
gates:
  tests:
    command: npm test
    timeout: 120000
  lint:
    command: npm run lint
    timeout: 30000
  typecheck:
    command: npx tsc --noEmit
    timeout: 60000

# Git integration
git:
  enabled: true
  commit_convention: conventional  # conventional | none | custom

# Project documents directory
docs:
  output: ./docs              # Constitution, specs, changes, generated docs all live here
  generate_on: ship           # ship | verify | manual
  types: [architecture, api, changelog, getting-started]

# Auto mode defaults
auto:
  max_cycles: 10
  ship_on_success: false
```

### Project (`.metta/config.yaml`) — Overrides Only

Only what differs from global. A minimal project config might just be the project context:

```yaml
# Project context for agents (required — tells agents what they're working on)
project:
  name: "My App"
  description: "E-commerce platform"
  stack: "Next.js, Prisma, PostgreSQL"
  conventions: |
    - Use server components by default
    - All API routes in src/app/api/
    - Prisma for all database access
```

A project that needs customization adds only what's different:

```yaml
project:
  name: "My App"
  description: "E-commerce platform"
  stack: "Next.js, Prisma, PostgreSQL"

# Override: this project uses full ceremony
defaults:
  workflow: full

# Override: different test command
gates:
  tests:
    command: pnpm test
```

Everything not overridden inherits from global.

### Local (`.metta/local.yaml`, gitignored) — Personal Preferences

```yaml
# Personal overrides, not committed
providers:
  main:
    api_key_env: ANTHROPIC_API_KEY  # Reference env var, never store keys

defaults:
  mode: autonomous  # I trust the backpressure
```
