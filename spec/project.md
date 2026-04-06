# metta — Project Constitution

## Project
A composable, spec-driven development framework for AI-native software engineering. CLI tool orchestrating the full change lifecycle: propose, plan, execute, verify, finalize, ship. Works with any AI coding tool via instruction mode — the framework manages state and specs while the AI tool executes.

## Stack
- TypeScript (strict mode, ES2022 target)
- Node.js >= 22, ESM only
- Commander.js (CLI)
- Zod (schema validation on every state read/write)
- YAML (state persistence, templates, workflow definitions)
- Anthropic SDK (AI provider)
- remark-parse + unified (markdown spec parsing)
- Vitest (testing)

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

## Architectural Constraints
- ESM only — no CommonJS, no mixed module systems
- Dependency injection over singletons — registries are instantiated and injected
- Templates as external files — never string literals in TypeScript
- Schema validation on every state transition — Zod on every read/write
- Git-aware as config toggle — `git.enabled` controls commits, worktrees, merge safety
- Instruction mode (v1) — framework is passive state machine, AI tool executes
- Single package for v0.1 — not a monorepo

## Quality Standards
- Unit tests per module with temp dir isolation
- Vitest with `describe`/`it`/`expect`
- `npx tsc --noEmit` for type checking
- All gates (tests, lint, typecheck, build) must pass before finalize

## Off-Limits
- No CommonJS
- No singletons
- No unvalidated state writes
- No auto-push to remote without explicit user confirmation
- No `--force` pushes, no `--no-verify`, no destructive git ops without user request
- No string literal templates in TypeScript code
