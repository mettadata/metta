# Tasks: centralize-slugify-utility-strip-non-ascii-truncate-at-word

## Batch 1: Add toSlug + tests (sequential — foundation for Batch 2)

### Task 1.1: Add toSlug to src/util/slug.ts and write tests [x]
- **Files:** `src/util/slug.ts`, `tests/slug.test.ts` (new)
- **Action:**
  - Append `toSlug(input, opts?)` to `src/util/slug.ts` following the API in `design.md` (API Design section). Export the function. Do not modify existing `SLUG_RE` or `assertSafeSlug`.
  - Create `tests/slug.test.ts` with vitest describe/it blocks covering:
    1. Basic lowercase + hyphenation: `toSlug('Hello World')` → `'hello-world'`
    2. Non-ASCII strip: `toSlug('Specification — card cover colors')` → `'specification-card-cover-colors'`
    3. Trim leading/trailing hyphens: `toSlug('  hello world!  ')` → `'hello-world'`
    4. Word-boundary truncation: `toSlug('a-very-long-description-that-will-be-truncated', { maxLen: 30 })` → a string whose length is ≤ 30 and which ends at a hyphen boundary (not mid-word). Assert specific expected output.
    5. Stop-words opt-in: `toSlug('add user profiles', { stopWords: new Set(['add']) })` → `'user-profiles'`; `toSlug('add user profiles')` without opts → `'add-user-profiles'`.
    6. Hard-truncate fallback: `toSlug('supercalifragilisticexpialidocious', { maxLen: 10 })` → `'supercalif'` (10 chars, no word boundary exists).
    7. Empty input throws: `toSlug('')` throws.
    8. All-non-ASCII throws: `toSlug('!!!—!!!')` throws.
    9. Result matches SLUG_RE at default maxLen: `SLUG_RE.test(toSlug('Some Long Descriptive Title'))` is `true`.
- **Verify:** `npx vitest run tests/slug.test.ts` — all 9 tests pass; `npx tsc --noEmit` exits 0.
- **Done:** toSlug exported; test file green; tsc clean.

---

## Batch 2: Replace call sites + skill template (parallel — all different files)

### Task 2.1: Replace slugify in src/artifacts/artifact-store.ts
- **Files:** `src/artifacts/artifact-store.ts`
- **Action:** Remove the local `slugify` function (lines 12-22). Import `toSlug` from `../util/slug.js`. Keep `STOP_WORDS` as a local const. Replace all callers of `slugify(x)` with `toSlug(x, { stopWords: STOP_WORDS })`.
- **Verify:** `grep -n "function slugify" src/artifacts/artifact-store.ts` returns 0; `grep -n "toSlug" src/artifacts/artifact-store.ts` returns ≥2 (import + call site); `npx vitest run tests/artifact-store.test.ts` passes (existing snapshot tests still green).
- **Done:** Local slugify removed; uses shared helper with STOP_WORDS; artifact-store tests pass.

### Task 2.2: Replace inline slugify in src/finalize/spec-merger.ts
- **Files:** `src/finalize/spec-merger.ts`
- **Action:** Replace the inline `.toLowerCase().replace(/\s+/g, '-')` at line 48 with `toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))`. Import `toSlug` from `../util/slug.js` (note: check existing import style).
- **Verify:** `grep -n "toSlug" src/finalize/spec-merger.ts` returns ≥2 (import + call); `grep -n "replace(/\\\\s+/g" src/finalize/spec-merger.ts` returns 0; `npx vitest run tests/spec-merger.test.ts` passes.
- **Done:** Capability slug derivation routes through toSlug; spec-merger tests green.

### Task 2.3: Replace inline slugify in src/cli/commands/complete.ts
- **Files:** `src/cli/commands/complete.ts`
- **Action:** Replace the inline `.toLowerCase().replace(/\s+/g, '-')` pattern at line ~119 with `toSlug(deltaSpec.title.replace(/\s*\(Delta\)\s*$/, ''))`. Import `toSlug` from `../../util/slug.js` (path adjusted from commands/ location).
- **Verify:** `grep -n "toSlug" src/cli/commands/complete.ts` returns ≥2; `grep -n "replace(/\\\\s+/g" src/cli/commands/complete.ts` returns 0; `npx tsc --noEmit` exits 0.
- **Done:** Same centralization as spec-merger; tsc clean.

### Task 2.4: Replace local slugify in src/backlog/backlog-store.ts
- **Files:** `src/backlog/backlog-store.ts`
- **Action:** Remove the local `slugify` function (lines 15-21). Import `toSlug` from `../util/slug.js` (augment existing import of `assertSafeSlug`). Replace `slugify(x)` call sites with `toSlug(x)`.
- **Verify:** `grep -n "function slugify" src/backlog/backlog-store.ts` returns 0; `grep -n "toSlug" src/backlog/backlog-store.ts` returns ≥2; `npx vitest run tests/backlog-store.test.ts` passes.
- **Done:** Uses shared helper; backlog-store tests green.

