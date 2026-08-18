# Summary: fix-intent-time-workflow-auto-downscale-misfires-file-count

## What was implemented

All three complementary fixes from the intent, eliminating silent intent-time workflow collapse (the zeus Jupiter incident and metta's own repeated occurrences):

1. **Fix 1 — null-weighted zero-file intent scoring** (`de7f1ceac`, ADR-1): `scoreFromIntentImpact` returns `null` on any 0-file `## Impact` parse (missing-heading and present-but-empty merged — both are no-signal). Zero caller changes: `complete.ts` already gates persist + prompt on `score !== null`. `scoreFromSummaryFiles` untouched — 0 files at summary time remains a real trivial signal (intentional asymmetry, now documented in the doc comments).
2. **Fix 3 schema half — `DownscaleDecisionSchema`** (`bbb385cc5`, ADR-3): standalone strict 4-field schema (`from_tier`, `to_tier`, `justification` min-1, `timestamp` datetime), mounted as a single optional `downscale_decision` on `ChangeMetadataSchema` next to `escalation`. Backward compatible.
3. **`askYesNoDetailed`** (`0b3eb3a83`, ADR-4 — the one sanctioned scope addition): returns `{ value, viaDefault }` distinguishing explicit answers from defaults; `askYesNo` is now a thin wrapper, all other call sites untouched.
4. **Fixes 2+3 in complete.ts** (`e97d234d7`, ADR-2/ADR-3): the intent-time downscale branch keeps `autoAccept` first (sole sanctioned non-interactive Yes), then fails closed when non-interactive (`!process.stdin.isTTY || json`) — routed through the existing No/decline path so the escalation record and advisory banner fire, with a third `non-interactive fail-closed` justification cause (`workflow_locked` precedence preserved). Every accepted downscale (auto-accept / interactive explicit-yes / TTY default-Yes, distinguished via `viaDefault`) folds a `downscale_decision` record into the same atomic `updateChange` that rewrites the workflow. Upscale branch and summary-time scoring untouched.

Delta spec (merge target `adaptive-workflow-tier-selection`): MODIFIED `ComplexityScoreComputation`, MODIFIED `AutoDownscalePromptAtIntent`, ADDED `DownscaleDecisionSchema`, ADDED `DownscaleDecisionRecording`.

## Tests

280 tests across the four touched suites (complexity-scorer 15, schemas 193, cli-helpers 33, cli-complete 39+): T-S1 inverted + T-S2/T-S3 added; T-D1-D4 schema cases; T-H1 helper cases; 4 non-interactive auto-accept tests inverted to fail-closed; 7 regression guards extended with R1 record assertions (re-reading `.metta.yaml`); new greenfield, in-process TTY+`--json`, and explicit-yes cases. Full suite 129 files / 2457 tests green; lint/build clean; diff scope verified pure src/tests/spec (no templates or hooks).

## Behavioral changes callers observe

- Greenfield intents (0 files in Impact) no longer trigger a downscale prompt or persist a trivial recommendation.
- Non-interactive/`--json` `metta complete intent` never changes workflow tier unless `auto_accept_recommendation: true`.
- Accepted downscales write an auditable `downscale_decision` record.

## Recovery note

This change's original skill-host fork became unreachable after its proposer wrote intent.md; per the residual orphaning recovery protocol the orchestrator confirmed it dead and re-dispatched, resuming from persisted state (recorded in the research-synthesis commit `cd6e3580b`).

## Verification

### Spec Scenarios

All requirements/scenarios verified with cited test evidence (281/281 across the four touched suites):

- [x] `ComplexityScoreComputation` — greenfield 0-file intent: no score/prompt/banner/state change (cli-complete:787 + scorer units); 1-file still scores; summary-time 0 remains a real signal (unit); score persisted from Impact
- [x] `AutoDownscalePromptAtIntent` — non-TTY fail-closed (307/384); in-process TTY+`--json` isolation (620); auto-accept opt-in still collapses (250/754); interactive `[Y/n]` default; locked `[y/N]` both halves (417 non-TTY, 648 interactive TTY); quick-run exemption
- [x] `DownscaleDecisionRecording` — auto-accept, interactive explicit-yes, and TTY default-Yes causes each asserted as distinct justification strings with valid timestamps; decline paths assert escalation-without-record
- [x] `DownscaleDecisionSchema` — T-D1-D4 accept/reject incl. `.strict()` unknown-key rejection

Informational gaps (non-blocking): no test re-runs `complete intent` against an existing escalation record (first-record-wins untested end-to-end); summary-time 0-file scenario unit-level only (persist plumbing proven by 2/5/15-file CLI tests).

### Gate Results

| Gate | Result |
|------|--------|
| tests (`npm test`) | PASS — 129 files, 2458/2458 (no flakes this run) |
| typecheck / lint | PASS |
| build | PASS |
| diff scope | PASS — src/cli, src/complexity, src/schemas, tests/, spec/changes only; no templates or hooks |

Review: 3 reviewers, 1 iteration — correctness PASS, security/quality PASS_WITH_WARNINGS; all warnings fixed in 9b724ed84; follow-up issue `auto-accepted-workflow-upscales-mutate-workflow-with-no` logged for the upscale audit asymmetry.
