# Implementation Summary: enforce-workflow-tier-routing-so-ceremony-actually-scales

## What changed

Workflow tier routing is now enforced rather than advisory. Ceremony scales down by default and scaling up leaves an audit trail.

- **Auto-downscale by default** (`src/cli/commands/complete.ts`): the intent-time downscale prompt's effective default now derives from `workflow_locked` — `defaultYes: currentMetadata.workflow_locked !== true`. Unlocked changes scored below their tier collapse to the recommendation automatically (silently when non-interactive; `[Y/n]` when interactive). Explicitly locked workflows (`--workflow` passed at propose time) keep the old conservative No default. Both upscale prompts are unchanged.
- **Recorded escalation** (`src/schemas/change-metadata.ts`, `complete.ts`): new optional `escalation` object on `ChangeMetadataSchema` — `{ from_tier, to_tier, justification, timestamp }`, strict, Zod-validated via the existing `ArtifactStore.updateChange` write path. Written exactly when a change stays above its scored recommendation (justification `kept <tier>: workflow_locked` or `kept <tier>: declined downscale`); never written on the downscale path. Legacy `.metta.yaml` files without the field validate unchanged.
- **Escalation visibility** (`src/cli/commands/status.ts`): human output prints `Escalation: <from> -> <to> (<justification>)` when present; `--json` carries the field verbatim via the existing metadata spread (absent when absent, never null-normalized).
- **Ceremony metrics** (`src/util/ceremony-metrics.ts` new, `src/cli/commands/progress.ts`): `metta progress` now reports a ceremony-commit ratio (subjects matching `^(chore|docs)(\(.+\))?:`; merge commits and unprefixed subjects count in the denominator only) and artifacts-per-small-change (mean artifact count over archived quick/trivial changes, read through the Zod-validated `ChangeMetadataSchema` path). Both render in human and `--json` output with explicit no-data handling (`null`, never a fake `0`).
- **Skill routing pre-step** (`src/templates/skills/metta-propose/SKILL.md` + deployed copy, byte-identical): metta-propose now classifies incoming descriptions against small/bounded criteria and routes matches to `metta quick` unless the caller passed an explicit `--workflow`; explicit standard/full above the scored recommendation is documented as producing an escalation record with a one-line justification.
- **CLAUDE.md guidance** (`src/delivery/workflow-primer.ts`, regenerated via `metta refresh`): the Metta Workflow section now states quick mode is the default routing decision for small, bounded changes and that escalation above the scored recommendation requires a recorded justification.

## Requirement coverage

All 8 spec requirements implemented: AutoDownscalePromptAtIntent, EscalationSchema, EscalationRecording (batches 1–2); StatusEscalationSurface, ProgressCeremonyRatioMetric, ProgressArtifactsPerSmallChangeMetric (batch 3); SkillRoutingPreStep, EscalationJustificationGuidance (batch 4).

## Verification

- Full suite: 1038/1038 tests pass (80 files), including the new downscale 2×2 matrix (locked/unlocked × interactive/non-interactive), escalation presence/absence round-trips, merge-commit classification, null-passthrough metrics, and the skill byte-identity gates.
- `npx tsc --noEmit`: clean. `npm run build`: clean.
- Four pre-existing tests that encoded the old No-default were updated to the new contract (deliberate behavior change per spec, not a regression).

## Implementation commits

- `43c42bc53` feat: add EscalationSchema to change metadata
- `c4ce859db` test: cover escalation schema presence, absence, and min-length guard
- `88c11930f` feat: auto-downscale by default and record escalations
- `e6d8241fc` test: downscale default matrix and escalation recording
- `a28ac0e7b` feat: surface escalation in metta status
- `b45a8bc2a` feat: add ceremony metrics helper
- `33096d126` feat: report ceremony metrics in metta progress
- `dffea8153` feat: add routing pre-step to metta-propose skill
- `4df5087a7` feat: document quick-default routing in workflow primer

## Notes

- Constitution check ran via the metta-constitution-checker subagent (advisory stand-in — the CLI gate requires an Anthropic API key, which violates the project's no-direct-API principle; logged as issue `metta-check-constitution-requires-a-direct-anthropic-api`). One minor finding (raw-YAML parse alternative in Task 3.2) was fixed in the task wording before execution; the implementation uses the Zod-validated read path.
- CLAUDE.md regeneration also picked up two Active Specs table rows that were stale before this change (`fix-finalize-stage-...`, `fix-metta-propose-has-no-flag-...`) — legitimate refresh churn, verified against `spec/specs/`.
