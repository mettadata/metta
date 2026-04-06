# Gap: Fan-out module has no integration with ExecutionEngine

**Module**: `src/execution/fan-out.ts`
**Discovered**: 2026-04-06
**Severity**: Medium

## Observation

`fan-out.ts` provides `createReviewFanOut`, `createResearchFanOut`,
`mergeFanOutResults`, and `formatFanOutForSkill` as standalone utility
functions. There is no connection between these functions and the
`ExecutionEngine`. Neither `ExecutionEngine` nor any other module imports
`fan-out.ts`.

`FanOutTask` and `FanOutResult` types are completely separate from
`TaskDefinition` and `ExecutionTask`.

## Impact

It is unclear how fan-out plans are actually executed. `formatFanOutForSkill`
returns a plain object intended for "the orchestrator skill," but there is no
orchestrator skill or agent runner in the current codebase. Fan-out is currently
a data-shaping layer with no runtime.

## Missing spec coverage

- How fan-out results flow back into the execution state
- Who calls `formatFanOutForSkill` and when
- Whether fan-out tasks can fail and what happens to the change lifecycle
- Whether fan-out results are persisted anywhere
- No tests exist for fan-out in `tests/`

## Recommended resolution

Define the integration contract between fan-out and the execution engine. Options:

1. **Workflow-level concern**: Fan-out is triggered by the workflow engine, not
   the execution engine. Document this boundary explicitly.

2. **ExecutionEngine extension**: Add a `fanOut(plan, callbacks?)` method to
   `ExecutionEngine` that runs fan-out tasks and merges results, persisting
   the merged output to the state file.

Add at minimum one test covering `createReviewFanOut`, `createResearchFanOut`,
and `mergeFanOutResults`.
