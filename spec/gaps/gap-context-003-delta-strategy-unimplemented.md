# GAP-CONTEXT-003: Delta Strategy Declared but Unimplemented

## Status: Open

## Location

`src/context/context-engine.ts` — `LoadedFile` interface (line 19), `selectStrategy()` (lines 240–244)

## Description

The `LoadedFile.strategy` type union includes `'delta'` as a valid value:

```typescript
strategy: 'full' | 'section' | 'skeleton' | 'delta'
```

However, `selectStrategy()` never returns `'delta'`, and no code in the codebase produces or consumes a delta-strategy file. The `delta` value has no specification, no implementation, and no tests.

## Impact

Low (currently unreachable), but the declared type creates a false impression of capability. Any external code branching on `strategy === 'delta'` would enter a dead branch.

## Recommended Fix

Either:
1. Remove `'delta'` from the `strategy` union until the feature is specified and implemented, OR
2. Specify what delta loading means (e.g., loading only lines changed since a previous hash) and implement it.

If option 2 is chosen, a spec section must be written describing trigger conditions, the diffing mechanism, and how delta content is presented to agents.
