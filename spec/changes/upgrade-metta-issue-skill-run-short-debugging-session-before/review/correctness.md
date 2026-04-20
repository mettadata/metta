# Correctness Review: upgrade-metta-issue-skill-run-short-debugging-session-before

**Verdict**: PASS

## Summary

Round 2 fixes land correctly. The two warnings from round 1 are resolved in `src/cli/helpers.ts::readPipedStdin`: the 100 ms timeout now preserves accumulated data (`setTimeout(() => settle(data), 100)`), and the stale Buffer branch is gone — `onData` is typed as `(chunk: string)` paired with `setEncoding('utf8')`. `timer.unref()` is in place, the explanatory comments above `onData`, `cleanup`, and `timer` are clear, and the template-drift concern between `.claude/skills/metta-*/SKILL.md` and `src/templates/skills/metta-*/SKILL.md` is closed (`diff` produces no output for either skill). The round-1 note about the stdin-read vs description-guard ordering in `issue.ts` is downgraded to an informational note — behavior is correct and bounded.

## Findings

### Critical

None.

### Warnings

None.

### Notes

- `src/cli/helpers.ts:342` — `setTimeout(() => settle(data), 100)` now flushes whatever was buffered when the deadline fires, resolving the round-1 partial-data loss. `timer.unref()` at `:343` keeps the timer from pinning the event loop. Correct.
- `src/cli/helpers.ts:304-306` — `onData: (chunk: string) => void` paired with `process.stdin.setEncoding('utf8')` at `:344` makes the string concatenation sound; the prior `Buffer.isBuffer` branch is gone as intended. The comment at `:304` accurately states the invariant.
- `src/cli/helpers.ts:316-332` — `cleanup` removes all three listeners and calls `pause()` + `unref()` defensively inside a try/catch. The comment at `:316-321` explains the execFile-child hang scenario clearly and matches the behavior.
- `src/cli/helpers.ts:333-338` — `settle` is idempotent via the `settled` flag, so races among `end`, `error`, and the timeout cannot double-resolve. Correct.
- `src/cli/commands/issue.ts:18-23` — stdin is drained before the description-required guard. This is slightly wasteful when `description` is empty and a body is piped, but the wait is bounded (100 ms timer, unref'd, cleanup on settle), behavior is observable (`missing_arg` still fires correctly), and the ordering matches spec R5. Keeping as an accepted note rather than a warning.
- `src/issues/issues-store.ts:42-45` — body is written verbatim and the parse side's `descStart` lookup keys on `**Severity**:`, which cannot collide with H2 (`## Symptom`, `## Root Cause Analysis`, `## Candidate Solutions`) or H3 (`### Evidence`) in the RCA schema. Round-trip for the structured body is safe. The clarifying comment is good.
- `.claude/skills/metta-issue/SKILL.md` vs `src/templates/skills/metta-issue/SKILL.md` — `diff` is empty. Same for `metta-fix-issues`. Template drift closed, so `metta init` / `metta refresh` emits the same skill content the repo ships.
- `.claude/skills/metta-issue/SKILL.md:48-52` — the `printf '%s' "$BODY" | ... metta issue "$TITLE"` invocation matches the CLI contract (stdin is the body, positional arg is the title). `--quick` is correctly filtered out per the Rules section.
- `.claude/skills/metta-fix-issues/SKILL.md:29` — the "legacy shallow issue" fallback is preserved, so older issues lacking the RCA schema still flow through the pipeline without error.
