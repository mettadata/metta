# Gap: ExecutionStateSchema has no test for missing required top-level fields

**Detected:** 2026-04-06
**Source:** `tests/schemas.test.ts` — `describe('ExecutionStateSchema')`
**Severity:** Medium

## Description

`ExecutionStateSchema` requires four top-level fields: `change`, `started`, `batches`, and `deviations`. The test suite covers:
- A fully-populated valid object (passes)
- A deviation with `rule: 5` (fails correctly)

No test verifies that omitting any required field causes rejection. Because `ExecutionStateSchema` composes several nested schemas (`ExecutionBatchSchema`, `ExecutionTaskSchema`, `DeviationSchema`), a silent regression in required-field enforcement would not be caught.

## Missing test cases

1. Reject when `change` is omitted
2. Reject when `started` is omitted or is an invalid datetime
3. Reject when `batches` is omitted (note: the schema requires the field; an empty array `[]` is valid)
4. Reject when `deviations` is omitted (same note as above)
5. Reject when a task's `status` is an invalid enum value
6. Reject when a batch's `status` is an invalid enum value (e.g., `"cancelled"`)
7. Reject when a batch `id` is zero or negative

## Recommended Actions

Add a `describe` block for `ExecutionStateSchema` with the above cases, plus dedicated blocks for `ExecutionBatchSchema` and `ExecutionTaskSchema` covering their individual required fields and enum constraints.
