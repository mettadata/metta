# Research: centralize-slugify-utility-strip-non-ascii-truncate-at-word

## Decision: extend `src/util/slug.ts` with `toSlug`; replace 8 call sites; update metta-fix-issues skill

### Approaches Considered

1. **One shared `toSlug(input, opts?)` in `src/util/slug.ts`** (selected) — matches the discovery-loop decision, and `src/util/slug.ts` already exists with `assertSafeSlug`. Backlog/issues/gaps stores already import from `../util/slug.js` for validation; extending the same module for generation fits cleanly.

2. **Separate `src/util/slugify.ts`** (rejected) — two files for one concept.

3. **Domain-local slugify modules** (rejected) — perpetuates drift.

### Rationale

A single helper with `{ maxLen?, stopWords? }` options covers every current use:
- `artifact-store` → passes `STOP_WORDS`, default `maxLen: 60`
- `backlog-store`, `issues-store`, `gaps-store` → no stopWords, `maxLen: 60`
- `spec-merger`, `complete.ts` (capability slug from spec title) → no stopWords, `maxLen: 60`
- `spec-parser.slugifyId`, `spec-lock-manager` (requirement/scenario IDs for lock files) → no stopWords, **`maxLen: Infinity`** (they are currently untruncated — see risk #1 below)

Word-boundary truncation + non-ASCII strip are universal wins.

### Risks carried forward

1. **Lock-file compatibility (critical)** — `src/specs/spec-parser.ts:75-80` (`slugifyId`) and `src/specs/spec-lock-manager.ts:40` (inline scenario slug) have **no truncation** today. Requirement/scenario IDs land in `.lock.yaml` files. Centralizing with default `maxLen: 60` would silently shorten long IDs and break spec-lock compatibility for any spec with a requirement or scenario name longer than 60 chars.
   **Mitigation**: these two call sites MUST pass `maxLen: Infinity` (or `Number.MAX_SAFE_INTEGER`) so their output remains untruncated.

2. **`artifact-store.test.ts:21-29` literal snapshot** — asserts `'add user profiles'` → `'user-profiles'`. `add` is in `STOP_WORDS`. Test passes only if artifact-store continues to pass `STOP_WORDS`. Safe with the opt-in `stopWords` option.

3. **Existing em-dash folders on disk stay** — per user decision. Only NEW slugs benefit from the fix. No migration.

4. **`artifact-store.test.ts:41` range check** — asserts length `<= 60 AND > 30`. Word-boundary truncation on the test input `'fix the drag card across lists feature with multi-select and keyboard shortcuts'` (after stop-word filter) lands well inside that range. Safe.

5. **`spec-merger.ts:48` and `complete.ts:119` use a different pattern today** — they only replace `\s+`, so em dashes survive into capability folder names. Centralizing with `toSlug` is the fix for issue #1 (em-dash capability folders). Known breakage is intentional — new capability folders created from spec titles containing em dashes will differ from hypothetical older ones. Out of scope by user decision.

### API shape (finalized)

```typescript
export function toSlug(
  input: string,
  opts?: { maxLen?: number; stopWords?: Set<string> }
): string
```

- Default `maxLen`: `60`
- Default `stopWords`: undefined (no filter)
- Lowercase → replace `[^a-z0-9]+` with `-` → optional stop-word filter → trim leading/trailing hyphens → truncate at nearest word boundary `≤ maxLen` → final trailing-hyphen trim
- If no word boundary fits (single long word > maxLen), hard-truncate at `maxLen`
- Empty or all-non-ASCII input → throw `Error('toSlug: input produced empty slug')`

### Call sites to update (8)

| File | Current | New |
|---|---|---|
| `src/artifacts/artifact-store.ts:12-22` | local `slugify` with `STOP_WORDS` | `toSlug(text, { stopWords: STOP_WORDS })` |
| `src/finalize/spec-merger.ts:48` | `.replace(/\s+/g, '-')` (broken) | `toSlug(title.replace(/\s*\(Delta\)\s*$/, ''))` |
| `src/cli/commands/complete.ts:116-119` | same as spec-merger | `toSlug(title.replace(/\s*\(Delta\)\s*$/, ''))` |
| `src/backlog/backlog-store.ts:15-21` | local `slugify` | `toSlug(text)` |
| `src/issues/issues-store.ts:17-23` | local `slugify` | `toSlug(text)` |
| `src/gaps/gaps-store.ts:18-24` | local `slugify` | `toSlug(text)` |
| `src/specs/spec-parser.ts:75-80` | `slugifyId` (untruncated) | `toSlug(text, { maxLen: Number.MAX_SAFE_INTEGER })` |
| `src/specs/spec-lock-manager.ts:40` | inline slug for scenarios | `toSlug(s.name, { maxLen: Number.MAX_SAFE_INTEGER })` |

### Skill template update

`src/templates/skills/metta-fix-issues/SKILL.md:29` currently reads:

```
metta propose "fix issue: <issue-slug> — <issue-title>" --json
```

Change to:

```
metta propose "fix-<issue-slug>" --json
```

The issue slug is already a clean slug; `metta propose` will further slugify and truncate (at 60 chars) but since the input is already short and ASCII-clean, the output stays meaningful. Deployed mirror `.claude/skills/metta-fix-issues/SKILL.md` must stay byte-identical.

### Artifacts Produced

None — direct code changes, no new contracts or schemas.
