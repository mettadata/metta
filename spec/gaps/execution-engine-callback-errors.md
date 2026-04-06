# Gap: Callback errors are not isolated

**Module**: `src/execution/execution-engine.ts`
**Discovered**: 2026-04-06
**Severity**: High

## Observation

All callback invocations (`onTaskStart`, `onTaskComplete`, `onBatchStart`, etc.)
are called with `await callbacks?.onX?.()` directly inside `try/catch` blocks
that catch task-level errors. If a callback throws, the exception is caught by
the task error handler and the task is marked `'failed'` with the callback's
error message, even though the actual task work may have succeeded.

## Example

```ts
try {
  await callbacks?.onTaskComplete?.(task.id)  // throws "display error"
  // ...gates run...
  task.status = allPassed ? 'complete' : 'failed'
} catch (err) {
  task.status = 'failed'       // incorrectly failed due to callback throw
  await callbacks?.onTaskFailed?.(task.id, message)
}
```

## Impact

A CLI rendering error (e.g., a broken progress bar update) will cause the
underlying task to appear failed in state, blocking subsequent batches. This is
particularly dangerous given the merge-safety requirements documented in the
project feedback.

## Missing spec coverage

No test covers a callback that throws. The spec does not define isolation
requirements for callbacks.

## Recommended resolution

Wrap each callback invocation in its own try/catch. Log callback errors but do
not allow them to influence task or batch status. Add a test for this scenario.
Document the isolation contract in the spec:

> Errors thrown by callback functions MUST NOT affect task or batch status.
> The engine SHOULD log callback errors but MUST continue execution normally.
