# Implementation Summary: delete-dead-code-identified-2026-07-framework-review-v0-2

## What changed

~1,850 net lines of aspirational scaffolding removed; the CLI surface now describes what it actually does. Every deletion was re-verified as zero-non-test-importer immediately before removal.

- **Execution-engine island deleted** (US-1): `src/execution/` is gone — ExecutionEngine (382 lines), WorktreeManager (211), fan-out (151), old batch-planner (211) plus two test files. Live task parsing (`parseTasks`, `markTaskComplete`, `TaskDefinition`) relocated verbatim to `src/planning/batch-planner.ts`, reachable via the planning and root barrels; `complete.ts` repointed. `spec/specs/execution-engine/` retired to `spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement/` with README. `parallel-wave-computer.ts` stays (live via `cli/commands/tasks.ts`).
- **ToolAdapter indirection removed** (US-2): the 10-method single-implementation interface is gone; `claude-code-adapter.ts` exports its eight functions directly; `command-installer.ts` and `install.ts` call them without adapter injection. The four content types (SkillContent, CommandContent, ProjectContext, QuestionCapability) survive.
- **Dead schemas deleted** (US-3): `plugin-manifest.ts`, `auto-state.ts`, and `StateFileSchema.auto` removed atomically (schema stays `.strict()`; repo-wide find confirmed no state.yaml carries the field).
- **Honest CLI surface** (US-4): `metta execute --resume` and `metta auto --resume/--from` removed (all decorative); `metta auto` help and output now state plainly that it prints guidance and does not run an automated lifecycle loop; shell completion's "Full lifecycle loop" claim fixed.
- **Workflow inheritance machinery deleted** (US-5): `mergeWorkflows`, the `extends` branch, redundant `validate()`, and the `extends`/`overrides`/`WorkflowOverrideSchema` schema surface removed; `topologicalSort` is the sole graph-validation point; all four shipped workflow YAMLs load and topo-sort. `spec/specs/workflow-engine/spec.md` edited in place (inheritance/validate sections and scenarios removed); four hand-authored docs pages updated, plus a deviation commit fixing stale doc references to code deleted in earlier batches.

## Deviations (all in-scope, logged by executors)

- `install.ts` call sites updated with the adapter removal (required for atomic green build).
- `completion.ts` stale `auto` description fixed (the exact US-4 honesty problem).
- S-12 removed alongside S-13 in the workflow-engine spec (both are validate() scenarios; task text had them split).
- Stale hand-authored docs referencing deleted code fixed in a separate commit.

## Verification

Full suite 1054/1054 (80 files; count dropped from 1096 with the deleted dead-code tests — proportional to source). tsc, build clean. Line delta vs branch base: 27 files, +222/−2,066 in src+tests.

## Commits

`72ee98886` (island), `7d2047dad` (adapter), `6b1278460` (schemas), `162c49149` (CLI honesty), `1e5aac8b1` (workflow machinery), `0ebbdf549` (spec+docs), `2bb2e837c` (stale-docs deviation).

## Follow-ups noted (not in scope)

- workflow-engine spec 7.2 pre-existing drift: says "three built-in workflows" (there are four) and miscounts standard's artifacts — candidate issue.
