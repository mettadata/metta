# Research: schema default approach (`docs: DocsConfigSchema.default({})`)

## Approach

Change the top-level `docs` field in `ProjectConfigSchema` (`src/schemas/project-config.ts:77`) from `DocsConfigSchema.optional()` to `DocsConfigSchema.default({})`. After this change, `ProjectConfigSchema.parse(rawConfig)` always yields a populated `config.docs` object whose fields equal the inner-schema defaults (`output: './docs'`, `generate_on: 'finalize'`, `types: ['architecture', 'api', 'changelog', 'getting-started']`). Then drop the `docsConfig &&` truthy left operand from the finalizer guard at `src/finalize/finalizer.ts:128`.

## Why this works

Zod's `.default(value)` runs only when the input is `undefined`. A bare `.default({})` on an inner object schema causes Zod to first substitute `{}` for the missing input, then re-run the inner schema's parse — which fills every required field from its own `.default(...)`. The inner `DocsConfigSchema` already declares `output: z.string().default('./docs')`, `generate_on: z.enum([...]).default('finalize')`, and `types: z.array(z.string()).default([...])`, so passing `{}` resolves to a fully populated object.

Verified by reading `src/schemas/project-config.ts:33-37`:
```
export const DocsConfigSchema = z.object({
  output: z.string().default('./docs'),
  generate_on: z.enum(['finalize', 'verify', 'manual']).default('finalize'),
  types: z.array(z.string()).default(['architecture', 'api', 'changelog', 'getting-started']),
}).strict()
```

The `.strict()` on the outer schema is unaffected — `.default({})` on a known field is allowed.

## Diff size

Two source-line changes:
1. `src/schemas/project-config.ts:77` — `docs: DocsConfigSchema.optional(),` → `docs: DocsConfigSchema.default({}),`
2. `src/finalize/finalizer.ts:128` — `if (docsConfig && docsConfig.generate_on === 'finalize') {` → `if (docsConfig.generate_on === 'finalize') {`

Plus a unit test for the schema default and an integration test for the finalizer behavior.

## Risks

- **One-time changelog churn for existing projects**: any project whose `.metta/config.yaml` previously lacked a `docs:` block will produce its first ever `docs/changelog.md` (and architecture/api/getting-started) on the next finalize. This matches the original spec at `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241`, so it is the intended behavior, but should be called out in the change summary.
- **Type ergonomics**: callers in TypeScript that destructured `config.docs` as possibly-undefined (e.g. `const docsConfig = config.docs` followed by a truthy check) will now always receive a populated value. The TypeScript type narrows from `DocsConfig | undefined` to `DocsConfig`. The only known consumer of this field that uses the truthy form is `src/finalize/finalizer.ts:128`, which we are fixing in the same change. A repo-wide grep is needed to confirm no other site relies on the optional shape.

Grep evidence:
```
$ rg "config\.docs" src/
src/finalize/finalizer.ts:126:        const docsConfig = config.docs
src/finalize/finalizer.ts:128:        if (docsConfig && docsConfig.generate_on === 'finalize') {
```
Only one call site reads `config.docs`. No other site relies on the `undefined` shape.

## Spec compliance

This approach directly satisfies the original spec requirement at `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241`, which states:

> When `.metta/config.yaml` does not contain a `docs:` block, the system MUST default to `generate_on: finalize` and MUST produce architecture, api, changelog, and getting-started outputs.

By making the schema default fill in the missing block, the finalizer now matches that requirement without any extra logic.

## Test strategy

- **Unit test in `src/schemas/__tests__/project-config.test.ts`** (or wherever the schema tests live): assert `ProjectConfigSchema.parse({}).docs` deep-equals `{ output: './docs', generate_on: 'finalize', types: ['architecture', 'api', 'changelog', 'getting-started'] }`.
- **Unit test for explicit overrides**: assert that a partial `docs: { output: './website' }` resolves the missing fields to defaults.
- **Integration test in finalizer test suite**: set up a temp project with no `docs:` block and an active change, run `Finalizer.finalize`, assert that `docs/changelog.md` exists and contains the just-archived change as its top entry. Re-run with `generate_on: 'manual'` and assert the changelog is not modified.

## Recommendation

Adopt this approach. It is the minimal, most semantically correct fix, aligns with the original spec, has predictable test coverage, and minimizes coupling between `Finalizer` and config-shape edge cases.
