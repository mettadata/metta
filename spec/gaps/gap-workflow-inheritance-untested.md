# Gap: Workflow inheritance (extends / overrides) has no test coverage

**File:** `src/workflow/workflow-engine.ts` — `loadWorkflow`, `mergeWorkflows`
**Type:** Code behavior without tests

## Description

`WorkflowEngine` implements a full inheritance system:

- `loadWorkflow` detects an `extends` field and recursively loads the base workflow before calling `mergeWorkflows`.
- `mergeWorkflows` applies three merge rules: copy base artifacts, replace matching IDs from extension, append new artifacts, then apply per-artifact `overrides` patches.

None of this logic is covered by tests. The test suite only exercises:

- `loadWorkflowFromDefinition` (no inheritance path)
- `loadWorkflow` against the three built-in YAML files, none of which use `extends`

## Specific Untested Behaviors

| Behavior | Risk |
|----------|------|
| Base artifact replaced by extension artifact with same ID | Silent data corruption if merge logic is wrong |
| New artifact from extension appended to base list | Could be missing if early-exit bug |
| Override patches only specified fields; leaves others unchanged | Field clobbering if condition is wrong |
| Override for unknown ID is silently ignored | Could silently drop valid overrides if ID lookup fails |
| Recursive extends (grandparent chains) | Infinite loop or wrong merge order |
| Extension `name` and `version` take precedence over base | Could produce misidentified graph in cache |
| Merged definition does NOT re-carry `extends` | Could trigger re-merge on cache miss |

## Recommended Tests

1. **Given** a base workflow with artifacts `[a, b]` and an extension that extends it, adding artifact `c` and replacing `b`
   **When** `loadWorkflow` is called for the extension
   **Then** the resulting graph MUST have artifacts `[a, <replaced-b>, c]` in topological order

2. **Given** a base workflow and an extension with `overrides` that patches only `gates` on an inherited artifact
   **When** `loadWorkflow` is called for the extension
   **Then** the artifact's `gates` MUST reflect the override, and all other fields MUST be unchanged

3. **Given** an override referencing an artifact ID that does not exist in the merged list
   **When** `loadWorkflow` is called
   **Then** no error MUST be thrown (silent ignore)

4. **Given** a three-level chain: grandparent extends nothing, parent extends grandparent, child extends parent
   **When** `loadWorkflow` is called for the child
   **Then** all artifacts from all three levels MUST be present in the final graph

These test scenarios can use temp directories with YAML fixtures (consistent with the project's Vitest temp-dir isolation convention).