### Task 2.5: Replace local slugify in src/issues/issues-store.ts
- **Files:** `src/issues/issues-store.ts`
- **Action:** Same pattern as Task 2.4. Remove local `slugify`, import `toSlug`, replace call sites.
- **Verify:** `grep -n "function slugify" src/issues/issues-store.ts` returns 0; `grep -n "toSlug" src/issues/issues-store.ts` returns ≥2; `npx vitest run tests/issues-store.test.ts` passes.
- **Done:** Uses shared helper; issues-store tests green.

### Task 2.6: Replace local slugify in src/gaps/gaps-store.ts
- **Files:** `src/gaps/gaps-store.ts`
- **Action:** Same pattern as Task 2.4. Remove local `slugify`, import `toSlug`, replace call sites.
- **Verify:** `grep -n "function slugify" src/gaps/gaps-store.ts` returns 0; `grep -n "toSlug" src/gaps/gaps-store.ts` returns ≥2; `npx tsc --noEmit` exits 0.
- **Done:** Uses shared helper; tsc clean.

### Task 2.7: Replace slugifyId in src/specs/spec-parser.ts
- **Files:** `src/specs/spec-parser.ts`
- **Action:** Remove the local `slugifyId` function (lines 75-80). Import `toSlug` from `../util/slug.js`. Replace calls with `toSlug(x, { maxLen: Number.MAX_SAFE_INTEGER })` to preserve current untruncated behavior (required for lock-file compatibility per research.md).
- **Verify:** `grep -n "function slugifyId" src/specs/spec-parser.ts` returns 0; `grep -n "Number.MAX_SAFE_INTEGER" src/specs/spec-parser.ts` returns ≥2 (one per call site); `npx vitest run tests/spec-parser.test.ts` passes.
- **Done:** Uses shared helper with untruncated option; spec-parser tests green.

### Task 2.8: Replace inline scenario slug in src/specs/spec-lock-manager.ts
- **Files:** `src/specs/spec-lock-manager.ts`
- **Action:** Replace the inline `.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')` chain at line 40 with `toSlug(s.name, { maxLen: Number.MAX_SAFE_INTEGER })`. Import `toSlug` from `../util/slug.js`.
- **Verify:** `grep -n "toSlug" src/specs/spec-lock-manager.ts` returns ≥2; the literal regex `[^a-z0-9]+/g` does not appear in this file anymore; `npx vitest run tests/spec-lock-manager.test.ts` passes.
- **Done:** Uses shared helper with untruncated option; spec-lock-manager tests green.

### Task 2.9: Update metta-fix-issues skill template and mirror
- **Files:** `src/templates/skills/metta-fix-issues/SKILL.md`, `.claude/skills/metta-fix-issues/SKILL.md`
- **Action:** Locate the step 2 propose invocation (currently around line 29) that reads `metta propose "fix issue: <issue-slug> — <issue-title>" --json`. Replace with `metta propose "fix-<issue-slug>" --json`. Update the surrounding prose so the change-name pattern is documented as `fix-<short-issue-slug>` (the slug is short, ASCII, and already meaningful). Mirror the same edit to the deployed `.claude/` copy.
- **Verify:** `grep 'fix-<issue-slug>' src/templates/skills/metta-fix-issues/SKILL.md` returns ≥1; `grep 'fix issue: <issue-slug>' src/templates/skills/metta-fix-issues/SKILL.md` returns 0; `diff src/templates/skills/metta-fix-issues/SKILL.md .claude/skills/metta-fix-issues/SKILL.md` is empty.
- **Done:** Skill passes short change name; mirror byte-identical.

---

## Batch 3: Summary + full gate suite (sequential — depends on Batch 2)

### Task 3.1: Write summary.md and run full gate suite
- **Files:** `spec/changes/centralize-slugify-utility-strip-non-ascii-truncate-at-word/summary.md`
- **Action:** Summary covers: problem (three slug bugs, shared root cause), solution (one toSlug in src/util/slug.ts, 8 call sites replaced, skill template updated), files touched (list all), test coverage (new tests/slug.test.ts with 9 scenarios). Run `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`.
- **Verify:** All four gates exit 0. Cross-cutting: (a) `grep -rn "function slugify\\b\\|function slugifyId\\b" src/` returns 0 matches, (b) `grep -rn "\\.replace(/\\[\\^a-z0-9\\]+/g, '-').*\\.slice(0, 60)" src/` returns 0 matches, (c) every target file imports `toSlug`.
- **Done:** summary.md written; all gates green; cross-cutting greps clean.
