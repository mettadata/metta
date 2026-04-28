# Research: finalizer-side special-case approach

## Approach

Leave `ProjectConfigSchema` unchanged (`docs` stays `.optional()`). Inside `Finalizer.finalize()` Step 4, special-case the changelog so it always regenerates on archive regardless of `docs` config, while leaving the other three doc types (architecture, api, getting-started) gated by config.

Concretely, modify `src/finalize/finalizer.ts:119-136`:
1. Remove the `docsConfig &&` guard around the existing `DocGenerator.generate()` call.
2. If `docsConfig` is undefined, synthesize a minimal config object `{ output: './docs', generate_on: 'finalize', types: ['changelog'] }` and pass it to `DocGenerator`.
3. Otherwise pass the user's `docsConfig` through, which already gates the other doc types appropriately.

## Why this is tempting but worse

Solves the immediate user complaint ("changelog isn't refreshing") while preserving backward compatibility for users who omitted `docs:` and don't want architecture/api/getting-started regenerated. Lower behavioral blast radius.

## Why this is the wrong choice

1. **Splits doc-generation semantics across types**. Today, `architecture`, `api`, `changelog`, `getting-started` are siblings under `DocGenerator` and `DocsConfig.types`. With this approach, `changelog` becomes privileged: it ignores user config, while the other three honor it. Documentation, mental models, and bug reports all get harder. Future maintainers will trip over the asymmetry.

2. **Still violates the original spec**. The 2026-04-06 docs-generate spec at `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241` says all four types MUST default to `generate_on: finalize` when the block is absent. Special-casing only changelog leaves architecture/api/getting-started broken on absent-block projects, so we are still spec-violating just less obviously.

3. **Awkward opt-out**. A user who explicitly sets `docs.generate_on: 'manual'` to suppress doc generation would still see changelog regeneration (because the special case fires regardless of config). They have no way to opt out short of patching the source.

4. **Introduces a hidden config-shape duplication**. The synthesized `{ output: './docs', generate_on: 'finalize', types: ['changelog'] }` literal duplicates values already present in `DocsConfigSchema` defaults. If those defaults change (e.g. `output` becomes `./documentation`), the finalizer's literal silently drifts. This is the exact "string literal templates in TypeScript code" anti-pattern called out in the constitution's off-limits list.

5. **Harder to test**. Two code paths now need test coverage: the absent-config-changelog-only path and the explicit-config-all-types path. The schema-default approach tests one consolidated path.

## When this approach would be right

Only if there were strong evidence that some users deliberately rely on the absent-block path to suppress all doc generation. There is no such evidence — the behavior is undocumented (it's a silent skip), the original spec says it should not behave this way, and there is only a single call site (`src/finalize/finalizer.ts:128`) that reads the optional shape.

## Recommendation

Reject. The schema-default approach is semantically cleaner, smaller in diff, spec-compliant, and avoids the maintainer surprise of a privileged doc type.
