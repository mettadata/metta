# Summary: t3-constitutional-gates-planni

First of 5 shipped-research items from `docs/research/2025-04-15/SUMMARY.md`. Adds a pre-implementation gate that semantically checks a change's spec.md against `spec/project.md`'s actionable sections (Conventions + Off-Limits).

## Files changed
- `src/schemas/violation.ts` (new) — Zod schemas: `ViolationSchema`, `ViolationListSchema`, `SeveritySchema`.
- `src/constitution/constitution-parser.ts` (new) — remark-based `parseConstitution()` extracts Conventions + Off-Limits as `string[]`.
- `src/constitution/complexity-tracking.ts` (new) — regex-based `parseComplexityTracking()` returns `Map<article, rationale>`.
- `src/constitution/checker.ts` (new) — `checkConstitution()` orchestrator. Injects `AIProvider`, builds XML-delimited prompt, cross-checks Complexity Tracking, returns `{violations, blocking, justifiedMap}`. Critical never justifiable; major justified iff Complexity Tracking has exact match; minor always advisory.
- `src/cli/commands/check-constitution.ts` (new) — `metta check-constitution [--change <name>] [--json]`. Exit 0 if not blocking, 4 otherwise or on any error.
- `src/cli/index.ts` — registers the new command.
- `src/templates/agents/metta-constitution-checker.md` + `.claude/agents/...` — scope-restricted agent (`tools: [Read]`).
- `src/templates/skills/metta-check-constitution/SKILL.md` + `.claude/skills/...` — thin wrapper skill.
- `src/templates/skills/metta-plan/SKILL.md` + `.claude/skills/...` — plan phase now runs the check as a post-step; blocks on exit 4.
- `tests/schemas.test.ts` — extended (+8 cases).
- `tests/constitution-parser.test.ts` (new) — 5 cases.
- `tests/complexity-tracking.test.ts` (new) — 5 cases.
- `tests/constitution-checker.test.ts` (new) — 8 cases with mocked provider.
- `tests/cli.test.ts` — extended (+6 cases: CLI integration + byte-identity).

## Gates
- `npm run build` — PASS
- `npx vitest run` — **415/415 PASS** (was 383, +32 new)

## Behavior
`metta check-constitution --change <name>`:
- Writes `spec/changes/<name>/violations.md` (frontmatter + either violation list or "No violations found.").
- Exit 0: no blocking violations.
- Exit 4: blocking violations (any critical, or major unjustified), or any error (agent timeout, parse failure, missing API key).

Plan phase skill calls this automatically; refuses to advance to implementation on exit 4.

## Back-compat
New specs only. Existing specs in `spec/specs/` are grandfathered.

## Known gaps (deferred)
- Happy-path live E2E test for the CLI (requires real API key; unit-covered via mocked provider in `constitution-checker.test.ts`).
- `dist/templates/*` parity is not verified in byte-identity tests (only src-template vs `.claude/` deployed). Deferrable.

All 11 task checkboxes flipped `[x]` in `tasks.md`.
