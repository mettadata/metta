# Gap: validate is redundant for engine-loaded graphs and untested for invalid graphs

**File:** `src/workflow/workflow-engine.ts` — `validate` method
**Type:** Behavior without meaningful test coverage

## Description

`validate` checks that all artifact `requires` references resolve to known artifact IDs. However, `topologicalSort` — which is always called during `loadWorkflowFromDefinition` and `loadWorkflow` — already throws synchronously with an identical check:

```ts
if (!artifactIds.has(dep)) {
  throw new Error(`Artifact '${artifact.id}' depends on unknown artifact '${dep}'`)
}
```

Because the engine enforces this constraint at load time, any `WorkflowGraph` that exists in memory is guaranteed to have all dependencies resolved. `validate` can therefore only detect errors for graphs constructed externally (bypassing the engine's load path), which is not a documented or tested use case.

## Missing Test

There is no test covering a graph that `validate` would mark as invalid (`valid: false`, non-empty `errors`). The only test for `validate` confirms the happy path — a valid graph returns `{ valid: true, errors: [] }`.

## Gap Options

1. **Add a test for the invalid case** — Construct a `WorkflowGraph` directly (not via the engine) with a dangling `requires` reference and assert that `validate` returns `valid: false` with the correct error string.

2. **Document the intended use** — Clarify in code or spec that `validate` is for graphs assembled outside the engine (e.g. after deserialization from state files) rather than freshly loaded graphs.

3. **Consider removal** — If graphs are only ever produced by the engine, `validate` may be dead code. The method should either be tested against a meaningful scenario or removed.

## Recommendation

Pursue option 1 plus option 2. The method has defensive value for state-file round-trips where a stored graph is reconstructed without running through `loadWorkflowFromDefinition`. Document this intent and add a test that exercises the error path.

Suggested test:

**Given** a `WorkflowGraph` assembled directly with an artifact `b` that requires non-existent artifact `x`
**When** `validate` is called
**Then** `result.valid` MUST be `false`
**And** `result.errors` MUST contain `"Artifact 'b' depends on unknown artifact 'x'"`
