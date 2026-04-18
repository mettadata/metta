# Stories: centralize-slugify-utility-strip-non-ascii-truncate-at-word

## US-1: Non-ASCII characters stripped from capability folder names

**As a** metta maintainer authoring a spec.md whose H1 contains non-ASCII characters (em dashes, smart quotes)
**I want to** have the derived capability folder name contain only `[a-z0-9-]`
**So that** disk paths, branch names, and git operations stay portable and predictable
**Priority:** P1
**Independent Test Criteria:** `toSlug('Specification — card cover colors')` returns `'specification-card-cover-colors'` with no em dash or other non-ASCII characters.

**Acceptance Criteria:**
- **Given** an input string containing an em dash like `'Foo — Bar'` **When** `toSlug` is called **Then** the result is `'foo-bar'` with the em dash collapsed into a single hyphen
- **Given** a spec.md whose H1 contains smart quotes or other Unicode punctuation **When** the spec-merger derives the capability folder **Then** the folder name matches `/^[a-z0-9-]+$/`

## US-2: Fix-issue change names stay short

**As a** AI orchestrator running `/metta-fix-issues <slug>`
**I want to** have the derived change name be `fix-<short-issue-slug>` rather than the issue slug concatenated with a truncated prose description
**So that** resulting branch and directory names stay short, meaningful, and free of mid-word fragments
**Priority:** P2
**Independent Test Criteria:** The `/metta-fix-issues` skill passes `fix-<slug>` (no long description tail) as the propose title, verified by reading SKILL.md step 2.

**Acceptance Criteria:**
- **Given** an issue slug like `capability-folder-names-polluted-with-unicode` **When** `/metta-fix-issues` invokes `metta propose` **Then** the propose title is `fix-capability-folder-names-polluted-with-unicode` and not a concatenation with the long issue description
- **Given** the resulting change name **When** it is slugified into a directory name **Then** no mid-word truncation occurs because the input is already short

## US-3: Slug truncation happens at word boundaries

**As a** metta user running any command that derives a slug from user text (issue, backlog, gap, artifact, change)
**I want to** have truncation happen at a word boundary rather than an arbitrary character position
**So that** slugs never end in a meaningless mid-word fragment like `-em-da`
**Priority:** P2
**Independent Test Criteria:** `toSlug('a-very-long-description-that-will-be-truncated', { maxLen: 30 })` returns a slug ending at a word boundary at or below 30 chars, not a mid-word fragment.

**Acceptance Criteria:**
- **Given** an input whose slugified form exceeds `maxLen` **When** `toSlug` truncates **Then** the result ends at the last word boundary at or below `maxLen` with no trailing partial word
- **Given** a single token longer than `maxLen` (no word boundary fits) **When** `toSlug` truncates **Then** it hard-truncates at exactly `maxLen` characters
- **Given** an input that slugifies to an empty string **When** `toSlug` is called **Then** it throws an `Error` rather than returning a fallback

## US-4: Single shared slug utility

**As a** framework contributor adding a new store that needs slug generation
**I want to** have a single shared `toSlug()` utility with documented options
**So that** I don't reinvent slugify logic and cause drift across stores
**Priority:** P3
**Independent Test Criteria:** Grep for the old pattern `.replace(/[^a-z0-9]+/g, '-').slice(0, 60)` returns zero matches in `src/`, and all previously-local slugify call sites import `toSlug` from `util/slug.js`.

**Acceptance Criteria:**
- **Given** the eight existing slugify call sites **When** the change lands **Then** each site imports `toSlug` from `src/util/slug.ts` and contains no local slugify implementation
- **Given** the `artifact-store` that currently filters STOP_WORDS **When** it calls `toSlug` **Then** it passes its stop-word set via the `opts.stopWords` parameter, preserving existing behavior
