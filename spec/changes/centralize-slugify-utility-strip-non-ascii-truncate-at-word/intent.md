# centralize-slugify-utility-strip-non-ascii-truncate-at-word

## Problem

Three related bugs share a single root cause: every store and the spec-merger maintain their own ad-hoc slugify logic, none of which agrees on encoding, truncation, or word-boundary behavior.

1. **Non-ASCII characters survive into folder names** (`src/finalize/spec-merger.ts:48`). The merger's slugify does only `.replace(/\s+/g, '-')`, so em dashes, smart quotes, and other non-ASCII characters pass through verbatim into capability directory names on disk.

2. **Fix-issue change names are uglily long**. `metta-fix-issues` SKILL.md step 2 passes the full string `fix issue: <slug> — <long description>` to `metta propose`. That string gets slugified and then mid-word truncated, producing branch and directory names like `fix-issue-capability-folder-names-polluted-with-unicode-em-da`.

3. **All slug truncation cuts mid-word**. Every store calls `.slice(0, 60)` directly on the assembled slug string, which severs at an arbitrary character rather than a word boundary, yielding trailing fragments.

## Proposal

**Centralize the helper.** Extend `src/util/slug.ts` with a new exported function `toSlug(input: string, opts?: { maxLen?: number; stopWords?: Set<string> }): string`. The function normalizes to lowercase, replaces any run of non-alphanumeric characters (including non-ASCII) with a single hyphen, optionally filters stop-words, then truncates at the nearest word boundary at or below `maxLen` (default 60). If no word boundary fits within `maxLen` (single token longer than the limit), it hard-truncates at `maxLen`. Leading and trailing hyphens are stripped. If the result is empty, the function throws an `Error` — no silent fallbacks.

**Replace all call sites.** The eight slugify implementations across `src/finalize/spec-merger.ts`, `src/artifacts/artifact-store.ts` (retains its STOP_WORDS via opts), `src/backlog/backlog-store.ts`, `src/issues/issues-store.ts`, `src/gaps/gaps-store.ts`, `src/specs/spec-parser.ts`, `src/specs/spec-lock-manager.ts`, and `src/cli/commands/complete.ts` are deleted and replaced with `toSlug(...)` calls.

**Fix the fix-issue skill.** Update `src/templates/skills/metta-fix-issues/SKILL.md` step 2 to pass `fix-<short-issue-slug>` (the slug only, no long description title) to `metta propose`, keeping the resulting change name short and human-readable.

## Impact

- `src/util/slug.ts` — new `toSlug` function (extends existing file)
- `src/finalize/spec-merger.ts` — replaces line 48 slugify
- `src/artifacts/artifact-store.ts` — replaces local `slugify`, passes `STOP_WORDS` via opts
- `src/backlog/backlog-store.ts`, `src/issues/issues-store.ts`, `src/gaps/gaps-store.ts` — remove local slugify, import `toSlug`
- `src/specs/spec-parser.ts`, `src/specs/spec-lock-manager.ts` — slugify call replaced
- `src/cli/commands/complete.ts` — slugify call replaced
- `src/templates/skills/metta-fix-issues/SKILL.md` (and its dist mirror) — step 2 wording updated
- New unit tests for `toSlug` covering: non-ASCII stripping, stop-word opt-in, word-boundary truncation, single-long-token hard-truncate, empty-input throw
- Existing snapshot tests that assert exact slug strings may need updating if word-boundary truncation changes a prior output

## Out of Scope

- Renaming or migrating existing on-disk capability folders that already contain em dashes — only new slugs are fixed
- Schema or wire-format changes
- Any refactor of `spec-parser.ts` or `spec-lock-manager.ts` beyond swapping their slugify call
- Fallback or default strings for empty input — the function throws
