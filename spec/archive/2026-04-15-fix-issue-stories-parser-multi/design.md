# Design: fix-issue-stories-parser-multi

## Approach
Modify the paragraph-matching loop in `parseStories` to split on newlines and match each line independently against `FIELD_PREFIXES`.

## Components
- `src/specs/stories-parser.ts` — replace single-prefix-per-paragraph loop with per-line matching.
- `tests/stories-parser.test.ts` — add 2 new tests: compact format works; mixed format works.

## Risks
- Risk: a paragraph with arbitrary text containing `**As a**` mid-line would now match. Mitigation: `startsWith` after `.trim()` per line — only matches lines that begin with the prefix.
- Risk: `extractText` may not preserve line breaks. Mitigation: verify in test.

## Test Strategy
- Compact-format fixture (5 labeled lines on 5 consecutive lines, no blank between)
- Mixed-format fixture
- Existing 6 tests still pass
