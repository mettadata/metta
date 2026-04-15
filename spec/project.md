# metta — Project Constitution

## Project

**metta** is a composable, spec-driven development framework for AI-native software engineering. It is a CLI / developer tool that orchestrates the full change lifecycle — propose → plan → execute → verify → finalize → ship — for internal developers adopting metta on their own projects. The framework works with any AI coding tool via instruction mode: metta manages state and specs while the AI tool executes the work.

## Stack

- **Language:** TypeScript (strict mode, ES2022 target)
- **Runtime:** Node.js >= 22 (ESM only)
- **Frameworks & libraries:**
  - Commander.js — CLI argument parsing
  - Zod — schema validation on every state read/write
  - Vitest — unit testing
  - remark-parse + unified — markdown spec parsing
  - Anthropic SDK — AI provider integration
- **Persistence:** Filesystem-based — `.metta/` YAML state files, `spec/` spec store, git as the transaction log
- **Toolchain:** `tsc` for build, `npm` for package management (tsx is not currently part of the dev loop)

<!-- source: https://dev.to/chengyixu/the-complete-guide-to-building-developer-cli-tools-in-2026-a96 -->

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

<!-- source: https://github.com/google/gts -->
<!-- source: https://typescript-eslint.io/getting-started/ -->

## Architectural Constraints

- **ESM only** — no CommonJS, no mixed module systems
- **Dependency injection over singletons** — registries are instantiated and injected
- **Templates as external files** — never string literals in TypeScript
- **Schema validation on every state transition** — Zod on every read/write
- **Git-aware as a config toggle** — `git.enabled` controls commits, worktrees, and merge safety
- **Instruction mode (v1)** — the framework is a passive state machine; the AI tool executes
- **Single package for v0.1** — not a monorepo

## Quality Standards

- Unit tests per module with temp-dir isolation
- Vitest with `describe` / `it` / `expect`
- `npx tsc --noEmit` for type checking
- All gates — tests, lint, typecheck, build, stories-valid — must pass before `finalize`
- Near 1:1 test-to-source ratio maintained

## Off-Limits

- No CommonJS
- No singletons
- No unvalidated state writes
- No auto-push to remote without explicit user confirmation
- No `--force` pushes, no `--no-verify`, no destructive git ops without user request
- No string literal templates in TypeScript code
