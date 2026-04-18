# Review: centralize-slugify-utility-strip-non-ascii-truncate-at-word

Three parallel reviewers: correctness, security, quality.

## Combined verdict: PASS

No critical issues. Two quality-of-life improvements applied during review:
- Named `toSlugUntruncated(x)` helper added for the three lock-file-adjacent call sites (was `toSlug(x, { maxLen: Number.MAX_SAFE_INTEGER })` — intent now obvious).
- Two extra tests added: untruncated variant + path-traversal regression.

## Findings

### Correctness — PASS
- All 10 test scenarios in `tests/slug.test.ts` mentally traced. Em-dash strip, word-boundary truncation, stop-words filter, hard-truncate fallback, empty-input throw, all-non-ASCII throw, SLUG_RE round-trip — all correct.
- 8 call sites use the right options. artifact-store passes `STOP_WORDS`; spec-parser and spec-lock-manager use untruncated form (now via `toSlugUntruncated`).
- `spec-merger.ts:49` genuinely fixes em-dash bug. Trace: `'Specification — card cover colors'` → `'specification-card-cover-colors'`.
- Skill template and mirror byte-identical.
- Suggestions implemented:
  - Named helper for untruncated form (applied).
  - Path-traversal regression test (applied).

### Security — PASS
- Regex is a safelist (`[^a-z0-9]+` → `-`), making path-traversal structurally impossible. `..` → throws; `../../etc/passwd` → `etc-passwd`.
- No unvalidated path writes: every call site that builds a filesystem path receives already-slugified input.
- **Warning (not fixed, acknowledged)**: no call site passes `toSlug` output back through `assertSafeSlug` before `join()`. Defense-in-depth gap; current regex makes it structurally safe. A future refactor could adopt belt-and-braces — out of scope here.
- **Warning (not fixed, acknowledged)**: `toSlugUntruncated` output can exceed 60 chars and therefore not match `SLUG_RE`. That's by design (lock-file compat); the helper's JSDoc now documents this contract and warns against passing output through `assertSafeSlug`.

### Quality — PASS
- TypeScript hygiene clean; `ToSlugOptions` exported; no `any`.
- `toSlugUntruncated` named helper now makes intent explicit at the three lock-file-adjacent sites.
- Test quality good; two gaps flagged by the reviewer (untruncated form coverage, path-traversal regression) both added.
- Conventional-commit style consistent across the change.
- **Suggestion (not applied)**: extract `capabilityFromDeltaTitle(title)` to DRY between `spec-merger.ts` and `complete.ts` (two call sites share `.replace(/\s*\(Delta\)\s*$/, '')` + `toSlug`). Out of scope — deferred.
- Stale comment in `tests/artifact-store.test.ts:41` ("slugify caps at 60") noted, not rewritten — low-value rename.

## Deferred items (not blocking)

- `capabilityFromDeltaTitle` helper extraction in spec-merger + complete.
- `assertSafeSlug(slug)` defense-in-depth after each `toSlug()` call that flows into a path.
- Rename `slugify caps at 60` test description in artifact-store.test.ts.
