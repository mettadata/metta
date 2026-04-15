# Summary: fix-issue-stories-parser-multi

Fixes major issue `stories-parser-fails-on-stories-md-where-labeled-fields-are-`. Discovered while shipping T5: my hand-written stories.md used compact format (no blank lines between fields), parser saw it as one paragraph starting with `**As a**` and reported other fields as missing.

## Files changed
- `src/specs/stories-parser.ts` — paragraph-matching loop now splits on newlines and matches each line independently.
- `tests/stories-parser.test.ts` — 2 new test cases (compact format; mixed format).

## Gates
- `npm run build` — PASS
- `npx vitest run` — 462/462 PASS (was 460, +2 new)

## Behavior
- Compact stories.md (consecutive labeled lines without blank separators) now parses all 5 fields correctly.
- Spaced stories.md (existing format) unchanged.
- Mixed format works.

## Out of scope
- Updating already-shipped stories.md files (they use spaced format, work fine).
- Same hardening for other parsers (spec-parser handles its fields differently; constitution-checker reads JSON not markdown).
