# metta -- Project Constitution

## Project
**metta** is a composable, context-aware, spec-driven development (SDD) framework for AI-native software engineering. It provides a CLI tool (`@mettadata/metta` v0.1.0) that orchestrates the full change lifecycle: propose, plan, execute, verify, and ship. The framework enforces structured workflows with gate checks, artifact generation, and merge safety guarantees.

## Stack
- **Language**: TypeScript (strict mode, ES2022 target)
- **Runtime**: Node.js >= 22, ESM modules (`"type": "module"`)
- **Module system**: Node16 resolution, `.js` extensions required in all imports
- **CLI framework**: Commander.js
- **Validation**: Zod schemas for all state and config
- **Configuration**: YAML files with layered config resolution
- **AI provider**: Anthropic SDK (`@anthropic-ai/sdk`)
- **Markdown parsing**: unified + remark-parse
- **Testing**: Vitest (globals, `describe`/`it`/`expect` style)
- **Build**: `tsc` with declaration maps and source maps
- **Package**: `@mettadata/metta`, scoped npm package, MIT license

## Conventions
- **Classes** for stateful modules (state managers, engines, providers)
- **Interfaces** for contracts and boundaries between subsystems
- **Explicit `.js` extensions** in all TypeScript import paths (Node16 ESM requirement)
- **Custom error classes** with typed error hierarchies
- **Zod schemas** for runtime validation of YAML state files and configuration
- **Conventional commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- **Barrel exports** via `index.ts` at `src/` root
- **Template files** (YAML workflows, gates, artifacts, skills) copied to `dist/` at build time
- **Test isolation**: each test uses temporary directories, no shared mutable state
- **Functional core, imperative shell**: pure logic in modules, I/O at the edges (CLI, state, providers)

## Architectural Constraints
- **YAML state, not a database**: all change state lives in `.metta/` YAML files validated by Zod
- **Pluggable AI providers**: provider interface abstracts AI calls; Anthropic is default, others can be added
- **Workflow DAG engine**: topological sort with cycle detection; workflows must be acyclic
- **Merge safety pipeline**: snapshot tags, drift detection, and rollback on every merge operation
- **Layered config**: project config (`.metta/config.yaml`) -> user config -> CLI flags, each layer overrides the previous
- **No runtime dependencies beyond declared**: everything in `package.json` dependencies, no implicit globals
- **20 source modules, 22 test files**: maintain near 1:1 test-to-source ratio

## Quality Standards
- Every source module has a corresponding test file
- Tests use Vitest with `describe`/`it`/`expect`, run via `npm test` (`vitest run`)
- Type checking via `tsc --noEmit` (the `lint` script)
- Strict TypeScript: `strict: true`, `forceConsistentCasingInFileNames: true`
- All state mutations validated through Zod schemas before write
- Merge operations protected by snapshot/rollback safety net

## Off-Limits
- **Never auto-push to remote**: all `git push` operations require explicit user confirmation
- **Never delete state without confirmation**: `.metta/` state files are never removed or overwritten destructively without user approval
- **No force pushes**: `git push --force` is forbidden in automated workflows
- **No skipping git hooks**: `--no-verify` is never used automatically
- **No implicit destructive git operations**: `git reset --hard`, `git clean -f`, `git checkout .` require explicit user request
