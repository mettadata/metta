# 09 — CLI & Integration Model

## CLI Design

### Command Structure

```
metta init                          # Initialize project
metta propose <description>        # Start a new change (standard workflow)
metta quick <description>          # Quick mode (skip planning)
metta plan                         # Build next planning artifacts
metta execute                      # Run implementation
metta verify                       # Run verification
metta ship                         # Archive change, merge specs
metta ship --dry-run               # Preview merge without applying

metta status                       # Show current change status
metta status --json                # Machine-readable status
metta instructions <artifact>      # Generate AI instructions for an artifact
metta instructions <artifact> --json

metta specs list                   # List all capabilities
metta specs show <capability>      # Show current spec
metta specs diff <capability>      # Show pending changes
metta specs history <capability>   # Show archive history

metta changes list                 # List active changes
metta changes show <name>          # Show change details
metta changes abandon <name>       # Abandon a change

metta context stats                # Show context budget usage
metta context check                # Check for stale context

metta plugin list                  # List installed plugins
metta plugin install <name>        # Install from registry
metta plugin remove <name>         # Safe uninstall

metta config get <key>             # Read config value
metta config set <key> <value>     # Set config value
metta config edit                  # Open config in editor

metta update                       # Refresh tool commands/skills
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
  detect(projectRoot: string): boolean        // Auto-detect tool presence
  skillsDir(root: string): string | null      // Where to write skills
  commandsDir(root: string): string | null    // Where to write commands
  formatSkill(content: SkillContent): string  // Tool-specific skill format
  formatCommand(content: CommandContent): string  // Tool-specific command format
}
```

### Built-in Adapters

| Tool | Skills Dir | Commands Dir | Format |
|------|-----------|-------------|--------|
| Claude Code | `.claude/skills/metta-*/SKILL.md` | `.claude/commands/metta/*.md` | Markdown + YAML frontmatter |
| Cursor | `.cursor/skills/metta-*/SKILL.md` | `.cursor/commands/metta/*.md` | Markdown + YAML frontmatter |
| Copilot | `.github/agents/metta.*.agent.md` | — | Markdown + companion prompts |
| Codex | `.codex/skills/metta-*/SKILL.md` | — | Markdown + TOML config |
| Gemini | — | `.gemini/commands/metta.*.toml` | TOML with multiline prompt |
| Windsurf | `.windsurf/skills/metta-*/SKILL.md` | — | Markdown + YAML frontmatter |
| OpenCode | — | `.config/opencode/commands/metta/*.md` | Markdown |
| Generic | — | User-specified | Markdown |

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

During `metta update`, re-scan and offer to install/remove for detected tools.

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
- **Instant updates**: `metta update` refreshes skills without framework version bump
- **Consistent behavior**: All tools get identical instructions via `metta instructions --json`

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

### Global (`~/.metta/config.yaml`)

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
```

### Project (`.metta/config.yaml`)

```yaml
# Overrides global for this project
defaults:
  workflow: full  # This project uses full ceremony

# Project context for agents
project:
  name: "My App"
  description: "E-commerce platform"
  stack: "Next.js, Prisma, PostgreSQL"
  conventions: |
    - Use server components by default
    - All API routes in src/app/api/
    - Prisma for all database access

# Gate configuration
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
```

### Local (`.metta/local.yaml`, gitignored)

```yaml
# Personal overrides, not committed
providers:
  main:
    api_key_env: ANTHROPIC_API_KEY  # Reference env var, never store keys

defaults:
  mode: autonomous  # I trust the backpressure
```
