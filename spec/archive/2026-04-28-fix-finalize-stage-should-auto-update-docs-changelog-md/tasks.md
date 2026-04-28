# Tasks for fix-finalize-stage-should-auto-update-docs-changelog-md

## Batch 1 (no dependencies — different files, parallel-safe)

- [x] **Task 1.1: Default the `docs` block in `ProjectConfigSchema`**
  - **Files**: `src/schemas/project-config.ts`
  - **Action**: At line 77, replace the field declaration `docs: DocsConfigSchema.optional(),` with `docs: DocsConfigSchema.default({}),`. Make no other edits to the file. Do NOT modify the inner `DocsConfigSchema` (lines 33-37) — its inner field defaults remain authoritative.
  - **Verify**: Run `npx tsc --noEmit` from the repo root. The `ProjectConfig` type derived from `z.infer<typeof ProjectConfigSchema>` now narrows `docs` to `DocsConfig` (no `| undefined`); since the only call site (`src/finalize/finalizer.ts:128`) is being updated in Task 1.2, typecheck must pass once both tasks land. For this task in isolation, typecheck may still pass because the `if (docsConfig && ...)` form still compiles against a non-optional value (the truthy check just becomes redundant).
  - **Done**: `git diff src/schemas/project-config.ts` shows exactly one line changed: `.optional()` → `.default({})` on the `docs` field. No other diff in the file.

- [x] **Task 1.2: Simplify the finalizer doc-generation guard**
  - **Files**: `src/finalize/finalizer.ts`
  - **Action**: At line 128, replace the expression `if (docsConfig && docsConfig.generate_on === 'finalize') {` with `if (docsConfig.generate_on === 'finalize') {`. Preserve the surrounding `try { ... } catch { /* ignored */ }` block (lines 121-135) byte-for-byte. Do not change any other line in the file.
  - **Verify**: `git diff src/finalize/finalizer.ts` shows exactly one expression change. Run `npx tsc --noEmit` — should pass after Task 1.1 lands.
  - **Done**: The guard reads `if (docsConfig.generate_on === 'finalize') {`. No other diff in the file. The catch block still swallows errors silently.

## Batch 2 (depends on Batch 1 — test files, parallel-safe across files)

- [x] **Task 2.1: Add `ProjectConfigSchema` default-resolution tests**
  - **Depends on**: Task 1.1
  - **Files**: `tests/schemas.test.ts`
  - **Action**: Inside the existing `describe('ProjectConfigSchema', ...)` block, add four new `it(...)` cases:
    1. `it('applies defaults for absent docs block', ...)`: parse `{}`, assert `result.docs.output === './docs'`, `result.docs.generate_on === 'finalize'`, and `result.docs.types` deep-equals `['architecture', 'api', 'changelog', 'getting-started']`.
    2. `it('fills missing docs fields when only output is set', ...)`: parse `{ docs: { output: './website' } }`, assert `result.docs.output === './website'` and the other two fields equal their defaults.
    3. `it('preserves explicit generate_on: manual', ...)`: parse `{ docs: { generate_on: 'manual' } }`, assert `result.docs.generate_on === 'manual'` and `result.docs.output === './docs'`.
    4. `it('docs default applies even when only project block is set', ...)`: parse `{ project: { name: 'x' } }`, assert `result.docs` deep-equals the populated default object.
  - **Verify**: `npx vitest run tests/schemas.test.ts` — all four new cases pass alongside the existing suite.
  - **Done**: `tests/schemas.test.ts` has four added cases, all green. No existing case is removed or weakened.

- [x] **Task 2.2: Add finalizer doc-generation integration tests**
  - **Depends on**: Task 1.2
  - **Files**: `tests/finalizer.test.ts`
  - **Action**: Add three new `it(...)` cases inside the existing `describe('Finalizer', ...)` block:
    1. `it('regenerates docs/changelog.md when config has no docs block', ...)`: instantiate `Finalizer` with a `projectRoot` pointing at a fresh temp dir; create `<projectRoot>/.metta/config.yaml` with content limited to a minimal `project: { name: 'x' }` block (NO `docs:` key); seed `<specDir>/archive/2026-01-01-prior/summary.md` with a known sentinel and matching `<specDir>/archive/2026-01-01-prior/spec.md` if `DocGenerator` requires it; create an active change and run `finalize`. Assert `<projectRoot>/docs/changelog.md` exists after finalize and contains the just-archived change name. Assert `result.docsGenerated` includes `'changelog'`.
    2. `it('skips doc generation when docs.generate_on is manual', ...)`: same setup but `<projectRoot>/.metta/config.yaml` declares `docs:\n  generate_on: manual`; pre-write a sentinel `<projectRoot>/docs/changelog.md` with content `# manual-changelog\n`. After finalize, assert the file is byte-identical to the sentinel and `result.docsGenerated` equals `[]`.
    3. `it('swallows doc-generation errors and still archives', ...)`: force a `DocGenerator` failure (e.g. by making `<projectRoot>/docs` a file rather than a directory, or stubbing `DocGenerator.prototype.generate` to throw via `vi.spyOn`); run finalize; assert no error is thrown, `result.archiveName` is non-empty, and `result.docsGenerated === []`.
  - **Verify**: `npx vitest run tests/finalizer.test.ts` — three new cases pass; all existing cases still pass.
  - **Done**: `tests/finalizer.test.ts` has three added cases, all green. The existing suite is unchanged.

## Batch 3 (depends on Batch 2 — full repo verification)

- [x] **Task 3.1: Run full quality gates**
  - **Depends on**: Task 2.1, Task 2.2
  - **Files**: (no edits — verification only)
  - **Action**: Run `npm test`, `npx tsc --noEmit`, and `npm run lint` from the repo root. Report any failures.
  - **Verify**: All three commands exit zero. No new warnings in the lint output relative to baseline.
  - **Done**: Test suite passes, type-check passes, lint passes. No source-file changes from this task.
