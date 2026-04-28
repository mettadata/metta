# Design: fix-finalize-stage-should-auto-update-docs-changelog-md

## Approach

Two narrow source-line edits, plus matching tests, restore the original spec'd behavior in which an absent `docs:` block in `.metta/config.yaml` defaults to `generate_on: finalize` and produces all four doc types (`architecture`, `api`, `changelog`, `getting-started`) on every `metta finalize`.

The edits are:

1. **Schema**: in `src/schemas/project-config.ts:77`, replace `docs: DocsConfigSchema.optional()` with `docs: DocsConfigSchema.default({})`. Zod resolves the missing top-level field to `{}` and then the inner schema fills `output`, `generate_on`, and `types` from their existing inner `.default(...)` declarations at `src/schemas/project-config.ts:33-37`. After this change, `ProjectConfig.docs` is statically typed as `DocsConfig` (no `| undefined`).

2. **Finalizer guard**: in `src/finalize/finalizer.ts:128`, drop the `docsConfig &&` left operand so the guard reads `if (docsConfig.generate_on === 'finalize')`. The surrounding `try { ... } catch { /* ignored */ }` discipline at `src/finalize/finalizer.ts:121-135` is preserved exactly so doc-generation errors continue to be swallowed and never block archive or spec-merge.

`DocGenerator` itself is not modified. `DocsConfigSchema`'s inner field defaults are not modified. Step ordering inside `Finalizer.finalize()` (Steps 1-5) is not modified. The only diff inside `src/` outside the two edits above is the corresponding test additions described below.

## Components

| Component | Path | Role in this change |
|---|---|---|
| `ProjectConfigSchema` | `src/schemas/project-config.ts` | Define `docs: DocsConfigSchema.default({})` at line 77. Sole structural change in the schema layer. |
| `DocsConfigSchema` | `src/schemas/project-config.ts:33-37` | Unchanged. Its existing inner field defaults supply the values that `.default({})` triggers Zod to populate. |
| `Finalizer.finalize` | `src/finalize/finalizer.ts:31-150` | Adjust one expression at line 128 to drop the redundant truthy check. No flow changes. |
| `DocGenerator` | `src/docs/doc-generator.ts` | Unchanged. `generate()`, `generateChangelog()`, `generateArchitecture()`, `generateApi()`, `generateGettingStarted()` continue to behave exactly as today; they are simply invoked under more configurations. |
| `ConfigLoader` | `src/config/config-loader.ts` | Unchanged. The schema change propagates through its existing `parse(rawConfig)` call. |
| `tests/schemas.test.ts` | existing | New describe-level cases assert that `ProjectConfigSchema.parse({}).docs` equals the inner defaults, that explicit partial `docs: { output: './website' }` resolves missing fields to defaults, and that `docs.generate_on: 'manual'` is preserved. |
| `tests/finalizer.test.ts` | existing | New cases assert: (a) absent-docs project produces `docs/changelog.md` after finalize; (b) explicit `generate_on: 'manual'` leaves `docs/changelog.md` untouched; (c) `DocGenerator.generate()` errors do not propagate. |

## Data Model

No schema fields are added or removed. The only data-model impact is a type narrowing: `ProjectConfig['docs']` changes from `DocsConfig | undefined` to `DocsConfig`. The TypeScript type emitted by `z.infer<typeof ProjectConfigSchema>` updates automatically.

Default-resolution table (the values applied when `.metta/config.yaml` does not declare `docs:`):

| Field | Resolved default | Source |
|---|---|---|
| `docs.output` | `'./docs'` | inner default at `src/schemas/project-config.ts:34` |
| `docs.generate_on` | `'finalize'` | inner default at `src/schemas/project-config.ts:35` |
| `docs.types` | `['architecture', 'api', 'changelog', 'getting-started']` | inner default at `src/schemas/project-config.ts:36` |

`.metta/config.yaml` itself is not rewritten by this change. The defaults apply purely at parse time.

## API Design

No public API surface changes. No new CLI flags. No new exports from the `src/` barrel.

The single internal type narrowing affects only `src/finalize/finalizer.ts`, the only call site that reads `config.docs` (verified by `rg "config\.docs" src/`).

## Dependencies

External:
- `zod` — already a project dependency. No version change. The `.default({})` form on a nested object is standard Zod 3.x; no new APIs are required.

Internal:
- `src/finalize/finalizer.ts` depends on `ProjectConfig.docs`. After this change it depends on `DocsConfig` (non-optional). No new imports.

Test additions:
- `tests/schemas.test.ts` already imports `ProjectConfigSchema`; new cases reuse existing imports.
- `tests/finalizer.test.ts` already wires `Finalizer`, `ArtifactStore`, `SpecLockManager`. New cases add `mkdir`/`writeFile` of a `.metta/config.yaml` and an `archive/<prior-change>/summary.md` to drive the changelog generator. No new dependencies; existing `node:fs/promises` imports cover it.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **First-finalize churn surprises existing users.** Any project whose `.metta/config.yaml` omits `docs:` will produce four new doc files on the next finalize. | Call out the behavior change explicitly in `summary.md` for this archive (per US-4) and in the change's commit message. The original spec already mandates this behavior, so it is bug-fix semantics. Users who want to suppress can set `docs.generate_on: 'manual'`. |
| **A consumer somewhere narrows `config.docs` against `undefined` and breaks under TypeScript strict mode.** | Verified by `rg "config\.docs" src/` that the only consumer is `src/finalize/finalizer.ts:128`, which is being updated in the same change. The TypeScript narrowing actually simplifies that consumer. |
| **A test in the existing suite implicitly depends on absent-block silent-skip and starts failing.** | Run the full `npm test` suite during verify. If anything breaks, it will surface immediately. The most likely site is `tests/finalizer.test.ts` itself, where current cases never assert on `result.docsGenerated`, so they should be unaffected. |
| **`DocGenerator.generate()` accidentally writes to an unexpected path.** | Out of scope for this fix. The existing generator already resolves paths against `projectRoot` and `docsConfig.output`. The schema-default `output: './docs'` matches existing behavior for the metta repo. |
| **The schema's `.strict()` rejects the empty-object default.** | Not a real risk: `.default({})` is applied before `.strict()` parsing of inner fields, and Zod resolves it to a valid populated `DocsConfig`. The accompanying unit test (`ProjectConfigSchema.parse({}).docs` deep-equals the defaults) guards against regression. |
| **A user who explicitly sets `docs: null` (rather than omitting the key) hits a Zod parse error.** | This is correct behavior: `null` is not a valid value for an object schema. The migration story for users who want "off" is `generate_on: 'manual'`, not `docs: null`. Documenting this in the change summary suffices. |
| **Doc generation uncovered errors that were previously hidden.** | The existing `try { ... } catch { /* ignored */ }` at `src/finalize/finalizer.ts:121-135` continues to swallow `DocGenerator` errors so finalize cannot regress to a blocking failure mode. The contract from `FinalizeResult.docsGenerated: string[]` is unchanged. |
