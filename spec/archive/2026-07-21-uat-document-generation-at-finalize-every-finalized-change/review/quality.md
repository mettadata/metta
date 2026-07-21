# Quality Review: uat-document-generation-at-finalize-every-finalized-change

VERDICT: PASS_WITH_WARNINGS

Scope reviewed: `git diff 2fc869140..HEAD -- src tests` — src/finalize/uat-generator.ts (new, 541 lines),
src/finalize/finalizer.ts, src/cli/commands/finalize.ts, src/schemas/project-config.ts,
src/templates/artifacts/uat.md (new), src/index.ts, plus tests/uat-generator.test.ts,
tests/uat-template-contract.test.ts, tests/finalizer.test.ts, tests/cli-finalize.test.ts,
tests/config-loader.test.ts. All 45 new unit tests plus the 18 finalizer tests pass locally
(`npx vitest run` on the four non-subprocess files).

## Summary

Clean, convention-conformant implementation: functional core (pure helpers in uat-generator.ts) with
I/O at the edges, external template rendered via TemplateEngine (no string-literal template — enforced
by a sentinel-grep test), strict Zod config schema mirroring DocsConfigSchema, kebab-case filenames,
`.js` import extensions throughout, barrel export added in the existing finalize group of src/index.ts.
Test quality is above the repo baseline (byte-identical determinism check, negative annotation guards,
error-JSON shape locked via sorted key equality). No critical or major issues; findings below are
minor maintainability items and test-hygiene suggestions.

## Findings

### Critical

None.

### Major

None.

### Minor

1. **src/finalize/uat-generator.ts:481** — ENOENT detection for `stories.md` relies on a brittle
   string match against the parser's own error message: `err.message.includes('not found')`. If
   `StoriesParseError`'s wording in src/specs/stories-parser.ts:142 (`stories.md not found at ...`)
   ever changes, every quick-tier change with no stories.md would silently start emitting a spurious
   "stories.md failed to parse" warning into its Generation notes instead of demoting silently.
   `StoriesParseError` carries `field`/`storyId` but no machine-checkable code.
   *Suggested fix:* add a `code: 'ENOENT'` (or similar) discriminant to `StoriesParseError`, or
   probe file existence (readOptional-style) before calling `parseStories`.

2. **src/finalize/finalizer.ts:168** — `let configLoader: import('../config/config-loader.js').ConfigLoader | undefined`
   uses an inline dynamic-import type annotation. A top-level
   `import type { ConfigLoader } from '../config/config-loader.js'` is erased at compile time, keeps
   the runtime lazy-import intact, and matches the repo's import style elsewhere.
   *Suggested fix:* hoist to `import type` at the top of the file.

3. **tests/cli-finalize.test.ts:88-118** — `markAllArtifactsComplete` and `stubAllGatesPassing` are
   verbatim duplicates of the same helpers in tests/cli-complete.test.ts (~lines 1100-1133),
   including the identical five-gate name list and YAML body. A `tests/helpers/` directory already
   exists (cli.ts). Third copy-paste of fixture logic invites drift when the standard workflow's
   gate list changes.
   *Suggested fix:* extract both helpers into tests/helpers (e.g. `tests/helpers/finalize-fixtures.ts`).

4. **tests/cli-finalize.test.ts:180-215 with src/finalize/finalizer.ts:190-191** — the degraded-path
   CLI test injects failure by squatting a *directory* at `spec/changes/<name>/UAT.md`. The
   finalizer's best-effort cleanup `rm(path, { force: true })` is non-recursive, so it silently fails
   on that directory, and the empty `UAT.md/` directory is swept into the archive by the move. The
   test asserts `uatPath: null` and `uatWarning` but never asserts the archive contains no `UAT.md`
   entry — so the "no UAT.md is present in the archive" property from the degradation requirement is
   unverified (and technically violated) in this synthetic scenario. Real degradation paths leave a
   file (removed correctly) or nothing, so impact is test-only today.
   *Suggested fix:* assert archive contents in the CLI degraded test, and/or use
   `rm(..., { recursive: true, force: true })` in the cleanup.

### Suggestions

5. **src/finalize/uat-generator.ts:156** — `new RegExp(`\\b${storyId}\\b`)` interpolates the story id
   without regex-escaping. Safe today because the story schema enforces `/^US-\d+$/`
   (src/schemas/story.ts:14), but that invariant lives two files away. A one-line comment noting the
   schema guarantee (or a trivial escape) would prevent a future refactor of id formats from
   introducing a regex-injection footgun.

6. **tests/uat-generator.test.ts:479-485** — the no-AI guard asserts `/anthropic/i` never appears in
   the generator's source text. This is a weak proxy for "no provider client constructed" and will
   false-positive on an innocuous comment mentioning Anthropic. Consider asserting on import
   specifiers only (e.g. match `from '...` lines) or checking the resolved module graph.

7. **src/finalize/finalizer.ts:31 vs src/cli/commands/finalize.ts:147** — the internal field is
   `uatError` but it surfaces as `uatWarning` in JSON. The rename at the boundary is deliberate
   (spec mandates a warning field in the success payload) and both sides are documented, but a
   shared name would remove one mental translation. Cosmetic only.

## Checks performed (no findings)

- **Duplication vs src/util/**: `norm()` in uat-generator.ts:58 is a text-similarity normalizer
  (unicode-aware, space-preserving, backtick/bold stripping) — semantically distinct from
  `toSlug`/`toSlugUntruncated` in src/util/slug.ts (ASCII hyphen slugs). Not a duplicate; no other
  normalize helper exists in src/util/.
- **Dead code / unused exports**: none. All exports of uat-generator.ts (`generateUat`,
  `UatGeneratorInput`, `UatGeneratorResult`, `UatTier`) are consumed by finalizer/tests or are
  legitimate public API surfaced through the barrel. All mdast type imports are used.
- **Barrel export placement**: src/index.ts:23 adds `./finalize/uat-generator.js` adjacent to the
  other three `./finalize/*` exports — follows the existing grouping.
- **Naming**: `uatPath`/`uatWarning` camelCase matches the existing success-payload keys
  (`status`, `change`, `archive`, `gates`, `merged`); spec explicitly mandates `uatPath`.
- **Heading depth of `## Additional scenarios`** (uat-generator.ts:342) amid `###` story groups:
  matches design.md lines 262/332 exactly — intentional, not an inconsistency.
- **Date handling**: `generatedAt` injected by the caller (finalizer.ts:179) using the same
  UTC `toISOString().slice(0, 10)` idiom as `ArtifactStore.archive` (artifact-store.ts:109) —
  archive-name date and UAT header date cannot diverge; generator provably never reads the clock.
- **Template externality**: uat.md ships via the existing `copy-templates` glob
  (`cp -r src/templates/artifacts` in package.json:18) with no build-script change; sentinel-grep
  test (uat-template-contract.test.ts:58-70) enforces no string-literal copy in src.
- **Guard against empty `story.acceptanceCriteria[0]` access** (uat-generator.ts:303): safe —
  schema enforces `.min(1)` on acceptanceCriteria (src/schemas/story.ts:21).
- **Test-to-source ratio**: new source file has a dedicated 486-line test file plus a template
  contract file; finalizer and CLI changes covered in their existing test files. Ratio maintained.
- **`new URL(...).pathname` for template dir** (uat-generator.ts:532): POSIX-only, but identical to
  the pre-existing pattern in cli/commands/finalize.ts:36,41 — consistent, not new debt.
