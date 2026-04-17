# metta

<!-- metta:project-start source:spec/project.md -->
## Project

**metta** -- **metta** is a composable, spec-driven development framework for AI-native software engineering. It is a CLI / developer tool that orchestrates the full change lifecycle — propose → plan → execute → verify → finalize → ship — for internal developers adopting metta on their own projects. The framework works with any AI coding tool via instruction mode: metta manages state and specs while the AI tool executes the work.

Stack: **Language:** TypeScript (strict mode, ES2022 target), **Runtime:** Node.js >= 22 (ESM only), **Frameworks & libraries:**, - Commander.js — CLI argument parsing, - Zod — schema validation on every state read/write, - Vitest — unit testing, - remark-parse + unified — markdown spec parsing, - Anthropic SDK — AI provider integration, **Persistence:** Filesystem-based — `.metta/` YAML state files, `spec/` spec store, git as the transaction log, **Toolchain:** `tsc` for build, `npm` for package management (tsx is not currently part of the dev loop)
<!-- metta:project-end -->

<!-- metta:conventions-start source:spec/project.md -->
## Conventions

- Classes for stateful modules; interfaces for contracts
- `camelCase` for functions/variables, `PascalCase` for classes/types, `kebab-case` for filenames
- Always include `.js` extensions in TypeScript import paths (Node16 ESM)
- Validate all state and config with Zod schemas
- Custom error classes with typed hierarchies
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Barrel exports via `index.ts` at the `src/` root
- Template files (YAML workflows, gates, artifacts, skills, agents) are copied to `dist/` at build time — never inlined as string literals
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

### How to work

**AI orchestrators MUST invoke the matching metta skill — never call the CLI directly.** (Humans running the CLI in a terminal are unaffected — this rule scopes to AI-driven sessions.) The skills wrap artifact authoring, review, and verification with the correct subagent personas; calling the CLI directly bypasses those guarantees and has shipped broken artifacts (see `spec/issues/metta-complete-accepts-stub-placeholder-artifacts-on-intent-.md`).

Primary entry points:
- `/metta-quick <description>` — small, scoped fixes (bug fixes, one-file edits, tiny refactors)
- `/metta-propose <description>` — anything non-trivial (new features, multi-file changes, API surface changes)
- `/metta-fix-issues <slug>` — resolve a logged issue from `spec/issues/`

Doc-only fixes and edits to this workflow section itself are the exceptions.

### Forbidden

- Invoking `metta quick`, `metta propose`, `metta finalize`, `metta complete`, `metta issue`, or any other `metta <cmd>` directly from an AI orchestrator session. Use the matching skill.
- Writing placeholder content like `"intent stub"` or `"summary stub"` to any artifact file to satisfy `metta complete`. Artifacts must carry real content authored by the matching `metta-*` subagent.

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
| context-engine | 72 |
| custom-claude-statusline-conte | 86 |
| execution-engine | 49 |
| finalize-ship | 26 |
| fix-issue-stories-parser-multi | 3 |
| fix-metta-next-gap-detect-unme | 8 |
| metta-issue-metta-backlog-slas | 11 |
| schemas | 126 |
| spec-model | 26 |
| spec:-fix-issue-metta-ship-merged-fi | 10 |
| spec:-metta-fix-issues-cli-command-m | 78 |
| split-metta-install-metta-init | 20 |
| state-store | 73 |
| t8-post-merge-gate-re-run-afte | 5 |
| user-story-layer-for-spec-format-(t5) | 84 |
| workflow-engine | 69 |
<!-- metta:specs-end -->

<!-- metta:reference-start -->
## Table of Contents

| Resource | Path | Description |
|----------|------|-------------|
| [Constitution](spec/project.md) | `spec/project.md` | Project principles, stack, conventions, constraints |
| [Active Specs](spec/specs/) | `spec/specs/` | Living specifications per capability |
| [Active Changes](spec/changes/) | `spec/changes/` | Work in flight |
| [Archive](spec/archive/) | `spec/archive/` | Completed changes with artifacts |
| [Gaps](spec/gaps/) | `spec/gaps/` | Reconciliation gaps (spec vs code) |
| [Issues](spec/issues/) | `spec/issues/` | Logged issues |
| [Backlog](spec/backlog/) | `spec/backlog/` | Prioritized backlog items |
| [Architecture](docs/architecture.md) | `docs/architecture.md` | System design and components |
| [API Reference](docs/api.md) | `docs/api.md` | Capabilities and scenarios |
| [Changelog](docs/changelog.md) | `docs/changelog.md` | What changed and when |
| [Getting Started](docs/getting-started.md) | `docs/getting-started.md` | Setup and quick start |
<!-- metta:reference-end -->
