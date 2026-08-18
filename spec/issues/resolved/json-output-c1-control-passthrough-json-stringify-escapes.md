---
priority: low
---
# JSON output C1 control passthrough: JSON.stringify escapes 0x00-0x1f but not 0x7f-0x9f, so a raw C1 CSI (U+009B) in an issue title passes through outputJson (src/cli/helpers.ts:220) to machine consumers and terminals that honor C1 controls. Noted in PR #86 research (research-renderer-sanitization.md). Candidate fix: escape the C1 range in outputJson at the JSON edge without mutating stored data.

**Captured**: 2026-08-17
**Status**: logged
**Severity**: minor

JSON output C1 control passthrough: JSON.stringify escapes 0x00-0x1f but not 0x7f-0x9f, so a raw C1 CSI (U+009B) in an issue title passes through outputJson (src/cli/helpers.ts:220) to machine consumers and terminals that honor C1 controls. Noted in PR #86 research (research-renderer-sanitization.md). Candidate fix: escape the C1 range in outputJson at the JSON edge without mutating stored data.
