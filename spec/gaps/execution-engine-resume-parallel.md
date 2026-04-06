# Gap: Resume always uses sequential mode

**Module**: `src/execution/execution-engine.ts`
**Discovered**: 2026-04-06
**Severity**: Medium

## Observation

The `resume` method re-executes incomplete tasks using sequential iteration
(`for...of` loops) regardless of whether the original batch had `parallel = true`.
There is no call to `executeBatchParallel` from the resume path.

## Impact

A change that was originally planned for parallel execution will run sequentially
after a resume. This is safer (no worktree conflicts) but it is undocumented
behavior. Users and callers cannot predict whether a resumed run will use
worktrees or not.

## Missing spec coverage

The spec does not currently state whether resume MUST use sequential mode or
whether it SHOULD attempt to reproduce the original execution mode. No test
exercises resume with a parallel batch plan.

## Recommended resolution

Decide and document one of:

1. **Sequential always (current behavior)**: Resume MUST always execute
   sequentially. State this explicitly in the spec. Add a test verifying that
   `mode = 'parallel'` is ignored during resume.

2. **Reproduce original mode**: Resume SHOULD attempt parallel execution for
   batches that were originally parallel, re-creating worktrees as needed. This
   requires additional implementation work and merge-safety analysis.
