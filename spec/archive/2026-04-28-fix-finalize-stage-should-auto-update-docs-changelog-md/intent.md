# fix-finalize-stage-should-auto-update-docs-changelog-md

## Problem

`metta finalize` does not automatically refresh `docs/changelog.md` when a change is archived. Users running finalize on a stock-initialized project see the changelog left stale, even though `Finalizer.finalize()` already calls `DocGenerator.generate()` and `DocGenerator` already implements `generateChangelog()` (which walks `spec/archive/*/summary.md` in reverse-chrono order and rewrites `docs/changelog.md`).

The silent skip happens because doc generation is gated behind `if (docsConfig && docsConfig.generate_on === 'finalize')` in `src/finalize/finalizer.ts:128`, and the project-config Zod schema declares `docs: DocsConfigSchema.optional()` at `src/schemas/project-config.ts:77`. When `.metta/config.yaml` does not contain a `docs:` block — which is the default state of a freshly-initialized metta project — `config.docs` resolves to `undefined`, the guard short-circuits, and the changelog is never touched.

Two parties are affected:

1. **End users adopting metta** — they run `metta finalize`, the change archives, but `docs/changelog.md` is stale. They either notice manually and patch by hand, or downstream readers see a changelog that disagrees with `spec/archive/`.
2. **The metta project itself** — its own `.metta/config.yaml` has no `docs:` block, so its own changelog is currently subject to the same drift on every finalize.

This is also a spec violation: `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241` records that an absent `docs` block MUST default to `generate_on: finalize` and produce changelog/architecture/api/getting-started output. The current `.optional()` declaration plus the truthy guard contradicts that requirement.

## Proposal

Make changelog (and the rest of `DocGenerator`) regenerate automatically on `metta finalize` whenever the user has not explicitly opted out, by defaulting the entire `docs` block in the Zod schema:

1. **Schema change** — in `src/schemas/project-config.ts`, change the top-level `docs` field from `DocsConfigSchema.optional()` to `DocsConfigSchema.default({})` (or an equivalent `.default(...)` that resolves to the schema's built-in defaults: `output: ./docs`, `generate_on: finalize`, all four types enabled).
2. **Finalizer guard simplification** — in `src/finalize/finalizer.ts`, drop the `docsConfig &&` truthy check from the `if (docsConfig && docsConfig.generate_on === 'finalize')` condition, because the schema now guarantees `docsConfig` is always populated. The remaining check is a single equality on `generate_on`.
3. **Tests** — add a unit test asserting that `ProjectConfigSchema.parse({})` yields a populated `docs` object with `generate_on: 'finalize'`, and a finalizer integration test asserting that running `finalize` against a project whose `.metta/config.yaml` has no `docs:` block produces an updated `docs/changelog.md` in the project root.
4. **Opt-out documentation** — add a one-line note in the relevant getting-started doc clarifying that users who want to disable changelog regeneration on finalize should set `docs.generate_on: manual` in `.metta/config.yaml`. (Doc-only line; only update the file if it already exists in this repo — otherwise this becomes part of the architectural surface, not new documentation.)

The fix corresponds to **Candidate Solution 1** in the original issue. It is preferred over Solution 2 ("always run changelog regardless of config") because it preserves uniform semantics across all four doc types — `architecture.md`, `api.md`, `changelog.md`, `getting-started.md` all behave the same under `docs.generate_on`. It is preferred over Solution 3 ("emit a warning") because warnings do not deliver the requested behavior; the user expects the changelog to update, not a hint about how to make it update.

## Impact

**Behavioral changes**

- Any project whose `.metta/config.yaml` does not contain a `docs:` key will, after this change, regenerate `docs/changelog.md`, `docs/architecture.md`, `docs/api.md`, and `docs/getting-started.md` on every `metta finalize`. Previously these projects saw zero doc generation.
- This is the original spec'd behavior (per `spec/archive/2026-04-06-metta-docs-generate-auto-gener/spec.md:241`), so it is a bug fix, not a feature addition.
- Projects that explicitly set `docs.generate_on: manual` are unaffected — the equality check still excludes them.
- Projects that explicitly set a `docs:` block with custom output paths or type filters are unaffected — the explicit values take precedence over schema defaults.

**Code changes (small surface)**

- `src/schemas/project-config.ts` — one line: change `.optional()` to `.default({})`.
- `src/finalize/finalizer.ts` — one expression: remove the `docsConfig &&` left operand of the guard.
- Unit tests for the schema default and the finalizer integration path.

**Files outside scope**

- `DocGenerator` itself (`src/docs/doc-generator.ts`) is not modified — `generateChangelog()` already does the right thing once invoked.
- The `docs:` block sub-schema (`DocsConfigSchema`) is not modified — its internal defaults are already correct.
- `.metta/config.yaml` files in user projects do not need to be touched. Migration is a no-op for them.

**Risks**

- One-time changelog churn on the first finalize after upgrade for any project that previously suppressed doc generation by omission. This is the desired behavior, but should be called out in the change summary so users are not surprised by a `docs/changelog.md` diff appearing on next finalize.
- No risk to the `git.enabled` toggle — doc generation runs before any commit and respects the existing finalizer flow.

## Out of Scope

- **Restructuring `DocGenerator`** — the existing `generateChangelog`, `generateArchitecture`, `generateApi`, `generateGettingStarted` paths stay as-is. Bugs in those functions, if any, are separate issues.
- **Adding new doc types** — only the existing four types are affected.
- **Supporting per-type generate_on overrides** — the spec uses a single top-level `generate_on` for all types and we are not introducing per-type granularity here.
- **Auto-pushing the regenerated docs** — no change to push behavior; the existing finalize flow either commits locally or leaves files staged depending on `git.enabled`.
- **Migrating the metta project's own `.metta/config.yaml`** to add an explicit `docs:` block — the schema default makes that unnecessary, and adding it would dilute the test that proves absent-block behavior works.
- **Backfilling changelog entries from pre-existing archived changes** — the existing `generateChangelog()` already walks `spec/archive/*/summary.md`; whatever it produces on the first run after this fix is what the project gets. No retroactive editing.
- **Changing the user-facing CLI surface** — no new flags, no `metta docs` subcommand. The fix is purely in the schema/finalizer path.
