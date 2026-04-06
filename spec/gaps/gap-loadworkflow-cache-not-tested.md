# Gap: loadWorkflow cache behavior is not directly tested

**File:** `src/workflow/workflow-engine.ts` — `loadWorkflow` caching
**Type:** Behavior without test

## Description

`loadWorkflow` maintains an internal `Map<string, WorkflowGraph>` and returns the cached entry on repeated calls. This behavior is specified in the implementation but is not asserted by any test.

The existing YAML-loading test calls `loadWorkflow` three times for three different workflow names. It does not:

- Call `loadWorkflow` twice for the same name and verify the second call returns the cached graph.
- Verify that file I/O is not repeated (e.g. by spying on `readFile` or using a mock filesystem).

## Risk

If the caching check is broken (e.g. a refactor removes the early return), repeated calls would re-read and re-parse YAML files. This is a performance regression and could mask bugs where the same workflow is loaded with different state across calls.

## Recommended Test

**Given** a workflow YAML file in a temp directory
**When** `loadWorkflow` is called twice with the same name and search paths
**Then** both calls MUST return the same `WorkflowGraph` object reference (or deep-equal value)
**And** file I/O MUST only occur once (verifiable via spy or file-read counter)

A simpler proxy: call `loadWorkflow` on a valid workflow, then delete the YAML file, then call again — the second call MUST succeed from cache.
