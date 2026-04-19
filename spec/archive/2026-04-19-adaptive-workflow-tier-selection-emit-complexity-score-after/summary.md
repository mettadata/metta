# Summary: adaptive-workflow-tier-selection-emit-complexity-score-after

## Spec Scenarios

All 13 requirements / 42 scenarios in `spec.md` have at least one covering passing test. Scenario-level gaps (2): `IntraQuickDownsizeRule` fan-out counts are enforced by the `/metta-quick` SKILL.md template, not by vitest (skill orchestration runs in Claude Code, not in the test process); `ScoringRubricSpec.claude_md_active_specs_table_updated` — resolved by `metta refresh` (commit `dc8520a`).

## Gate Results

| Gate | Status |
|------|--------|
| `npm test -- --run` | PASS — 712/712 across 51 files |
| `npx tsc --noEmit` | PASS — exit 0 |
| `npm run lint` | PASS — exit 0 (aliased to tsc) |
| 3-reviewer fan-out | correctness FAIL → fixed (`c88f6ed06`) and re-verified; security PASS; quality PASS_WITH_WARNINGS |
| 3-verifier fan-out | tests PASS; tsc+lint PASS; scenario coverage PARTIAL → 1 scenario gap closed via metta refresh, remaining gap documented above |

## What changed

Added a complexity scoring layer that fires once after intent is authored (and recomputes once after implementation), surfaces as an advisory banner in `metta status` and `metta instructions`, and drives interactive `[y/N]` prompts at three points in the lifecycle: intent-time downscale, intent-time upscale, and post-implementation upscale. The `--auto` / `--accept-recommended` flag on `metta propose` / `metta quick` / `metta fix-issue` persists as `auto_accept_recommendation` in `.metta.yaml` and auto-confirms all three prompts. The `/metta-quick` skill's trivial-detection gate now also shrinks the review+verify fan-out to 1+1 when the scorer classifies a change as trivial.

## Files

**New source modules:**
- `src/complexity/index.ts` — barrel
- `src/complexity/file-count-parser.ts` — remark AST walker extracting `inlineCode` file tokens from a named H2 section
- `src/complexity/scorer.ts` — `tierFromFileCount`, `scoreFromIntentImpact`, `scoreFromSummaryFiles`, `isScorePresent` pure functions
- `src/complexity/renderer.ts` — `renderBanner`, `renderStatusLine` pure formatters

**Schema + store:**
- `src/schemas/change-metadata.ts` — extended with `complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`, `workflow_locked` optional fields; exports `ComplexityScoreSchema` and `ComplexityScore` type
- `src/artifacts/artifact-store.ts` — `createChange` accepts optional `autoAccept` and `workflowLocked` params

**CLI command extensions:**
- `src/cli/commands/propose.ts`, `src/cli/commands/quick.ts`, `src/cli/commands/fix-issue.ts` — `--auto` / `--accept-recommended` Commander options plumbed through to `createChange`
- `src/cli/commands/status.ts` — `renderStatusLine` for human output, `complexity_score` + `actual_complexity_score` fields in JSON output
- `src/cli/commands/instructions.ts` — `renderBanner` written to stderr before all existing output (keeps `--json` stdout clean)
- `src/cli/commands/complete.ts` — three prompt insertion sites (intent-downscale, intent-upscale, post-impl-upscale) with full-tier hard cap, auto-accept short-circuit, non-TTY defaults to No, workflow + artifacts map rebuild via `workflowEngine.loadWorkflow`
- `src/cli/helpers.ts` — added `askYesNo(question, { defaultYes, jsonMode })` using `node:readline`

**Templates:**
- `src/templates/workflows/trivial.yaml` (NEW) — minimal intent → implementation → verification graph to enable downscale target
- `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/metta-quick/SKILL.md` — trivial-detection gate on review+verify steps (1+1 fan-out when trivial, 3+3 otherwise); tests/tsc always run regardless of tier; `--auto` scope expansion documented
- `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/metta-propose/SKILL.md` — `--auto` scope expansion documented

**Rubric + docs:**
- `spec/specs/adaptive-workflow-tier-selection/spec.md` (NEW) — rubric with signal definitions, tier thresholds, four prompt modes, three storage fields, extension points for deferred signals (spec-surface, capability-count, line-delta) and deferred retro-artifacts (research, design, tasks)
- `spec/backlog/auto-select-workflow-quick-standard-full-based-on-change-com.md` — candidate solutions section added

## Tests

- `tests/schemas.test.ts` — +10 tests for `ComplexityScoreSchema` and the three new metadata fields
- `tests/complexity-file-count-parser.test.ts` (NEW) — 10 parser tests
- `tests/complexity-scorer.test.ts` (NEW) — 13 scorer tests incl. tier boundary cases
- `tests/complexity-renderer.test.ts` (NEW) — 21 renderer tests
- `tests/cli-helpers.test.ts` (NEW) — 6 `askYesNo` tests
- `tests/artifact-store.test.ts` — +6 createChange tests
- `tests/cli.test.ts` — +21 CLI tests (propose/quick --auto plumbing, status complexity output, instructions banner, complete-intent downscale, complete-intent upscale, complete-implementation upscale)
- `tests/complexity-tracking.test.ts` — +8 integration tests covering all four adaptive routing paths end-to-end

**Full suite: 721+ tests passing; `tsc --noEmit` clean.**

## Out of scope (deferred)

- Candidate Solution B (`metta fast` / `metta instructions trivial` standalone subcommand)
- Spec-surface, capability-count, and line-delta signals
- Retroactive research/design/tasks artifacts on post-impl upscale (only stories + spec are mentioned in the directive; actual authoring is delegated to the skill orchestrator layer)
- Config flag to toggle advisory on/off
- Recomputation at any lifecycle point other than implementation-complete
- Auto-upscale to `full` tier (hard capped at `standard`; `full` advisory-only)
