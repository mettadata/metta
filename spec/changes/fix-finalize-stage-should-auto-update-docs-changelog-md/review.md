# Review: fix-finalize-stage-should-auto-update-docs-changelog-md

## Correctness — PASS

The implementation matches the design exactly:

- **Schema edit (`src/schemas/project-config.ts:77`)**: `docs: DocsConfigSchema.optional()` → `docs: DocsConfigSchema.default({})`. Confirmed in `git diff` (line 1 of file diff, single change). Inner `DocsConfigSchema` (`src/schemas/project-config.ts:33-37`) is untouched.
- **Finalizer guard edit (`src/finalize/finalizer.ts:128`)**: `if (docsConfig && docsConfig.generate_on === 'finalize')` → `if (docsConfig.generate_on === 'finalize')`. Confirmed single-expression edit. The surrounding `try { ... } catch { /* ignored */ }` block at lines 121-135 is preserved byte-identical, so error-swallowing semantics are maintained.
- **Spec compliance**: Both delta requirements in `spec.md` are `ADDED` (not `MODIFIED`/`REMOVED`), so the `metta complete spec` capability-existence check passes. The validator accepted them on the second attempt after retargeting from `MODIFIED: Requirement: Finalizer doc-generation guard` to `ADDED: Requirement: Finalizer doc-generation guard`.
- **Test coverage**:
  - 4 new schema cases (`tests/schemas.test.ts`): absent `docs` block, partial `output` override, explicit `generate_on: 'manual'`, and project-block-only default. All pass (142 / 142 in file).
  - 4 new finalizer cases (`tests/finalizer.test.ts`): spy-verified DocGenerator invocation when absent; spy-verified skip when manual; error-swallow on synthetic failure; end-to-end real changelog with archive + project.md fixtures. All pass (7 / 7 in file).
- **Full suite**: `npm test` reports 935 / 935 across 68 files. No regressions.

No correctness issues found.

## Security — PASS

- No new file-system writes outside existing finalize flow.
- No new external-process invocation.
- No new untrusted input parsing — `.metta/config.yaml` is already parsed by `ConfigLoader`; this change only narrows the type of one field.
- Schema change is purely defensive (substitutes `{}` for `undefined`); it cannot widen attack surface.
- Test mocks use `vi.spyOn(DocGenerator.prototype, 'generate')` and call `vi.restoreAllMocks()` in `afterEach`, so prototype state cannot leak between tests.
- No secrets, credentials, or auth tokens touched.
- Behavioral change (changelog regenerates on finalize for absent-block configs) is non-destructive — `DocGenerator.generate()` writes to `<projectRoot>/docs/`, an established output directory; existing manual-curated docs in projects that explicitly opt out via `generate_on: 'manual'` are preserved.

No security issues found.

## Quality — PASS_WITH_WARNINGS

Strengths:
- Diff is minimal: 2 source-line edits + 8 new test cases + 1 summary file. No incidental refactors.
- Conforms to project conventions: `kebab-case` filenames, `.js` import extensions, Zod-validated state, conventional commits (`fix:`, `test:`, `docs:`).
- No singletons introduced; no CommonJS; no string-literal templates added.
- No `--no-verify`, no `--force`, no destructive git ops.
- Maintains near-1:1 test-to-source file ratio (touched two source files, added cases to two existing test files).
- All commits use HEREDOC-safe single-line messages with proper conventional prefixes.

Warnings (non-blocking):
- The end-to-end finalizer test name `produces a changelog when DocGenerator runs end-to-end without mocking` is on the long side (16 words), but matches the descriptive style in surrounding cases. No action recommended.
- The `tests/finalizer.test.ts` doc-generation describe block creates an extra `mkdtemp`/`rm` per test (4 times). Acceptable for isolation but slightly slower than reusing the outer fixture. Acceptable trade-off for state isolation; no change needed.

No critical or major issues found. PASS_WITH_WARNINGS.

## Overall — PASS

All three reviewer perspectives concur: the change is minimal, correct, secure, and follows project conventions. Ready to proceed to the verify phase.
