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

## Verification

Fixup commit `b156eba4d` additionally sanitized `gap.action` (multiline), `stories.justification` (multiline), and the `roadmap next` handoff line (single-line, text branch only), with new tests in `tests/cli-gaps.test.ts` (new file), `tests/cli-roadmap.test.ts`, `tests/cli-status.test.ts`.

### Spec scenarios (verified against intent — quick workflow)

- All 16 intent-listed render sites wrapped with the correct variant — PASS (verifier cited file:line for each)
- Newline-preserving helper `stripControlSequencesMultiline` behaves per intent (LF preserved, CRLF→LF, per-line OSC/DCS bounding, idempotent) — PASS
- JSON output paths byte-faithful — PASS (zero `strip` on `outputJson` lines; `--json` tests assert exact hostile bytes round-trip)
- Tests cover list, heading, and multi-line body sites plus JSON fidelity — PASS (85/85 targeted; 93/93 after fixup)

### Gate results (verification phase)

| Gate | Result |
|------|--------|
| `npm test` (full suite, pre-fixup) | 2400/2400 pass, 127/127 files |
| Targeted vitest (post-fixup, 4 touched files) | 93/93 pass |
| `npx tsc --noEmit` | pass (pre- and post-fixup) |
| `npm run lint` | pass (pre- and post-fixup) |

### Review

3 reviewers × 2 rounds: round 1 PASS_WITH_WARNINGS (×3) → fixup `b156eba4d` → round 2 PASS (×3). Security reviewer fuzzed the sanitizer with 20k adversarial strings: zero control-byte leaks, no ReDoS, idempotent.
