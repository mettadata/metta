# Spec: centralize-slugify-utility-strip-non-ascii-truncate-at-word

## Capability

centralize-slugify-utility-strip-non-ascii-truncate-at-word

---

## ADDED: Requirement: shared-to-slug-utility

**Fulfills:** US-4, US-1, US-3

`src/util/slug.ts` MUST export a new function `toSlug(input: string, opts?: { maxLen?: number; stopWords?: Set<string> }): string`.

The function MUST perform the following steps in order:

1. Lowercase the entire input string.
2. Replace every run of one or more non-alphanumeric characters (including any Unicode code point outside `[a-z0-9]`) with a single hyphen `-`.
3. Strip any leading or trailing hyphens from the result.
4. If `opts.stopWords` is provided, MUST remove each word segment that is an exact match for a member of the set (matched after lowercasing in step 1).
5. Truncate the remaining slug at the nearest word boundary (hyphen-delimited segment boundary) at or below `maxLen` (default `60`). If no segment boundary exists within `maxLen` characters (single long token), MUST hard-truncate at exactly `maxLen`.
6. Strip any trailing hyphen introduced by truncation.
7. If the final result is an empty string, MUST throw an `Error`. No silent fallback value is permitted.

The result MUST match `SLUG_RE` (`/^[a-z0-9][a-z0-9-]{0,59}$/`) when `maxLen` is the default `60`.

The existing `SLUG_RE` constant and `assertSafeSlug` export MUST remain unchanged.

### Scenario: basic lowercase and non-alphanumeric collapse

- GIVEN an input string `'Hello World'`
- WHEN `toSlug('Hello World')` is called
- THEN the return value is `'hello-world'`

### Scenario: em dash and non-ASCII stripping (US-1)

- GIVEN an input string containing an em dash `'Specification — card cover colors'`
- WHEN `toSlug('Specification \u2014 card cover colors')` is called
- THEN the return value is `'specification-card-cover-colors'` with no em dash or other non-ASCII characters present

### Scenario: word-boundary truncation (US-3)

- GIVEN an input whose slug form is `'a-very-long-description-that-will-be-truncated'`
- WHEN `toSlug('a-very-long-description-that-will-be-truncated', { maxLen: 30 })` is called
- THEN the return value ends at a word boundary and its `.length` is `≤ 30`
- THEN the return value does not end with a hyphen
- THEN the return value does not contain a mid-word fragment (no partial segment is present)

### Scenario: single-long-token hard-truncation

- GIVEN an input whose single slug token is longer than `maxLen`, e.g. `'abcdefghijklmnopqrstuvwxyz'`
- WHEN `toSlug('abcdefghijklmnopqrstuvwxyz', { maxLen: 10 })` is called
- THEN the return value is `'abcdefghij'` with exactly 10 characters and no trailing hyphen

### Scenario: stop-words filtered when opts.stopWords is provided

- GIVEN `stopWords = new Set(['the', 'a', 'of'])`
- WHEN `toSlug('The Rise of a Kingdom', { stopWords })` is called
- THEN the return value is `'rise-kingdom'` with stop-words removed

### Scenario: empty input throws

- GIVEN an input string that is empty `''`
- WHEN `toSlug('')` is called
- THEN an `Error` is thrown

### Scenario: all-non-ASCII input throws

- GIVEN an input string composed entirely of non-ASCII characters, e.g. `'\u2014\u2014\u2014'`
- WHEN `toSlug('\u2014\u2014\u2014')` is called
- THEN an `Error` is thrown

---

## ADDED: Requirement: spec-merger-uses-shared-to-slug

**Fulfills:** US-1

`src/finalize/spec-merger.ts` MUST derive capability folder names using `toSlug()` imported from `../util/slug.js`.

The existing inline slugify expression `.replace(/\s+/g, '-')` at line 48 of `spec-merger.ts` MUST be removed and replaced with a call to `toSlug(title)`.

No local slugify helper MUST remain in `spec-merger.ts`.

### Scenario: spec title with em dash produces clean folder name

- GIVEN a `spec.md` file whose H1 title is `'Capability — Card Cover Colors'`
- WHEN `spec-merger.ts` processes the file and derives the capability folder name
- THEN the resulting folder name is `'capability-card-cover-colors'`
- THEN the folder name matches `/^[a-z0-9][a-z0-9-]{0,59}$/`
- THEN no em dash or other non-ASCII character appears in the folder name

### Scenario: spec-merger imports toSlug, not a local helper

- GIVEN the source of `src/finalize/spec-merger.ts`
- WHEN it is inspected
- THEN it contains `import { toSlug }` from a path resolving to `src/util/slug.js`
- THEN it does NOT contain any `.replace(/\s+/g, '-')` slugify expression

---

## ADDED: Requirement: all-store-sites-use-shared-to-slug

**Fulfills:** US-4

The following files MUST replace their local slugify logic with a call to `toSlug()` imported from the appropriate relative path to `src/util/slug.js`:

