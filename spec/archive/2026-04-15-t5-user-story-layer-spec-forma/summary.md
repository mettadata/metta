# Summary: t5-user-story-layer-spec-forma

Third of 5 shipped-research items from `docs/research/2025-04-15/SUMMARY.md`. Adds optional user-story layer (spec-kit pattern) alongside the existing RFC 2119 requirement model.

## Files changed
- `src/schemas/story.ts` (new) — `StorySchema`, `StoriesDocumentSchema` (discriminated union: stories | sentinel), `PrioritySchema` (P1/P2/P3).
- `src/specs/stories-parser.ts` (new) — `parseStories(path)` via remark; throws `StoriesParseError` on monotonic/duplicate/missing-field violations; detects internal sentinel.
- `src/stories/story-validator.ts` (new) — `validateFulfillsRefs`, `detectDrift` pure functions.
- `src/specs/spec-parser.ts` — `Requirement` type gains `fulfills: string[]`; recognizes `**Fulfills:** US-N, US-M` line; malformed → warning, not error.
- `src/cli/commands/validate-stories.ts` (new) — `metta validate-stories [--change <name>] [--json]`. Exit 0 valid / 4 invalid. Includes assertSafeSlug guard.
- `src/cli/commands/instructions.ts` — extended BUILTIN_AGENTS + agentTypeMap to route `metta instructions stories` → metta-product agent.
- `src/templates/agents/metta-product.md` + `.claude/agents/...` (new) — product-thinking persona; reads intent.md, writes stories.md.
- `src/templates/artifacts/stories.md` (new) — scaffold.
- `src/templates/workflows/standard.yaml` — `stories` artifact inserted after `spec`, before `research`.
- `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/...` — agent list updated; stories phase noted.
- `src/templates/gates/stories-valid.yaml` (new) — finalize gate runs `metta validate-stories`.
- `tests/story-schema.test.ts` (new — 12 tests).
- `tests/stories-parser.test.ts` (new — 6 tests).
- `tests/story-validator.test.ts` (new — 7 tests).
- `tests/spec-parser.test.ts` (extended — +3 Fulfills cases).
- `tests/cli.test.ts` (extended — +4 validate-stories integration).
- `tests/agents-byte-identity.test.ts` (new — 2 tests).
- `tests/workflow-engine.test.ts` (1-line fix: standard workflow now has 8 artifacts not 7).

## Gates
- `npm run build` — PASS
- `npx vitest run` — **457/457 PASS** (was 423, +34 new)

## Behavior
- New changes following the standard workflow now produce stories.md between spec and research phases.
- Stories validated by Zod schema; finalize gate fails on missing fields, broken Fulfills refs, or duplicate/non-monotonic US-N IDs.
- Internal/refactor changes use sentinel: `## No user stories — internal/infrastructure change` + `**Justification:** ...`.
- Optional `**Fulfills:** US-N, US-M` field on requirements provides bidirectional traceability.
- Drift (stories.md modified after spec.md) → non-blocking warning suggesting spec re-derivation.

## Known caveats
- This very change (T5) doesn't have a stories.md — it predates its own gate. Acceptable for the meta-bootstrap.
- AcceptanceCriteria schema is `z.array(<object given/when/then>)` per Task 1.1 executor's interpretation of tasks.md (parser handles both string-ish and object forms).

All 14 task checkboxes flipped `[x]`.
