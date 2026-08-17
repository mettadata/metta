# Implementation Summary — fix-remaining-13-title-description-render-sites-print-user

## What changed

Wrapped every remaining human-rendered title/description print site behind control-sequence sanitization at the render edge, and added a newline-preserving helper variant for multi-line bodies. JSON output paths (`outputJson`) remain byte-faithful and untouched.

Fix commit: `269e6f17bb998c9f0c67b22d4f824732edebeee2` — `fix(cli): sanitize remaining title/description render sites` (11 files, +150/−32).

## Helper variant

- `src/util/sanitize-text.ts` — added `stripControlSequencesMultiline(text)`: splits on `\n`, sanitizes each line via the existing `stripControlSequences`, rejoins with `\n`. Preserves LF, normalizes CRLF to LF, bounds unterminated OSC/DCS bodies to their line. Existing helper and regex untouched.

## Sites wrapped

- `src/cli/commands/issue.ts` — list row title, show heading; show body (multiline)
- `src/cli/commands/fix-issue.ts` — show heading, `--all` row title, captured/context lines; show body (multiline)
- `src/cli/commands/gaps.ts` — list row title, show heading, source/claim/evidence/impact/relatedSpec lines
- `src/cli/commands/fix-gap.ts` — show heading, `--all` row title, source/claim/evidence/impact/relatedSpec lines
- `src/cli/commands/roadmap.ts` — list row title label and note suffix
- `src/cli/commands/validate-stories.ts` — story listing title
- `src/cli/commands/backlog.ts` — show heading; show body (multiline)
- `src/cli/commands/milestone.ts` — show heading (`item.name`); show body (multiline)

All 16 intent-listed sites plus the intent's in-scope same-block free-text fields are wrapped. `gap.action` deliberately excluded per intent scope.

## Tests

- `tests/sanitize-text.test.ts` — 8 new tests for the multiline variant (LF preservation, per-line CSI stripping, CRLF normalization, OSC/DCS/C1/lone-ESC parity, unterminated-OSC line bounding, Unicode pass-through, empty string, idempotence)
- `tests/cli-issue-backlog.test.ts` — 3 new render-edge tests: list title stripped in text mode, show heading stripped + body newlines preserved, `--json` title/description byte-faithful

## Gate results

| Gate | Result |
|------|--------|
| `npm test` | 2399/2400 on first full run — sole failure was a fixture typo in a newly added test, fixed; targeted re-run of both touched test files: 85/85 pass |
| `npm run lint` | pass |
| `npx tsc --noEmit` | pass |
| `npm run build` | pass |
