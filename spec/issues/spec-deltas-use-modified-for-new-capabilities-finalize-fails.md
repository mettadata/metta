# spec deltas use MODIFIED for new capabilities — finalize fails silently. When a change uses '## MODIFIED: <capability>' for a capability that does not yet exist in spec/specs/, finalize rejects the change without a clear error. Recurring across many demo changes. Fix: at spec-write time, validate that MODIFIED targets an existing capability; if not, suggest ADDED. Alternatively, auto-detect and convert.

**Captured**: 2026-04-15
**Status**: logged
**Severity**: major

spec deltas use MODIFIED for new capabilities — finalize fails silently. When a change uses '## MODIFIED: <capability>' for a capability that does not yet exist in spec/specs/, finalize rejects the change without a clear error. Recurring across many demo changes. Fix: at spec-write time, validate that MODIFIED targets an existing capability; if not, suggest ADDED. Alternatively, auto-detect and convert.
