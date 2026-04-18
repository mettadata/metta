# Design: centralize-slugify-utility-strip-non-ascii-truncate-at-word

## Approach

Add `toSlug(input, opts?)` to `src/util/slug.ts`. Replace eight existing slugify call sites. Update the metta-fix-issues skill template to pass a short change name. Add unit tests covering the `toSlug` behavior matrix.

## Components

- `src/util/slug.ts` — adds `toSlug()` next to existing `assertSafeSlug()`.
- `src/artifacts/artifact-store.ts` — replaces local `slugify`; exports `STOP_WORDS` (or keeps it local and passes via `opts`).
- `src/finalize/spec-merger.ts` — replaces inline `.replace(/\s+/g, '-')` with `toSlug`.
- `src/cli/commands/complete.ts` — replaces inline pattern on line 119 with `toSlug`.
- `src/backlog/backlog-store.ts`, `src/issues/issues-store.ts`, `src/gaps/gaps-store.ts` — replace local `slugify` with `toSlug(text)`.
- `src/specs/spec-parser.ts` — `slugifyId` becomes `toSlug(text, { maxLen: Number.MAX_SAFE_INTEGER })`.
- `src/specs/spec-lock-manager.ts` — inline scenario slug becomes `toSlug(s.name, { maxLen: Number.MAX_SAFE_INTEGER })`.
- `src/templates/skills/metta-fix-issues/SKILL.md` — step 2 passes `fix-<issue-slug>` not `fix issue: <slug> — <title>`.
- `.claude/skills/metta-fix-issues/SKILL.md` — mirrored.
- `tests/slug.test.ts` (new) — unit tests for `toSlug` covering all scenarios in spec.md.

## Data Model

No schema changes. `toSlug` is a pure function. Options shape:

```typescript
interface ToSlugOptions {
  maxLen?: number           // default 60
  stopWords?: Set<string>   // default undefined (no filter)
}
```

## API Design

```typescript
export function toSlug(input: string, opts: ToSlugOptions = {}): string {
  const maxLen = opts.maxLen ?? 60
  const stopWords = opts.stopWords

  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  if (stopWords) {
    slug = slug.split('-').filter(w => w && !stopWords.has(w)).join('-')
  }

  if (slug.length <= maxLen) {
    return slug.replace(/-$/, '')
  }

  // Word-boundary truncation
  const lastHyphen = slug.lastIndexOf('-', maxLen)
  if (lastHyphen > 0) {
    return slug.slice(0, lastHyphen)
  }

  // No word boundary fits — single long word. Hard truncate.
  const hard = slug.slice(0, maxLen).replace(/-$/, '')
  if (hard.length === 0) throw new Error('toSlug: input produced empty slug')
  return hard
}
```

Empty-input / all-non-ASCII handling: after the first two replace calls, if `slug === ''` and the early-return path is taken (`slug.length <= maxLen`, trivially true), we return `''`. That's wrong. Add an empty-check before the `slug.length <= maxLen` return:

```typescript
if (slug.length === 0) throw new Error('toSlug: input produced empty slug')
if (slug.length <= maxLen) return slug.replace(/-$/, '')
```

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Lock-file compat breaks when spec-parser/spec-lock-manager start truncating long IDs | Those two sites MUST pass `maxLen: Number.MAX_SAFE_INTEGER` so output stays untruncated (matches current behavior). Explicit in the spec and tasks. |
| Test `'add user profiles'` → `'user-profiles'` breaks if STOP_WORDS removed | artifact-store passes its STOP_WORDS via `opts`. Test still produces same output. |
| Existing em-dash capability folders on disk | Stay as-is. Only new capability folders benefit. Out of scope per intent. |
| `.claude/skills/metta-fix-issues/SKILL.md` drifts from source | Mirror the edit explicitly. Existing tests in `tests/agents-byte-identity.test.ts` don't cover this skill, so manual verification via `diff`. |
| `toSlug` tests end up literal-snapshot-heavy and break on future refactor | Keep snapshots tight to the documented behavior in spec.md scenarios. Don't snapshot incidental implementation details. |
