# Contributing to metta

Thanks for working on metta. This guide covers setup, the conventions the codebase holds itself to, and how changes get made — including the fact that **metta is developed using metta** (it dogfoods its own workflow).

## Setup

Requirements: **Node.js >= 22** (ESM only), npm.

```bash
npm install
npm run build        # tsc + copy-templates (src/templates → dist/templates)
npm link             # optional: put the `metta` binary on your PATH, linked to this repo
```

`npm run build` is `tsc` followed by `copy-templates`, which copies the template trees (workflows, gates, skills, agents, hooks, statusline, docs, artifacts) into `dist/templates/`. Templates are **files copied at build time — never inlined as string literals in TypeScript**.

## Testing

The suite uses [Vitest](https://vitest.dev): **1015 tests across 78 files** (`tests/**/*.test.ts` and co-located `src/**/*.test.ts`).

```bash
npm test                                   # full suite
npx vitest run tests/<file>.test.ts        # one file (fast iteration)
npx vitest list                            # list tests without running
npx tsc --noEmit                           # typecheck (the test harness uses tsx and does NOT typecheck)
```

- Maintain a **near 1:1 test-to-source ratio** — new source files should come with tests.
- `npx tsc --noEmit` is an important safety net: the `tsx`-based test runner does not type-check, so a passing test does not prove the types are sound.
- The full suite is also the pre-merge gate run by `metta finalize` (5-minute timeout).

See [`QA-TEST-GUIDE.md`](QA-TEST-GUIDE.md) for the broader testing approach.

## Conventions

These are enforced by the project [constitution](spec/project.md); summarized here:

- **TypeScript strict mode, ES2022, ESM only.** No CommonJS (`require`/`module.exports`).
- **Always include `.js` extensions** in relative import paths (Node16/nodenext ESM).
- `camelCase` for functions/variables, `PascalCase` for classes/types, `kebab-case` for filenames.
- **Validate all state and config with Zod schemas** — no unvalidated state writes. (Markdown artifact *bodies* are the documented exception, written via `writeRaw`.)
- **Custom error classes with typed hierarchies** rather than bare `throw new Error` in core paths.
- **Functional core, imperative shell**: pure logic in modules, I/O at the edges.
- **Conventional commits**: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- Barrel exports via `src/index.ts`.
- No singletons. No `--force` pushes, no `--no-verify`, no destructive git ops without explicit request. No auto-push without confirmation.

### The byte-identity rule (important)

The deployed `.claude/` copies of templates (`agents/`, `skills/`, `hooks/`, `statusline/`) **must stay byte-identical to their `src/templates/` sources** — metta dogfoods its own templates. If you edit a template, update the deployed copy too. `tests/template-deploy-sync.test.ts` enforces this (a past drift shipped a stale agent and broke the suite). See [Extending metta](docs/internals/extending.md).

## How changes are made

metta is built with metta. For substantive work the workflow runs through the lifecycle skills (`/metta-propose` → plan → execute → verify → `/metta-ship`), which produce spec artifacts under `spec/changes/<slug>/` and archive them on ship. The guard hooks ([`guard-hooks.md`](docs/internals/guard-hooks.md)) enforce that AI-orchestrated sessions go through the skills rather than calling the `metta` CLI directly.

If you're contributing as a human via PRs, you don't need to run the skills — but please keep commits conventional, keep tests green (`npm test` + `npx tsc --noEmit`), and respect the byte-identity rule.

## Where to look

- [Architecture](docs/internals/architecture.md) — the subsystem map and how a change flows through the system.
- [Data Model](docs/internals/data-model.md) — what's persisted where, and the schemas.
- [Extending metta](docs/internals/extending.md) — add a command, gate, workflow, skill, or provider.
- [Guard Hooks](docs/internals/guard-hooks.md) — the enforcement layer.
