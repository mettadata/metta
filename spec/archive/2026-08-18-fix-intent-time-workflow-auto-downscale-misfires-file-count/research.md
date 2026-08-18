# Research Synthesis: fix-intent-time-workflow-auto-downscale-misfires-file-count

Three parallel research tracks, one per fix area (see `research-scorer-null-weight.md`, `research-fail-closed-prompt.md`, `research-decision-record.md`). All findings grep/code-verified against the worktree.

## Fix 1 — Null-weight zero-file intent scoring

**Chosen contract: `scoreFromIntentImpact` returns `null` on 0 parsed files**, merging with the existing missing-heading `null` case. Zero caller changes: `complete.ts:248` is the sole caller and both the persist write and the entire downscale/upscale/banner block are already gated on `score !== null`. The alternative (score object with `recommended_workflow` unset) is disqualified — the shared `ComplexityScoreSchema` would weaken summary-time validation and break unconditional dereferences in renderer/complete. Nothing depends on `complexity_score` existing (verified: instructions, status, statusline, quick-skill trivial gates all handle absence). The missing-heading vs present-with-0-files distinction collapses intentionally — doc-comment-only today, both are no-signal per spec. `scoreFromSummaryFiles` untouched by construction. Tests: invert one unit test (0-file→trivial), add 1-file boundary, summary-time 0-file→trivial regression, greenfield integration.

## Fix 2 — Fail-closed non-interactive downscale

**Chosen shape: explicit `else if` fail-closed branch** — `nonInteractive = !process.stdin.isTTY || json` between the autoAccept check (stays first, unchanged) and `askYesNo`, forcing `takeYes = false` and routing through the **existing No path**, which already writes the escalation record and prints the advisory banner (the spec requires the fail-closed path to be recorded, not silent). Adds a third justification cause (`non-interactive fail-closed`; `workflow_locked` keeps precedence). The upscale branch's static `defaultYes: false` trick is insufficient because TTY sessions must keep default-Yes — hence the call-site predicate (identical to askYesNo's own internal check). `askYesNo` untouched. Tests: invert 4, keep 7 as regression guards, add one genuinely new in-process TTY+`--json` test (the `json` half of the predicate is never isolated by the subprocess harness).

## Fix 3 — Accepted-downscale decision record

**Chosen shape: standalone `DownscaleDecisionSchema`** (`from_tier`/`to_tier` tier enums, `justification` min-1, `timestamp` datetime, `.strict()`), mounted as a **single optional `downscale_decision` object** on `ChangeMetadataSchema` (double collapse is structurally impossible — verified against the branch guards; matches the singular `escalation` sibling). Written by folding into the existing accept-path `updateChange` — one atomic validated write with the workflow rewrite. Critical trap found: the scoring block sits in an advisory try/catch and the metadata schema is strict, so writing the record without the schema field would be silently swallowed AND lose the workflow rewrite — accept-path tests must assert the record. Cause detection: `askYesNo` cannot distinguish explicit-yes from default-Yes; adopt the researcher's additive `askYesNoDetailed` helper (existing `askYesNo` becomes a thin wrapper — one deliberate addition beyond the intent's Impact list, flagged for design). Backward compat clean (optional field; statusline regex-extracts 3 unrelated keys).

## Cross-cutting notes

- Coordination: Fix 2's fail-closed path and Fix 3's record causes share the accept/decline plumbing — implement in one pass over `complete.ts` to avoid conflicting edits.
- Spec wording: `AutoDownscalePromptAtIntent`'s "or auto mode is off" clause is implemented implicitly by autoAccept collapsing first — acceptable reading; no spec change needed.
- All three fixes are independent at the file level except `complete.ts` (Fixes 2+3 overlap) — tasks should batch accordingly.

## Recommendation

Implement all three fixes as specced with the researched contracts: null return (Fix 1), explicit fail-closed else-if routed through the No path (Fix 2), single strict optional `downscale_decision` folded into the atomic accept-path write plus `askYesNoDetailed` (Fix 3). No open approach questions remain for design beyond blessing `askYesNoDetailed`.
