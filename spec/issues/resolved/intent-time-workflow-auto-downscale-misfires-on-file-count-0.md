# Intent-time workflow auto-downscale misfires on file_count:0 and non-interactive default-Yes silently collapses the workflow

**Captured**: 2026-08-17
**Status**: logged
**Severity**: major

## Symptom
During the zeus consumer session's Jupiter change (2026-08-18), `metta complete intent` ran intent-time complexity scoring before any code existed, scored `file_count: 0`, recommended `trivial` for a change the user had deliberately started as `standard`, and — because the caller was non-interactive — took the default-Yes downscale path. The workflow silently collapsed to `trivial` (unstarted planning artifacts dropped) with no recorded justification, until the operator noticed, hand-restored `standard`, and set `workflow_locked`.

## Root Cause Analysis
Three compounding design choices produce the silent collapse. First, the intent-time scorer treats an authored-but-empty (or greenfield) `## Impact` section as positive evidence of triviality: `scoreFromIntentImpact` returns a score with `file_count: 0` whenever the heading exists, and `buildScore` maps 0 files straight to the `trivial` tier — but for greenfield work file_count is structurally 0 at intent time, so an absent-code signal is being weighted as zero instead of null (no recommendation). Second, the downscale prompt in `complete.ts` passes `defaultYes: workflow_locked !== true` to `askYesNo`, and `askYesNo` returns the default without prompting when stdin is not a TTY — so any non-interactive or `--json` invocation auto-accepts a workflow-collapsing decision. This is the opposite of the fail-closed pattern (default-No without a TTY) used elsewhere, e.g. the upscale branch's `defaultYes: false`. Third, there is an escalation-record asymmetry: declining a downscale writes an `escalation` record with justification, but accepting one (line 304–335) rewrites `workflow` and drops planning artifacts with no recorded justification at all, so the collapse leaves no audit trail.

### Evidence
- `src/complexity/scorer.ts:60` — `buildScore(fileCount)` unconditionally maps the parsed count through `tierFromFileCount`, so a structurally-zero greenfield count becomes a `trivial` recommendation instead of "no signal".
- `src/cli/commands/complete.ts:295` — the downscale `askYesNo` call uses `defaultYes: currentMetadata.workflow_locked !== true`, and per the comment above it, auto-collapse is explicitly "the silent path for non-interactive callers".
- `src/cli/helpers.ts:381` — `askYesNo` returns `defaultYes` immediately when `!process.stdin.isTTY || jsonMode`, so no human ever sees the collapse question in the failing scenario.

## Candidate Solutions
1. **Null-weight absent-code signals at intent time** — In `scoreFromIntentImpact`, return `null` (or a score with `recommended_workflow` unset) when the `## Impact` section parses to 0 files, distinguishing "no evidence" from "evidence of small", so no downscale prompt fires on greenfield intents. Tradeoff: genuinely trivial changes whose intent lists no files lose the auto-downscale nudge and keep standard-tier ceremony until a later scoring point (e.g. summary-time `scoreFromSummaryFiles`) catches them.
2. **Fail-closed non-interactive downscale** — In `complete.ts`, make the downscale branch mirror the upscale branch and release-cut confirm: when stdin is not a TTY or `--json` is set, keep the chosen workflow, print the advisory banner, and never take default-Yes; interactive TTY sessions can keep default-Yes. Tradeoff: fully autonomous pipelines that relied on silent auto-collapse must now set `auto_accept_recommendation: true` explicitly, adding one setup step.
3. **Symmetric justification recording on downscale** — Extend the accept path (complete.ts line 304) to write the same style of `escalation`/decision record that the decline path writes, capturing from_tier/to_tier/cause (auto-accept, TTY default, or explicit yes) so any collapse is auditable and reversible. Tradeoff: does not prevent the misfire itself — it only makes the collapse visible after the fact, so it is a complement rather than a fix.
