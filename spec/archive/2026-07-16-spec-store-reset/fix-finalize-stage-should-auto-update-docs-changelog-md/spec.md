# fix-finalize-stage-should-auto-update-docs-changelog-md

## Requirement: Default `docs` block in `ProjectConfigSchema`

When `.metta/config.yaml` does not declare a top-level `docs` key, the parsed `ProjectConfig.docs` MUST resolve to a fully-populated `DocsConfig` object whose fields equal the inner-schema defaults: `output: './docs'`, `generate_on: 'finalize'`, `types: ['architecture', 'api', 'changelog', 'getting-started']`. The schema MUST achieve this by declaring `docs: DocsConfigSchema.default({})` (or an equivalent default expression that yields the same shape) at `src/schemas/project-config.ts:77`. The schema MUST NOT declare `docs` as `.optional()`. Existing inner field defaults inside `DocsConfigSchema` MUST remain unchanged.

### Scenario: empty config object yields populated docs defaults
- GIVEN a Zod parse call `ProjectConfigSchema.parse({})`
- WHEN the parser completes without error
- THEN the returned object has `docs.output === './docs'`, `docs.generate_on === 'finalize'`, and `docs.types` deep-equal to `['architecture', 'api', 'changelog', 'getting-started']`

### Scenario: config with only `project` block yields populated docs defaults
- GIVEN a Zod parse call `ProjectConfigSchema.parse({ project: { name: 'x' } })`
- WHEN the parser completes without error
- THEN the returned object's `docs` is deep-equal to `{ output: './docs', generate_on: 'finalize', types: ['architecture', 'api', 'changelog', 'getting-started'] }`

### Scenario: explicit partial `docs` block keeps overrides and fills missing fields
- GIVEN a Zod parse call `ProjectConfigSchema.parse({ docs: { output: './website' } })`
- WHEN the parser completes without error
- THEN `docs.output === './website'`, `docs.generate_on === 'finalize'`, and `docs.types` deep-equal to `['architecture', 'api', 'changelog', 'getting-started']`

### Scenario: explicit `generate_on: manual` is preserved
- GIVEN a Zod parse call `ProjectConfigSchema.parse({ docs: { generate_on: 'manual' } })`
- WHEN the parser completes without error
- THEN `docs.generate_on === 'manual'` and `docs.output === './docs'` (default)


## Requirement: Finalizer doc-generation guard

`Finalizer.finalize()` in `src/finalize/finalizer.ts` MUST gate doc generation on the `docs.generate_on` field alone, because after the schema change `docs` is always a populated object. Specifically, the conditional at the equivalent of `src/finalize/finalizer.ts:128` MUST read `if (docsConfig.generate_on === 'finalize')` (single equality check, no truthy left operand). The finalizer MUST continue to swallow `DocGenerator.generate()` failures so that doc generation cannot block archive/spec-merge — the existing `try { ... } catch { /* ignored */ }` discipline is preserved. The finalizer MUST continue to populate `result.docsGenerated` from the `DocGenerator` return value when generation runs, and MUST set `result.docsGenerated` to `[]` when generation is skipped.

### Scenario: finalize regenerates docs when config has no `docs:` block
- GIVEN a temp project whose `.metta/config.yaml` has no `docs:` key, an active change with all artifacts present, and `spec/archive/` containing at least one prior archived change
- WHEN `Finalizer.finalize(changeName)` runs to completion
- THEN `docs/changelog.md` exists at the project root and its contents reflect the just-archived change as the top entry
- AND the returned `result.docsGenerated` is a non-empty array including `'changelog'`

### Scenario: finalize skips doc generation when `generate_on: manual`
- GIVEN a temp project whose `.metta/config.yaml` declares `docs:\n  generate_on: manual`, an active change with all artifacts present, and a pre-existing `docs/changelog.md` with known sentinel content `# manual-changelog`
- WHEN `Finalizer.finalize(changeName)` runs to completion
- THEN `docs/changelog.md` still has its sentinel content unchanged
- AND the returned `result.docsGenerated` equals `[]`

### Scenario: finalize swallows doc-generation errors
- GIVEN a temp project whose `.metta/config.yaml` resolves to `docs.generate_on === 'finalize'`, but where `DocGenerator.generate()` is forced to throw
- WHEN `Finalizer.finalize(changeName)` runs
- THEN the call returns a result with `docsGenerated === []` and does not propagate the error
- AND `result.archiveName` is set, indicating archive succeeded


## Requirement: Original docs-generate spec compliance

The change MUST close the spec violation recorded in `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241`, which states that an absent `docs:` block MUST default to `generate_on: finalize` and produce changelog/architecture/api/getting-started output. After this change, parsing a config without a `docs:` block MUST satisfy that requirement at the schema layer without requiring any additional logic in `Finalizer` or `DocGenerator`.

### Scenario: absent docs block produces all four doc types on finalize
- GIVEN a temp project whose `.metta/config.yaml` has no `docs:` key
- WHEN finalize runs against an active change
- THEN `docs/changelog.md`, `docs/architecture.md`, `docs/api.md`, and `docs/getting-started.md` all exist at the project root after finalize completes
- AND the returned `result.docsGenerated` contains `'changelog'`, `'architecture'`, `'api'`, and `'getting-started'`


## Requirement: No changes to `DocGenerator`, `DocsConfigSchema` inner defaults, or finalizer flow ordering

The fix MUST be confined to (a) the single line at `src/schemas/project-config.ts:77` and (b) the conditional expression in `src/finalize/finalizer.ts` Step 4. No other source files MUST be modified except for new/updated test files. In particular, `src/docs/doc-generator.ts` (including `generateChangelog`), the inner `DocsConfigSchema` field defaults at `src/schemas/project-config.ts:33-37`, and the surrounding finalize step ordering (Steps 1-5 in `Finalizer.finalize`) MUST remain byte-identical aside from the single guard expression change.

### Scenario: scope discipline — only two source files changed
- GIVEN the diff produced by this change
- WHEN inspected for files under `src/`
- THEN exactly two source files are modified: `src/schemas/project-config.ts` and `src/finalize/finalizer.ts`
- AND the modification to `src/schemas/project-config.ts` is a single line replacing `.optional()` with `.default({})` on the `docs` field
- AND the modification to `src/finalize/finalizer.ts` is a single guard expression (removing the `docsConfig &&` left operand)
