# metta

<!-- metta:project-start source:spec/project.md -->
## Project

**metta** -- A composable, spec-driven development framework for AI-native software engineering. CLI tool orchestrating change lifecycle: propose, plan, execute, verify, ship.

Stack: TypeScript (strict, ES2022), Node.js >= 22, ESM, Commander.js, Zod, YAML state, Anthropic SDK, Vitest
<!-- metta:project-end -->

<!-- metta:conventions-start source:spec/project.md -->
## Conventions

- Use classes for stateful modules, interfaces for contracts
- Always include `.js` extensions in TypeScript import paths (Node16 ESM)
- Validate all state and config with Zod schemas
- Use custom error classes with typed hierarchies
- Follow conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Barrel exports via `index.ts` at `src/` root
- Template files (YAML workflows, gates, artifacts, skills) copied to `dist/` at build time
- Write tests in Vitest using `describe`/`it`/`expect` with temp dir isolation
- Maintain near 1:1 test-to-source file ratio
- Functional core, imperative shell: pure logic in modules, I/O at the edges
- No CommonJS, no singletons, no unvalidated state writes
- Never auto-push to remote or delete state without explicit user confirmation
- No `--force` pushes, no `--no-verify`, no destructive git ops without user request
<!-- metta:conventions-end -->

<!-- metta:workflow-start -->
## Metta Workflow

Use these entry points:
- `metta propose <description>` for new features
- `metta quick <description>` for small fixes
- `metta auto <description>` for full lifecycle
- `metta status --json` for current state
<!-- metta:workflow-end -->
