# Summary: fix-metta-framework-parallelism-strengthen-skill-templates

## What changed

Two-part intervention to address the "work-in-serial" issue observed in prior changes:

1. **Skill-template discipline**: `/metta-propose` and `/metta-quick` SKILL.md files (both `src/templates/` and `.claude/` byte-identical mirrors) now carry a mandatory **pre-batch self-check block** at each fan-out (Implementation, Review, Verification) using RFC 2119 MUST/SHALL language with no hedge words, **rule inversion** (parallel is the default; sequential requires naming a specific conflicting file path in writing), and paired `wrong`/`right` fenced anti-examples showing the serial anti-pattern vs single-message multi-Agent-call correct pattern.

2. **CLI helper**: new `metta tasks plan --change <name>` subcommand that reads `tasks.md`, parses batches via remark, runs a components-then-toposort wave algorithm (union-find on file-overlap → Kahn's toposort on cluster DAG honoring `Depends on` directives), and emits a copy-paste-ready plan in either human format (`--- Batch N ---` headers + `Wave N [parallel|sequential]` lines) or `--json` (the schema from spec.md).

## Files

**New modules:**
- `src/planning/parallel-wave-computer.ts` — pure `computeWaves(graph, changeName): WavePlan` function
- `src/planning/tasks-md-parser.ts` — remark-based `parseTasksMd(md): TaskGraph`
- `src/planning/index.ts` — barrel

**New CLI command:**
- `src/cli/commands/tasks.ts` — Commander `tasks plan` registration
- `src/cli/commands/tasks-renderer.ts` — `renderHumanPlan` + `renderJsonPlan` pure formatters
- `src/cli/index.ts` — registered between status and instructions (subsumed Task 2.2 via Task 2.1)

**Template updates (both src/templates/ and .claude/ mirrors byte-identical):**
- `metta-propose/SKILL.md` — steps 4, 5, 6 rewritten
- `metta-quick/SKILL.md` — steps 5, 7, 8 rewritten

## Tests

- `tests/parallel-wave-computer.test.ts` (NEW) — 7 algorithm tests
- `tests/tasks-md-parser.test.ts` (NEW) — 7 parser tests
- `tests/cli.test.ts` — +5 unit tests for `metta tasks plan` human/JSON/error paths
- `tests/cli-tasks-plan.test.ts` (NEW) — 6 integration tests driving `dist/cli/index.js` against fixture + real archived tasks.md
- `tests/skill-discovery-loop.test.ts` — byte-identity check remains green across both SKILL.md pairs

All gates: tests, tsc, lint clean.

## Out of scope

- No changes to `metta execute` or runtime subagent spawning (instruction-mode preserved per constitution)
- No changes to `metta fix-issues --all` file-overlap batcher (already does this well)
- No `/metta-auto` parallelism overhaul
- Algorithm is intentionally conservative — file-missing tasks are treated as disjoint (over-parallelize), NOT as wildcards that conflict with everything
