# GAP-CONTEXT-002: Loading Strategy Is Metadata Only — Not Applied During Load

## Status: Resolved

## Location

`src/context/context-engine.ts` — `selectStrategy()`, `loadFile()`

## Description

The `LoadedFile.strategy` field (values: `full`, `section`, `skeleton`) is selected based on file token count but has no effect on how the file is actually loaded. A 100,000-token file tagged as `skeleton` is still loaded in full (then truncated by the budget), rather than having `headingSkeleton()` applied to reduce its size before budget evaluation.

The `extractSections()` and `headingSkeleton()` methods exist as public APIs but are never called internally by `loadFile` or `resolve`. The strategy field is purely informational.

## Impact

Medium. Budget enforcement still prevents context overflow, but a large file tagged as `skeleton` could consume its full budget in raw truncated text rather than a more useful structural summary. AI agents receive a raw truncated blob instead of a meaningful skeleton.

## Recommended Fix

When `selectStrategy` returns `section` or `skeleton`, apply the corresponding transformation before token-counting truncation:

1. `section`: Call `extractSections` with caller-supplied or default section hints.
2. `skeleton`: Call `headingSkeleton` to reduce the file to its structural outline.

This would require `loadFile` to accept optional `SectionExtractionOptions`, or `resolve` to pass strategy-appropriate post-processors.

## Related

The public API surface for `extractSections` and `headingSkeleton` suggests they were designed to be wired into loading. The disconnect implies incomplete implementation rather than intentional design.
