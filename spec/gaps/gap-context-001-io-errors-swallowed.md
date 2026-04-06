# GAP-CONTEXT-001: I/O Errors Are Silently Swallowed for Required Files

## Status: Open

## Location

`src/context/context-engine.ts` — `resolve()`, lines 68–99

## Description

The `resolve` method uses a broad `catch {}` block for both required and optional source files. The comment for required files acknowledges that they "may not be created yet in the workflow," but this rationale only applies to `ENOENT` (file not found). All other I/O errors — permission denied, disk errors, encoding failures — are also silently swallowed.

This means a required artifact (e.g., `intent.md`) that exists on disk but is unreadable due to a permissions error will be silently omitted from context, causing the AI agent to receive incomplete context with no warning.

## Impact

High. Agents operating without required context may produce incorrect or incomplete artifacts. The failure is invisible to the user.

## Recommended Fix

Narrow the catch clause to only suppress `ENOENT` errors (`error.code === 'ENOENT'`). Re-throw all other errors, or at minimum log a warning and record the failure in `LoadedContext.truncations`.

```typescript
} catch (error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    // Re-throw or warn; don't silently drop required context
    throw error
  }
}
```

## Test Coverage Gap

No test exercises the case where a required file exists but is unreadable. A test should create a file, `chmod 000` it, and assert that `resolve` either throws or surfaces a warning.
