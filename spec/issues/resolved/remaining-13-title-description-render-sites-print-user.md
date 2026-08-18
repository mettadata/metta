---
priority: medium
---
# Remaining ~13 title/description render sites print user-controlled strings without stripControlSequences sanitization: issue.ts:89/105, fix-issue.ts:86/142, gaps.ts:18/33, fix-gap.ts:93/159, roadmap.ts:64, validate-stories.ts:105, backlog.ts:103/110 (show heading/body), milestone.ts:163/170 (show heading/body). The fix-follow-ups change (PR #86) added src/util/sanitize-text.ts and wrapped only the two defect sites per design ADR-1. Multi-line description bodies need a newline-preserving variant of the helper. Wrap each site at the render edge; JSON paths stay byte-faithful.

**Captured**: 2026-08-17
**Status**: logged
**Severity**: minor

Remaining ~13 title/description render sites print user-controlled strings without stripControlSequences sanitization: issue.ts:89/105, fix-issue.ts:86/142, gaps.ts:18/33, fix-gap.ts:93/159, roadmap.ts:64, validate-stories.ts:105, backlog.ts:103/110 (show heading/body), milestone.ts:163/170 (show heading/body). The fix-follow-ups change (PR #86) added src/util/sanitize-text.ts and wrapped only the two defect sites per design ADR-1. Multi-line description bodies need a newline-preserving variant of the helper. Wrap each site at the render edge; JSON paths stay byte-faithful.
