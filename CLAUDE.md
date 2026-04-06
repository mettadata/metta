# metta

<!-- metta:project-start source:spec/project.md -->
## Project

**metta** -- A composable, spec-driven development framework for AI-native software engineering. CLI tool orchestrating the full change lifecycle: propose, plan, execute, verify, finalize, ship. Works with any AI coding tool via instruction mode — the framework manages state and specs while the AI tool executes.

Stack: TypeScript (strict mode, ES2022 target), Node.js >= 22, ESM only, Commander.js (CLI), Zod (schema validation on every state read/write), YAML (state persistence, templates, workflow definitions), Anthropic SDK (AI provider), remark-parse + unified (markdown spec parsing), Vitest (testing)
<!-- metta:project-end -->

<!-- metta:conventions-start source:spec/project.md -->
## Conventions

- Classes for stateful modules, interfaces for contracts
- Always include `.js` extensions in TypeScript import paths (Node16 ESM)
- Validate all state and config with Zod schemas
- Custom error classes with typed hierarchies
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Barrel exports via `index.ts` at `src/` root
- Template files (YAML workflows, gates, artifacts, skills, agents) copied to `dist/` at build time
- Functional core, imperative shell: pure logic in modules, I/O at the edges
- Maintain near 1:1 test-to-source file ratio
- No CommonJS
- No singletons
- No unvalidated state writes
- No auto-push to remote without explicit user confirmation
- No `--force` pushes, no `--no-verify`, no destructive git ops without user request
- No string literal templates in TypeScript code
<!-- metta:conventions-end -->

<!-- metta:workflow-start -->
## Metta Workflow

### Lifecycle
- `metta propose <description>` -- start a new change (standard workflow)
- `metta quick <description>` -- quick mode (skip planning)
- `metta auto <description>` -- full lifecycle loop
- `metta plan` -- build planning artifacts
- `metta execute` -- run implementation
- `metta verify` -- check against spec
- `metta finalize` -- archive, merge specs, run gates
- `metta ship` -- merge branch to main

### Status
- `metta status` -- current change status
- `metta progress` -- project-level dashboard
- `metta next` -- what to do next
- `metta complete <artifact>` -- mark artifact done

### Specs & Docs
- `metta specs list` -- list specifications
- `metta docs generate` -- generate project documentation
- `metta import .` -- import existing code into specs
- `metta gaps list` -- show reconciliation gaps
- `metta fix-gap --all` -- fix gaps automatically

### Organization
- `metta idea <description>` -- capture an idea
- `metta issue <description>` -- log an issue
- `metta changes list` -- list active changes
- `metta backlog list` -- list backlog items

### System
- `metta doctor` -- diagnose environment
- `metta config get <key>` -- read configuration
- `metta gate run <name>` -- run a quality gate
- `metta refresh` -- regenerate CLAUDE.md and derived files
- `metta update` -- update framework
<!-- metta:workflow-end -->

<!-- metta:specs-start source:spec/specs/ -->
## Active Specs

| Capability | Requirements |
|------------|-------------|
| artifact-store | 19 |
| config-loader | 59 |
| context-engine | 49 |
| execution-engine | 49 |
| finalize-ship | 26 |
| schemas | 126 |
| spec-model | 26 |
| state-store | 73 |
| workflow-engine | 69 |
<!-- metta:specs-end -->

<!-- metta:reference-start -->
## Reference

- [Project Constitution](spec/project.md)
- [Active Specs](spec/specs/)
- [Archive](spec/archive/)
- [Docs](docs/)
<!-- metta:reference-end -->
