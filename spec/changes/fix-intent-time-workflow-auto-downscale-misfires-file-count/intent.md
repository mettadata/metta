# fix-intent-time-workflow-auto-downscale-misfires-file-count

## Problem

Intent-time complexity scoring can silently collapse a deliberately chosen `standard` or `full` workflow down to `trivial` on a greenfield change, with no human confirmation and no audit trail. Observed in the zeus consumer session's Jupiter change (2026-08-18): `metta complete intent` ran before any code existed, `scoreFromIntentImpact` scored `file_count: 0`, recommended `trivial`, and the non-interactive caller took the default-Yes path — dropping unstarted planning artifacts and rewriting the workflow until the operator noticed, hand-restored `standard`, and set `workflow_locked`.

Three compounding defects produce this:

1. **Zero is treated as evidence of triviality.** `scoreFromIntentImpact` (`src/complexity/scorer.ts`) returns a score whenever the `## Impact` heading exists, and `buildScore(0)` maps straight through `tierFromFileCount` to `trivial`. For greenfield work, file count is structurally 0 at intent time — an absent-code signal is being weighted as "zero files" instead of "no signal".
2. **Non-interactive downscale defaults open.** The downscale prompt in `src/cli/commands/complete.ts` (line 295) passes `defaultYes: workflow_locked !== true` to `askYesNo`, and `askYesNo` (`src/cli/helpers.ts:381`) returns the default without prompting when stdin is not a TTY or `--json` is set. Any non-interactive invocation therefore auto-accepts a workflow-collapsing decision — the opposite of the fail-closed pattern the upscale branch already uses (`defaultYes: false`).
3. **Asymmetric audit trail.** Declining a downscale writes an `escalation` record with a justification; accepting one (complete.ts lines 304–335) rewrites `workflow`, drops unstarted planning artifacts, and records nothing. A silent collapse leaves no trace of when, why, or by what path it happened.

Affected: any metta user who starts a greenfield change at `standard`/`full` and completes intent via a non-interactive or `--json` caller — which is the normal path for AI-orchestrated sessions, metta's primary execution model. Severity is major: it destroys deliberate workflow decisions and drops planning-stage state without consent or record.

## Proposal

Apply all three complementary fixes — prevention at the scorer, fail-closed prompting, and audit-trail symmetry:

1. **Null-weight the absent-code signal at intent time** (`src/complexity/scorer.ts`). When the `## Impact` section parses to 0 files, `scoreFromIntentImpact` returns no workflow recommendation (return `null`, or a score with `recommended_workflow` unset) instead of a `trivial` recommendation. "No evidence of files" and "evidence of few files" become distinct outcomes, so no downscale prompt fires on a greenfield intent. `scoreFromSummaryFiles` is unchanged: at summary time, files exist, so 0 is a real signal, and genuinely trivial changes still get caught at that later scoring point. Update the doc comments on `scoreFromIntentImpact`/`buildScore` that currently document the zero-maps-to-trivial behavior.
2. **Fail closed on non-interactive downscale** (`src/cli/commands/complete.ts`). Mirror the upscale branch: when stdin is not a TTY or `--json` is set, the downscale branch keeps the chosen workflow, prints the advisory banner, and never takes default-Yes. Interactive TTY sessions may keep default-Yes (subject to `workflow_locked`). Fully autonomous pipelines that want auto-collapse must opt in explicitly via `auto_accept_recommendation: true`, which remains the sanctioned auto-accept path.
3. **Record every accepted downscale** (`src/cli/commands/complete.ts`, `src/schemas/change-metadata.ts` if needed). Extend the accept path (line 304 branch) to write the same style of escalation/decision record the decline path writes — capturing `from_tier`, `to_tier`, a justification keyed by cause (`auto_accept_recommendation`, interactive explicit yes, or TTY default-Yes), and a timestamp — validated through the existing Zod `EscalationSchema` (or a parallel downscale-record schema if reusing `escalation` would conflict with its decline semantics). Every workflow collapse becomes auditable and reversible after the fact.

Tests accompany each fix per the near 1:1 test-to-source convention: `tests/complexity-scorer.test.ts` covers the null-weighted zero-file intent score (and unchanged summary-time behavior), and `tests/cli-complete.test.ts` covers the fail-closed non-interactive downscale path and the recorded-justification accept path.

## Impact

- `src/complexity/scorer.ts` — `scoreFromIntentImpact` behavior changes for the zero-file case (no recommendation instead of `trivial`); `buildScore`/doc comments adjusted. `tierFromFileCount` thresholds and `scoreFromSummaryFiles` semantics are unchanged.
- `src/cli/commands/complete.ts` — downscale branch of the intent-time scoring block: fail-closed non-interactive handling, and a state write (escalation/decision record) on the accept path. Upscale branch and summary-time scoring (line 444) untouched.
- `src/schemas/change-metadata.ts` — only if the accept-path record cannot reuse the existing `EscalationSchema` shape; any new field is added optionally so existing `.metta.yaml` files continue to validate.
- `src/cli/helpers.ts` — `askYesNo` itself is expected to be unchanged (its non-TTY default-return contract is used correctly elsewhere); the fix is at the call site. Listed because the downscale call's option wiring changes.
- `tests/complexity-scorer.test.ts`, `tests/cli-complete.test.ts` — updated and extended; existing assertions that encode "0 files → trivial recommendation at intent time" or "non-interactive downscale auto-accepts" will need to be inverted to match the new behavior.
- Spec: `spec/specs/adaptive-workflow-tier-selection/spec.md` — the `AutoDownscalePromptAtIntent` requirement (cited in the complete.ts comments) currently sanctions the silent non-interactive collapse and must be revised to the fail-closed behavior, plus new requirements for null-weighted zero-file intent scoring and accepted-downscale recording.

Behavioral changes callers will observe:
- Greenfield intents (0 files in `## Impact`) no longer trigger a downscale prompt or persist a `trivial` recommendation at intent time; the first real recommendation arrives at summary time.
- Non-interactive/`--json` `metta complete intent` runs never change the workflow tier unless `auto_accept_recommendation: true` is set — pipelines relying on silent auto-collapse must add that one flag.
- Accepted downscales now perform an additional Zod-validated metadata write; `.metta.yaml` for collapsed changes gains a decision record.

## Out of Scope

- Changing the `tierFromFileCount` thresholds or the tier model itself.
- Changing `askYesNo`'s general non-TTY contract in `src/cli/helpers.ts` — other call sites (upscale, release-cut confirm) already use it correctly and are untouched.
- Summary-time scoring (`scoreFromSummaryFiles`) and its downscale/upscale behavior — 0 files at summary time remains a real trivial signal.
- The upscale branch, the full-tier upscale cap, and the intra-quick fan-out gate in the quick skill template.
- Removing or redesigning `auto_accept_recommendation` — it remains the explicit opt-in for autonomous auto-collapse.
- Adding new complexity signals beyond file count (e.g. LOC, dependency depth); the scorer's signal set is unchanged.
- Retroactively repairing changes already collapsed by this bug (the Jupiter change was hand-restored); no migration of existing `.metta.yaml` files.
