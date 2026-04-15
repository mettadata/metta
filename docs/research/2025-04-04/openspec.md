# OpenSpec Analysis

**Repo**: `referrences/OpenSpec/`
**By**: Fission AI
**Stack**: Node.js/TypeScript, Commander.js CLI, Zod validation
**Philosophy**: Fluid, iterative, easy, built for brownfield

---

## Architecture

OpenSpec is built around three core abstractions:

1. **ArtifactGraph** - Models artifact dependencies as a DAG using Kahn's algorithm for topological sort. Computes deterministic build order and tracks what's ready to build next.

2. **ToolCommandAdapter** - Polymorphic interface for delivering commands to 25+ AI tools. Each adapter handles tool-specific formatting (YAML frontmatter for Claude, TOML for Gemini, etc.). Adding a new tool is ~50 lines.

3. **Schema System** - YAML-based workflow definitions validated with Zod. Defines artifact types, templates, and dependency chains. Supports custom schemas for team-specific workflows.

**CLI**: Commander.js with commands for `init`, `update`, `list`, `view`, `show`, `validate`, `archive`, `status`, `instructions`, `templates`, `schemas`.

**Slash Command Flow**:
1. `openspec init` generates skills at `.claude/skills/openspec-*/SKILL.md` and commands at `.claude/commands/opsx/*.md`
2. User types `/opsx:propose "add-dark-mode"` in their AI tool
3. Tool loads command file, which instructs it to call `openspec status --json` and `openspec instructions proposal --json`
4. CLI returns XML-structured prompts with task, context, rules, template, and dependency status
5. AI generates artifacts in `openspec/changes/<name>/`

---

## Core Workflow

### Default (Core Profile): 4 commands
```
/opsx:propose → /opsx:apply → /opsx:archive
```

### Extended (Custom Profile): 10+ commands
```
/opsx:new → /opsx:continue → /opsx:ff → /opsx:verify → /opsx:sync → /opsx:apply → /opsx:archive
```

### Artifacts per phase

**Proposal**: `proposal.md` (why, what changes, capabilities, impact) + `.openspec.yaml` (metadata)

**Specs** (delta format): `specs/<capability>/spec.md` with ADDED/MODIFIED/REMOVED/RENAMED sections using RFC 2119 keywords (SHALL/MUST/SHOULD/MAY) and Given/When/Then scenarios

**Design**: `design.md` (context, goals, decisions, risks, migration plan)

**Tasks**: `tasks.md` (checkbox format, grouped by phase)

**Archive**: Moves to `archive/YYYY-MM-DD-<name>/`, merges delta specs into `openspec/specs/`

---

## Strengths

- **Strong type safety**: Zod schemas for all data structures, custom error classes
- **Comprehensive testing**: 12,964 lines of test code (Vitest with process isolation)
- **Flexible workflow definitions**: Artifact dependency graphs, not fixed phase gates
- **Brownfield support**: Delta-based spec evolution (ADDED/MODIFIED/REMOVED)
- **25+ tool adapters**: Single polymorphic interface, ~50 lines per adapter
- **Profile system**: Core (simple) vs Custom (expanded) workflows
- **Shell completion**: Tab completion for Bash/Zsh/PowerShell
- **Global config**: XDG Base Directory spec support

---

## Weaknesses / Gaps

### Critical: Parallel Change Collision
When two changes modify the same requirement, the second archive silently overwrites the first. No base fingerprinting, no conflict markers, no sync/rebase workflow. This is documented in `openspec-parallel-merge-plan.md` but not yet fixed.

### Architectural Limitations
- **Hardcoded templates**: Stored as TypeScript string literals in `src/core/templates/workflows/*.ts` — users can't patch without forking
- **Single-pass archive**: No dry-run, no rollback, no partial archive
- **Limited delta language**: Only 4 operations (ADDED/MODIFIED/REMOVED/RENAMED), no scenario-level granularity
- **Regex-based parsing**: Fragile to formatting changes

### Error Handling
- Multi-tool skill generation can fail mid-way leaving inconsistent state
- No pre-validation before proposing changes
- Circular dependency detection exists in graph but not explicitly warned about

### Missing
- No caching of parsed specs (re-parses from disk every time)
- No spec diffing between versions
- Context window management not enforced (large tasks.md can exceed token limits)
- Change name collision not warned about

---

## Key Design Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Delta-based spec evolution | Brownfield support, clear audit trail | Increases merge complexity |
| Artifact DAG (not phase-locked) | Flexible iteration, custom workflows | Requires DAG understanding |
| Zod over JSON Schema | Better TypeScript integration, composable | Not portable YAML |
| Adapter pattern for tools | ~50 lines per tool, centralized logic | Must understand each tool's format |
| Skill generation as templating | Central control, consistent behavior | Users can't tweak without forking |
| RFC 2119 requirement specs | Clear semantics, testable scenarios | Overhead for small projects |
