# Retired: execution-engine

This capability spec was retired on 2026-07-16 because its implementing code — the `src/execution/` island (`execution-engine.ts`, `worktree-manager.ts`, `fan-out.ts`, and the old `batch-planner.ts`) — was deleted as verified dead code with zero non-test importers. The only live symbols in that island (`parseTasks`, `markTaskComplete`, `TaskDefinition`) were relocated to `src/planning/batch-planner.ts` and remain covered by the planning capability. See change: `delete-dead-code-identified-2026-07-framework-review-v0-2`.
