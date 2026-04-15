# Tasks: fix-issue-stories-parser-multi

### Task 1.1 — Per-line field matching in stories-parser
- **Files**: `src/specs/stories-parser.ts`
- **Action**: In the paragraph-matching loop, split `paraText` on `\n`, iterate each trimmed line, match against `FIELD_PREFIXES` independently. Each matching line sets its field (no `break` on first match).
- **Verify**: `npm run build` clean.
- **Done**: Compact stories.md format parses all 5 fields.

### Task 1.2 — Add compact + mixed format tests
- **Files**: `tests/stories-parser.test.ts`
- **Action**: 2 new test cases:
  1. Story with all 5 labeled fields on 5 consecutive lines, no blank lines between → all fields populated.
  2. Mixed: US-1 compact, US-2 spaced → both parse with all fields populated.
- **Verify**: `npx vitest run tests/stories-parser.test.ts`.
- **Done**: 8 tests pass (6 existing + 2 new).

### Task 1.3 — Verify ship's previous stories.md still parses
- **Files**: none
- **Action**: `metta validate-stories --change t5-user-story-layer-spec-forma` (the recently-shipped stories.md uses spaced format) — should still validate.
- **Done**: Existing shipped stories.md unaffected.

### Task 1.4 — Full suite
- **Action**: `npm run build && npx vitest run`.
- **Done**: All tests green.
