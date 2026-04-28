# Research: fix-finalize-stage-should-auto-update-docs-changelog-md

## Decision: Schema default approach (`docs: DocsConfigSchema.default({})`)

## Approaches Considered

1. **Schema default** (selected) — change `src/schemas/project-config.ts:77` from `docs: DocsConfigSchema.optional()` to `docs: DocsConfigSchema.default({})`, and drop the `docsConfig &&` truthy guard at `src/finalize/finalizer.ts:128`. The Zod schema's inner defaults already supply `output: './docs'`, `generate_on: 'finalize'`, and `types: [...]`, so an absent `docs:` block resolves in-memory to a fully populated `DocsConfig`, the finalizer guard passes on a single `generate_on === 'finalize'` check, and `DocGenerator.generate()` runs as it already does today. Two source-line changes. See [research-schema-default.md](./research-schema-default.md).
2. **Finalizer special-case** (rejected) — leave the schema as-is, special-case changelog inside `Finalizer.finalize()` so it always regenerates regardless of config. Privileges one doc type over the other three, still violates the original spec for architecture/api/getting-started, gives users no way to opt out, and duplicates schema defaults as a TypeScript literal (constitution off-limits). See [research-finalizer-special-case.md](./research-finalizer-special-case.md).
3. **Warning only** (rejected) — emit a yellow stderr warning when `docs:` is absent, and otherwise change nothing. Does not actually fix the user's bug, still violates the original spec, adds permanent noise, and enshrines the silent-skip as a documented feature. See [research-warning-only.md](./research-warning-only.md).

## Rationale

The schema-default approach is the only one of the three that actually delivers the user's expectation (`docs/changelog.md` refreshes on finalize) AND closes the spec violation recorded in `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241` AND keeps semantics uniform across all four doc types.

Key supporting evidence gathered from the codebase:

- **Single call site for `config.docs`** — `rg "config\.docs" src/` returns exactly one hit, `src/finalize/finalizer.ts:128`. No other consumer relies on the optional shape, so narrowing the type from `DocsConfig | undefined` to `DocsConfig` is safe.
- **`DocsConfigSchema` already has the right defaults baked in** — `src/schemas/project-config.ts:33-37` declares `output: './docs'`, `generate_on: 'finalize'`, and `types: ['architecture', 'api', 'changelog', 'getting-started']` as inner field defaults. The fix only needs to lift those into a top-level default; no new defaults are introduced.
- **`DocGenerator.generate()` already does the right thing** — `src/docs/doc-generator.ts:205` (`generateChangelog`) walks `spec/archive/*/summary.md` and rewrites `docs/changelog.md` correctly. The bug is purely in the gating; once gating passes, generation works.
- **`Finalizer` already swallows doc-generation errors** — the existing `try { ... } catch { /* ignored */ }` discipline (`src/finalize/finalizer.ts:121-135`) means tightening the guard cannot accidentally turn a doc-generation glitch into a finalize blocker.

## Diff scope

- `src/schemas/project-config.ts:77` — replace `.optional()` with `.default({})` on the `docs` field. Single-line change.
- `src/finalize/finalizer.ts:128` — remove the `docsConfig &&` left operand of the truthy guard. Single-expression change.
- New unit test in the schema test suite asserting `ProjectConfigSchema.parse({}).docs` deep-equals the inner defaults.
- New finalizer integration test asserting that an absent `docs:` block produces `docs/changelog.md` after finalize, and that an explicit `generate_on: manual` does not.

## Behavioral change to surface in the change summary

Projects whose `.metta/config.yaml` previously omitted the `docs:` block will now produce `docs/changelog.md`, `docs/architecture.md`, `docs/api.md`, and `docs/getting-started.md` on the next finalize. This is the original spec'd behavior. Users who want to suppress doc generation must explicitly set `docs.generate_on: manual`.

## Artifacts Produced

- [Research: schema default approach](./research-schema-default.md)
- [Research: finalizer special-case approach](./research-finalizer-special-case.md)
- [Research: warning-only approach](./research-warning-only.md)
