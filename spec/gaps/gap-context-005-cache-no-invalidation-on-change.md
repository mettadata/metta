# GAP-CONTEXT-005: Cache Does Not Detect On-Disk Changes Without clearCache()

## Status: Resolved

## Location

`src/context/context-engine.ts` — `loadFile()`, lines 109–123

## Description

The cache in `ContextEngine` compares the SHA-256 hash of freshly-read content against the cached hash. This means every `loadFile` call always reads the file from disk to compute the hash, then compares. The cache only saves the token-counting step, not the I/O step.

This is a design tradeoff: correctness over I/O savings. However, it is not documented. Callers might assume the cache provides I/O avoidance, leading to confusion about why large files are always read from disk.

Additionally, if the same `ContextEngine` instance is shared across multiple workflow steps in a long-running process, the cache will grow unboundedly. There is no TTL, max-size cap, or LRU eviction.

## Impact

Low for correctness. Medium for performance in long-running processes or large monorepos. The `clearCache()` API is a full manual eviction that forces callers to reason about cache lifetime themselves.

## Recommended Fix

1. Add a JSDoc comment to `loadFile` clarifying that the cache avoids token re-counting but not file I/O.
2. Consider adding a `maxEntries` option or LRU eviction if the engine is used in long-lived daemon contexts.
3. Alternatively, document that callers should construct a fresh `ContextEngine` per workflow invocation.
