# Summary: centralize-slugify-utility-strip-non-ascii-truncate-at-word

## Problem

Three related slug-generation bugs with a shared root cause — 8 divergent slugify implementations across the codebase:

1. `spec-merger.ts:48` and `complete.ts:119` only replaced whitespace (`\s+`), so em dashes and other non-ASCII characters survived into capability folder names.
2. `/metta-fix-issues <slug>` skill passed a long title to `metta propose`, which produced ugly mid-word-truncated change names and branches.
3. `.slice(0, 60)` truncation everywhere cut mid-word, ending slugs in meaningless fragments.

## Solution

One shared `toSlug(input, opts?)` helper in `src/util/slug.ts`. Eight call sites replaced. Skill template updated. 10 new unit tests proving the contract.

### Added
- `src/util/slug.ts` — new `toSlug(input, opts?: { maxLen?, stopWords? })` function with non-ASCII stripping, optional stop-word filter, word-boundary truncation, hard-truncate fallback, and empty-input error path.
- `tests/slug.test.ts` — 10 unit tests covering every behavior in `spec.md`.

### Replaced
- `src/artifacts/artifact-store.ts` — local `slugify` → `toSlug(x, { stopWords: STOP_WORDS })`.
- `src/finalize/spec-merger.ts` — inline `.replace(/\s+/g, '-')` → `toSlug(...)`. Resolves em-dash capability folder bug.
- `src/cli/commands/complete.ts` — same inline pattern → `toSlug(...)`.
- `src/backlog/backlog-store.ts` — local `slugify` → `toSlug(x)`.
- `src/issues/issues-store.ts` — local `slugify` → `toSlug(x)`.
- `src/gaps/gaps-store.ts` — local `slugify` → `toSlug(x)`.
- `src/specs/spec-parser.ts` — local `slugifyId` → `toSlug(x, { maxLen: Number.MAX_SAFE_INTEGER })` (lock-file compatibility preserved).
- `src/specs/spec-lock-manager.ts` — inline slug chain → `toSlug(x, { maxLen: Number.MAX_SAFE_INTEGER })`.
- `src/templates/skills/metta-fix-issues/SKILL.md` (+ `.claude/` mirror) — `metta propose "fix issue: <slug> — <title>"` → `metta propose "fix-<issue-slug>"`.

## Resolves

- `capability-folder-names-polluted-with-unicode-em-dashes-beca` (major)
- `change-names-append-truncated-description-tail-producing-ugl` (minor)
- `slugs-are-truncated-at-arbitrary-character-count-and-end-wit` (minor)

## Cross-cutting verification

- `grep -rn "function slugify\b\|function slugifyId\b" src/` → zero matches
- `grep -rn "\.replace(/\[\^a-z0-9\]+/g" src/` → only inside `src/util/slug.ts:toSlug` itself
- `diff src/templates/skills/metta-fix-issues/SKILL.md .claude/skills/metta-fix-issues/SKILL.md` → empty

## Out of scope (preserved)

- Existing capability folders with em dashes already on disk (13 in demo projects) — not migrated. Only NEW folders benefit.
