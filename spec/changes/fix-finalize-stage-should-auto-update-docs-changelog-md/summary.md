# fix-finalize-stage-should-auto-update-docs-changelog-md

`metta finalize` now refreshes `docs/changelog.md` (along with `docs/architecture.md`, `docs/api.md`, and `docs/getting-started.md`) on every archive, even when `.metta/config.yaml` does not declare a `docs:` block. The previous silent skip — caused by `docs: DocsConfigSchema.optional()` in `src/schemas/project-config.ts` resolving to `undefined` and short-circuiting the truthy guard at `src/finalize/finalizer.ts:128` — is fixed by defaulting the entire `docs` block at the schema layer, so that absent-block configs resolve to the inner-schema defaults (`output: './docs'`, `generate_on: 'finalize'`, all four doc types). The finalizer guard is correspondingly simplified to a single equality check on `docs.generate_on`. This restores the behavior originally specified in `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241`.

## Changes

- `src/schemas/project-config.ts:77` — `docs: DocsConfigSchema.optional()` → `docs: DocsConfigSchema.default({})`. Makes `ProjectConfig.docs` always a populated `DocsConfig` object.
- `src/finalize/finalizer.ts:128` — drop the redundant `docsConfig &&` left operand; guard now reads `if (docsConfig.generate_on === 'finalize') {`.
- `tests/schemas.test.ts` — four new cases under `describe('ProjectConfigSchema', ...)` proving `parse({}).docs`, partial-override fill-in, explicit `manual` preservation, and project-only-block default behavior.
- `tests/finalizer.test.ts` — four new cases under a new `describe('doc generation gating', ...)` block: spy-verified DocGenerator invocation when `docs:` is absent; spy-verified skip when `generate_on: manual`; error swallowing on synthetic DocGenerator failure; and an end-to-end assertion that a real DocGenerator run produces `docs/changelog.md` containing the expected archive entry.

## Behavioral note for users on upgrade

Projects whose `.metta/config.yaml` previously omitted the `docs:` block will start producing `docs/changelog.md`, `docs/architecture.md`, `docs/api.md`, and `docs/getting-started.md` on the next finalize. This matches the original spec; the silent-skip behavior was a bug. Users who want to suppress doc generation must explicitly set:

    docs:
      generate_on: manual

in `.metta/config.yaml`. No other migration is required.

## Verification

- `npx tsc --noEmit` — clean
- `npm run lint` — clean (alias for `tsc --noEmit`)
- `npm test` — 935 / 935 tests pass across 68 files
- New cases targeted: 4 in `tests/schemas.test.ts`, 4 in `tests/finalizer.test.ts`