- `src/artifacts/artifact-store.ts` — MUST pass its existing `STOP_WORDS` constant via `opts.stopWords`
- `src/backlog/backlog-store.ts`
- `src/issues/issues-store.ts`
- `src/gaps/gaps-store.ts`
- `src/specs/spec-parser.ts`
- `src/specs/spec-lock-manager.ts`
- `src/cli/commands/complete.ts`

After this change, a grep for the pattern `.replace(/[^a-z0-9]+/g, '-')` followed by `.slice(0, 60)` across `src/` MUST return zero matches.

Each file listed above MUST contain an import of `toSlug` from the relative path to `util/slug.js`. No local inline slugify function or expression MUST remain in any of these files.

### Scenario: no legacy slugify pattern remains in src/

- GIVEN the full `src/` directory tree
- WHEN it is searched with the pattern `\.replace\(/\[^a-z0-9\]/`
- THEN the search returns zero matches

### Scenario: artifact-store passes STOP_WORDS via opts

- GIVEN `src/artifacts/artifact-store.ts`
- WHEN it calls `toSlug` to derive an artifact slug
- THEN the call includes `{ stopWords: STOP_WORDS }` in the opts argument
- THEN no local word-filter expression exists in the file outside of the `STOP_WORDS` constant declaration

### Scenario: each site imports toSlug from util/slug.js

- GIVEN each of the seven call-site files listed in this requirement
- WHEN the file source is inspected
- THEN it contains an import statement with `toSlug` sourced from a path ending in `util/slug.js`

---

## ADDED: Requirement: fix-issues-skill-uses-short-change-name

**Fulfills:** US-2

`src/templates/skills/metta-fix-issues/SKILL.md` step 2 MUST pass `fix-<short-issue-slug>` — where `<short-issue-slug>` is the issue slug alone, without any appended prose description — as the title argument to `metta propose`.

The deployed mirror at `.claude/skills/metta-fix-issues/SKILL.md` MUST be byte-identical to the template source after any build or copy step.

No version of `SKILL.md` MUST pass a concatenation of the issue slug with the issue's long description title to `metta propose`.

### Scenario: skill step 2 uses short slug form

- GIVEN the source of `src/templates/skills/metta-fix-issues/SKILL.md`
- WHEN it is inspected for the `metta propose` invocation in step 2
- THEN the argument is templated as `fix-<slug>` or equivalent short form
- THEN the argument does NOT append a long human-readable description after the slug

### Scenario: deployed mirror is byte-identical to template

- GIVEN `src/templates/skills/metta-fix-issues/SKILL.md`
- AND `.claude/skills/metta-fix-issues/SKILL.md`
- WHEN their contents are compared
- THEN the two files are byte-identical

### Scenario: resulting change name avoids mid-word truncation

- GIVEN an issue slug `'capability-folder-names-polluted-with-unicode'`
- WHEN `/metta-fix-issues` invokes `metta propose` with title `fix-capability-folder-names-polluted-with-unicode`
- THEN the resulting change directory name is `fix-capability-folder-names-polluted-with-unicode` with no mid-word fragment

---

## ADDED: Requirement: word-boundary-truncation

**Fulfills:** US-3

`toSlug()` MUST truncate the assembled slug at the nearest hyphen-delimited word boundary at or below `maxLen`. A "word boundary" is the position immediately after a complete hyphen-separated segment.

The algorithm MUST NOT produce a result whose length exceeds `maxLen`.

The result MUST NOT end with a hyphen under any circumstance.

When the first (and only) segment of the slug exceeds `maxLen` in length (no boundary exists within `maxLen` characters), `toSlug` MUST hard-truncate the slug at exactly `maxLen` characters. This is the only condition under which the result may end in a mid-word character.

### Scenario: truncation lands on word boundary

- GIVEN an input `'alpha bravo charlie delta echo foxtrot golf hotel india'`
- WHEN `toSlug('alpha bravo charlie delta echo foxtrot golf hotel india', { maxLen: 40 })` is called
- THEN the return value ends at a complete word segment
- THEN its length is `≤ 40`
- THEN it does not end with a hyphen

### Scenario: result never exceeds maxLen

- GIVEN any input string
- WHEN `toSlug(input, { maxLen: N })` is called for any positive integer `N`
- THEN the return value length is `≤ N`

### Scenario: no trailing hyphen after truncation

- GIVEN an input that after slugification is `'foo-bar-baz-qux'`
- WHEN `toSlug` truncates to a `maxLen` that falls immediately after a hyphen
- THEN the trailing hyphen is stripped from the result

### Scenario: single long token falls back to hard-truncation

- GIVEN an input that produces a single slug segment longer than `maxLen`, e.g. `'superlongwordwithnospacesatall'`
- WHEN `toSlug('superlongwordwithnospacesatall', { maxLen: 10 })` is called
- THEN the return value is `'superlongw'` (exactly 10 characters)
- THEN no `Error` is thrown
