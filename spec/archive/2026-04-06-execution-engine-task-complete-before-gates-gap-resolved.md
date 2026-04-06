# Gap: onTaskComplete fires before gates, naming is misleading

**Module**: `src/execution/execution-engine.ts`
**Discovered**: 2026-04-06
**Severity**: Medium

## Observation

In both `executeBatchSequential` and `executeBatchParallel`, `onTaskComplete` is
called before gates are run and before `task.status` is set to `'complete'`.
The sequence is:

1. `task.status = 'in_progress'`
2. `onTaskStart(task.id)`
3. `onTaskComplete(task.id)`   ← fires here
4. `runTaskGates(task)`
5. `task.status = 'complete'` or `'failed'`

## Impact

The callback name `onTaskComplete` implies the task has finished, but at the
time it fires the task has not yet been gate-checked and its final status is
unknown. Callers that use this callback to record metrics or trigger downstream
work will act on an incorrect assumption.

This appears to be an intentional design (the callback is where the CLI would
invoke the AI agent to do the actual work), but it is not documented.

## Missing spec coverage

The spec does not explain what `onTaskComplete` signals. The callback interface
table says "After task logic completes (before gates)" but the distinction
between "task logic" and "task completion" is not defined anywhere.

## Recommended resolution

Rename the callback to `onTaskWork` or `onTaskExecute` to reflect that this is
the hook where the actual implementation work occurs, not when the task is done.
Alternatively, add a separate `onTaskDone` callback that fires after gates pass.
Document the intended usage clearly in the spec and in the interface JSDoc.
