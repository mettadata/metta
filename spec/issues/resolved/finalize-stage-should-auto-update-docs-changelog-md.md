# finalize stage should auto-update docs/changelog.md

**Captured**: 2026-04-28
**Status**: logged
**Severity**: minor

## Symptom

User reports that `metta finalize` does not automatically update `docs/changelog.md`. They expect the finalize stage to refresh the changelog when a change is archived, but observe it is being left stale.

## Root Cause Analysis

`metta finalize` already has the machinery to auto-generate `docs/changelog.md` — `Finalizer.finalize()` calls `DocGenerator.generate()` (which includes a `generateChangelog()` path that walks `spec/archive/*/summary.md` and rewrites `docs/changelog.md` in reverse-chrono order). However, generation is gated behind two conditions in the finalizer: (1) the `.metta/config.yaml` MUST have a `docs:` key, AND (2) that key MUST set `generate_on: finalize`. The Zod schema makes `docs` `.optional()` at the top level, so when the key is omitted the loaded `config.docs` is `undefined`, the guard `if (docsConfig && docsConfig.generate_on === finalize)` short-circuits, and doc generation (including the changelog) is skipped silently. The current project's own `.metta/config.yaml` has no `docs:` block, which is exactly why the user is seeing no changelog update on finalize.

The fix is to make changelog regeneration the default behavior of finalize — either by defaulting the entire `docs` block (so `generate_on: finalize` applies when the key is absent) or by always running `generateChangelog()` from the finalizer regardless of the wider docs config. The intent recorded in the original docs-generate spec (`spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241`) actually says the absent case MUST apply the default and generate — so the finalizer's current `docsConfig &&` guard is also a spec violation.

### Evidence

- `src/finalize/finalizer.ts:128` — `if (docsConfig && docsConfig.generate_on === finalize)` requires a present docs key, so an absent `docs:` block silently skips all doc generation including the changelog.
- `src/schemas/project-config.ts:77` — `docs: DocsConfigSchema.optional()` makes the entire docs block optional with no top-level default, so absent configs resolve to `undefined` rather than the schema-internal defaults.
- `src/docs/doc-generator.ts:205` (`generateChangelog`) — the changelog generator already exists, reads `spec/archive/*/summary.md`, and rewrites `docs/changelog.md` correctly; it just isn't being invoked under the current finalize guard.

## Candidate Solutions

1. **Default the `docs` block in `ProjectConfigSchema`** — change `docs: DocsConfigSchema.optional()` to `docs: DocsConfigSchema.default({})` (or equivalent) so an omitted `docs:` key resolves to the schema's built-in defaults (`output: ./docs`, `generate_on: finalize`, all four types). The finalizer's guard then becomes `if (docsConfig.generate_on === finalize)` and changelog regeneration happens automatically for every project. Tradeoff: this is a behavior change for any existing project that explicitly relied on the absent-key path to disable doc generation; they would need to set `generate_on: manual` to opt out. Aligns with the original spec's intent (archive summary REQ states absent config MUST default to finalize).

2. **Always run changelog generation in the finalizer, independent of `docs` config** — special-case the changelog inside `Finalizer.finalize()` so it regenerates on every archive regardless of `docs.generate_on`, while leaving architecture/api/getting-started gated by config. Tradeoff: the changelog becomes a privileged doc with different semantics from the other three, which is surprising and harder to document; users who explicitly set `generate_on: manual` would still see changelog churn on finalize.

3. **Emit a one-time warning during `finalize` when `docs:` is absent** — keep current behavior but log a yellow warning ("docs/changelog.md will not be regenerated; add `docs:` block to `.metta/config.yaml` to enable") so the silent skip is at least visible. Tradeoff: doesn't actually fix the user's reported expectation; just makes the gap discoverable. Low blast radius but does not deliver the requested feature.

