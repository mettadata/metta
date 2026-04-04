# Spec Kit Analysis

**Repo**: `referrences/spec-kit/`
**By**: GitHub
**Stack**: Python 3.11+, Typer CLI, uv/uvx packaging
**Philosophy**: Specifications become executable, directly generating implementations

---

## Architecture

Three-tier system:

### A. CLI Layer (`src/specify_cli/__init__.py` — 3995 lines)
Single entry point via Typer. Subcommands: `init`, `check`, `integrate`, `extension`, `preset`. Rich terminal UI with interactive selection, progress tracking, banner rendering.

### B. Integration System (`src/specify_cli/integrations/`)
- **Base abstractions**: `IntegrationBase` (abstract), `MarkdownIntegration`, `TomlIntegration`, `SkillsIntegration`
- **Registry pattern**: Global `INTEGRATION_REGISTRY` with 26 agent integrations
- **Manifest tracking**: SHA-256 hash-based file tracking for safe uninstall (prevents deleting user-modified files)
- **Path traversal prevention**: Validates containment on all file operations

### C. Extensions & Presets (Modular plugins)
- **Extensions**: Self-contained packages adding commands (`speckit.{ext-id}.{command}`). Manifest validation, catalog support, hook system (before/after core workflows), layered config (defaults -> project -> local -> env).
- **Presets**: Versioned template collections (artifact, command, script templates).

### Command Delivery to Agents
Static file delivery during `specify init`:
1. Scan `templates/commands/` for core commands
2. Parse YAML frontmatter, extract scripts, replace placeholders (`{SCRIPT}`, `{ARGS}`, `__AGENT__`)
3. Rewrite paths (repo-relative -> project paths)
4. Write to agent-specific locations:
   - Claude: `.claude/skills/speckit-{cmd}/SKILL.md`
   - Copilot: `.github/agents/speckit.{cmd}.agent.md`
   - Gemini: `.gemini/commands/speckit.{cmd}.toml`
   - Generic: accepts `--commands-dir`

---

## Core Workflow

### Phase-gated: Constitution -> Specify -> Plan -> Tasks -> Implement

**1. Constitution** (`/speckit.constitution`)
Sets project principles, development guidelines, code quality standards. Ground truth for all downstream decisions.

**2. Specify** (`/speckit.specify` — 310 lines)
- Generates branch name, creates feature branch + spec file
- Populates `spec-template.md` with details
- Generates Specification Quality Checklist
- Interactive clarification loop (max 3 NEEDS CLARIFICATION iterations)
- Validates spec against checklist before proceeding
- Output: `specs/{branch}/spec.md`

**3. Plan** (`/speckit.plan`)
- Phase 0 Research: resolves unknowns -> `research.md`
- Phase 1 Design: data models + contracts -> `data-model.md`, `contracts/*.md`
- Phase 2 Evaluation: constitutional compliance check
- Output: `specs/{branch}/plan.md`

**4. Tasks** (`/speckit.tasks`)
- Extracts contracts -> API tasks, entities -> data layer tasks, scenarios -> testing tasks
- Marks parallelizable tasks with `[P]`
- Sequences with dependencies
- Output: `specs/{branch}/tasks.md`

**5. Implement** (`/speckit.implement`)
- Executes tasks from task list
- Generates code from specifications
- Runs tests to verify spec compliance

### Artifact Structure
```
specs/{feature-number}-{branch-name}/
  spec.md
  checklists/requirements.md
  plan.md
  research.md
  data-model.md
  contracts/{api-name}.md
  quickstart.md
  tasks.md
```

---

## Strengths

- **Extensibility architecture**: Extensions, presets, hooks, layered config, catalogs with priority stacking — the most extensible system in this space
- **26 AI agent integrations** through clean registry + mixin pattern (Markdown, TOML, Skills)
- **Safe uninstall**: SHA-256 hash verification prevents deleting user-modified files
- **Type hints throughout**: Python 3.11+, custom exception hierarchy
- **40+ test files** covering integrations, manifests, registries, extensions, presets
- **Constitution-driven**: Project principles guide all decisions
- **Research-informed planning**: Phase 0 resolves unknowns before design
- **Cross-platform scripts**: Bash + PowerShell versions with platform detection
- **Handoff pattern**: Commands declare next-step alternatives, guiding users through workflow

---

## Weaknesses / Gaps

### Missing Features
- No rollback mechanism for created specs/plans/tasks
- No branching/merging of spec variations
- No spec diffing between versions
- No audit trail (who changed spec when, why)
- No concurrent feature development (branch numbering sequential only)
- No template composition/inheritance

### Error Handling
- Some hooks fail silently
- Path rewriting is regex-based, fragile on complex paths
- Script execution errors (`{SCRIPT}`) not always caught
- Network errors for extension/preset downloads have basic messages only

### Tight Coupling
- 26 agent configs hardcoded (drift risk)
- `.specify/` path hardcoded throughout (not configurable)
- CLI dependent on Typer (not portable)
- Template directory has multiple fallback paths (wheel -> source -> fallback)

### Heavyweight Process
- Up to 3 validation cycles required before proceeding
- Mandatory clarification even when defaults are reasonable
- Can't do plan without complete spec (no escape hatch)
- Interactive CLI not scripting-friendly (no batch mode)
- Always goes through full constitution setup (no quick-start)

### Testing Gaps
- Most tests are unit tests; integration tests limited
- No E2E tests for full specify -> plan -> tasks -> implement workflow
- Hook execution (HookExecutor) untested
- Hash collision scenarios not covered

### Documentation Gaps
- No troubleshooting guide
- No migration guide between versions
- Incomplete API docs for extensions
- No contrib guidelines for adding new agent integrations

---

## Key Design Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Specification as source of truth | Bridge intent-implementation gap | Overhead for small projects |
| Strategy + Registry pattern | Decouples agents from core | 26 integrations to maintain |
| Template processing pipeline | Same template targets multiple agents | Complex pipeline to debug |
| Hash-based safe uninstall | Prevents deleting user modifications | Must track all installed files |
| Phase-gating via checkpoints | Forces thoughtful progression | Can feel heavyweight |
| Layered configuration | Team defaults + local overrides + env | Complex merging semantics |
| Handoff pattern in templates | Guides users without hardcoding sequence | Must maintain handoff metadata |
