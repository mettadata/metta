# enforce-workflow-tier-routing-so-ceremony-actually-scales

## Problem

Metta's adaptive-workflow-tier-selection capability already exists (file-count thresholds in `tierFromFileCount`, intent-time and post-implementation scoring, downscale/upscale prompts), but it is advisory-only and defaults toward the heaviest path at every decision point that matters:

- `metta propose` defaults `--workflow` to `standard` (a 6+ artifact planning pipeline) even when the description is obviously small (a bug fix, a typo, a one-file edit). A developer or AI orchestrator has to actively know about and type `metta quick` to get the lightweight path — nothing routes them there by default.
- The intent-time downscale prompt in `metta complete` (`src/cli/commands/complete.ts`) defaults to `No` (`defaultYes: false`) in every non-interactive or auto-mode-off context, meaning the *safe* answer for a scored-down change is to stay on the heavier workflow rather than collapse to the scored recommendation.
- There is no cost to escalating from a scored-quick change to `standard` or `full` — an AI orchestrator (or a human) can pick `standard` for a one-line typo fix with no friction and no record of why.
- The `workflow_locked` field already exists on `ChangeMetadataSchema` (set whenever `--workflow` is passed explicitly) but is documented as "reserved for future policy" and is not consumed anywhere — it has no behavioral effect today.
- There is no project-level visibility into how much of the commit history is ceremony (chore/docs artifact-shuffling commits) versus real work, so the cost of over-routing is invisible until someone audits the archive by hand.

This is not hypothetical: a metta-fix-issues CLI typo fix — a change that should have been a 1-2 commit, single-artifact fix — produced 10 artifacts, roughly 4,300 words of spec ceremony, and 18 commits. Framework-review context confirms this is systemic: 70% of the project's 1,569 commits are ceremony (chore/docs artifact-shuffling) rather than functional change, and the archive shows trivial changes routinely running the full pipeline despite `metta quick` and the scorer existing specifically to prevent that.

Affected parties: every developer and AI orchestrator using `/metta-propose` or `metta propose` for a small, bounded change; anyone reading `spec/archive/` trying to understand how much of the history is signal versus noise; and the framework's own credibility as a tool that scales ceremony to match change size — its stated value proposition.

## Proposal

Enforce, rather than merely advise, workflow tier routing so ceremony scales down for small changes by default and scaling up requires an explicit, recorded decision. Concretely:

1. **CLI-layer routing bias.** `metta propose` (`src/cli/commands/propose.ts`) keeps its current `--workflow` option and default value for backward compatibility, but the intent-time scoring/downscale machinery in `metta complete` (`src/cli/commands/complete.ts`) changes its default answer: when the artifact is `intent`, a recommended tier below the chosen tier is scored, AND the workflow was **not** explicitly locked (`workflow_locked !== true` on the change's persisted metadata), the downscale prompt's effective default flips from `No` to `Yes`. Interactively this changes the displayed default (`[Y/n]` instead of `[y/N]`); non-interactively (no TTY, `--json`, or auto mode off) the prompt now resolves to `Yes` instead of `No`, so an unattended run auto-downscales rather than silently staying on the heavier workflow. When `workflow_locked === true`, behavior is unchanged (defaults to `No`, i.e. respect the user's explicit `--workflow` choice) — this is the escalation path described in point 2.

2. **Explicit, recorded escalation.** Choosing (or keeping) a workflow tier above what the scorer recommends is now a deliberate act that must be justified and recorded, not a silent default. `ChangeMetadataSchema` (`src/schemas/change-metadata.ts`) gains an optional `escalation` object (`from_tier`, `to_tier`, `justification`, `timestamp`) capturing why a change was routed above its scored recommendation. `metta status` (`src/cli/commands/status.ts`) surfaces this field when present, in both `--json` and human output, so escalations are visible in the normal course of checking a change's state. The field is optional so every existing `.metta.yaml` file continues to validate without migration.

3. **Skill-layer routing guidance.** The `metta-propose` skill template (`src/templates/skills/metta-propose/SKILL.md`) gains a routing pre-step, run before Step 1 (parsing `--workflow`/`--auto`/`--stop-after`), that has the orchestrator classify the incoming description against small/bounded criteria (single-file edits, typo/text fixes, small self-contained utilities, bug fixes with an obvious localized cause) and, absent an explicit `--workflow` flag from the caller, route to `metta quick`. `CLAUDE.md`'s Metta Workflow section states explicitly that quick mode is the default routing decision for small, bounded changes and that escalating beyond it requires justification.

4. **Success metrics via existing surfaces.** `metta progress` (`src/cli/commands/progress.ts`) gains two new reported metrics, computed from data already available to it: a ceremony commit ratio (chore/docs commits versus total commits, from `git log`) and artifacts-per-small-change (mean artifact count for archived changes that finished on the `quick` or `trivial` tier, read from `spec/archive/`). No new CLI command is introduced.

5. **Everything else about the scorer is unchanged.** Tier thresholds in `tierFromFileCount` (trivial ≤1 file, quick 2-3, standard 4-7, full 8+), the null-score advisory-only behavior when an `## Impact` heading is missing, the post-implementation upscale prompt behavior, and the intra-quick-workflow fan-out reduction all stay exactly as they are today.

## Impact

Files whose behavior or contract this change modifies:

- `src/cli/commands/complete.ts` — flips the intent-time downscale prompt's effective default from `No` to `Yes` when `workflow_locked !== true`; the escalation-recording logic (persisting `escalation` on `.metta.yaml` when a user or auto-mode keeps/chooses a tier above the scored recommendation) is added here.
- `src/cli/commands/propose.ts` — no default-value change to `--workflow` (stays `standard` for direct CLI callers), but gains the plumbing needed to read/set `workflow_locked` correctly against the new escalation semantics.
- `src/complexity/scorer.ts` — unchanged tier math (`tierFromFileCount`, `scoreFromIntentImpact`, `scoreFromSummaryFiles`); referenced here because the new escalation-recording logic in `complete.ts` consumes `ComplexityScore.recommended_workflow` from it directly.
- `src/schemas/change-metadata.ts` — `ChangeMetadataSchema` gains the new optional `escalation` object (`from_tier`, `to_tier`, `justification`, `timestamp`) and its inferred `Escalation` type.
- `src/cli/commands/status.ts` — surfaces the `escalation` field in `printChangeStatus` (human output) and `toChangeJson` (JSON output) when present on a change's metadata.
- `src/cli/commands/progress.ts` — adds ceremony-commit-ratio and artifacts-per-small-change computation and rendering to both the human (`console.log` block) and `--json` (`outputJson`) output paths; reuses `src/util/git-log-timings.ts` conventions for git log access.
- `src/templates/skills/metta-propose/SKILL.md` — adds the routing pre-step before existing Step 1, and documents the escalation-justification requirement for orchestrators choosing `--workflow standard`/`--workflow full` explicitly.
- `CLAUDE.md` (project root) — Metta Workflow section gains a statement that quick mode is the default routing decision for small/bounded changes and that escalation requires justification; regenerated via `/metta-refresh` conventions once this change ships.
- `spec/specs/adaptive-workflow-tier-selection/spec.md` — receives delta requirements (via `spec.md` in this change directory, merged at finalize) covering the new default-flip behavior, the escalation schema/recording contract, and the progress metrics; this is a spec-authoring effect of the change, tracked separately from the source-file list above.
- `tests/cli-propose.test.ts` — extended to cover the unchanged `metta propose` default-workflow behavior alongside the new escalation-lock interaction.
- `tests/complete-marks-tasks.test.ts` and/or a new `tests/complete-downscale-default.test.ts` — cover the flipped downscale-prompt default and its `workflow_locked` guard.
- `tests/schemas.test.ts` — extended to cover the new optional `escalation` field on `ChangeMetadataSchema`, including backward compatibility with `.metta.yaml` files that omit it.
- `tests/progress-secondary-line.test.ts` and/or a new `tests/progress-ceremony-metrics.test.ts` — cover the new ceremony-ratio and artifacts-per-small-change metrics.
- A new `tests/cli-status-escalation.test.ts` (or an extension of the existing status test coverage) — covers `metta status` surfacing the `escalation` field.

Functionality NOT changed by this proposal: the `metta quick` command itself (`src/cli/commands/quick.ts`), the workflow template files (`src/templates/workflows/{trivial,quick,standard,full}.yaml`), the tier threshold boundaries in `tierFromFileCount`, the post-implementation upscale prompt's default behavior, the full-tier hard-cap-on-upscale behavior, and the intra-quick fan-out reduction logic in the skill template.

## Out of Scope

- Changing the numeric tier thresholds in `tierFromFileCount` (trivial ≤1, quick 2-3, standard 4-7, full 8+) — these stay as-is; this change only affects what happens once a tier is scored, not how the score is computed.
- Adding a new `metta` CLI command for metrics or reporting — success metrics are added to the existing `metta progress` output, not a new command.
- Enforcing (hard-blocking) escalation at the CLI level — the mechanism is "recorded justification," not a rejection of `--workflow standard`/`--workflow full` without one. A user or orchestrator can still choose a heavier tier; the change only requires that choice to leave a record when it goes above the scored recommendation.
- Changing behavior when the scorer returns `null` (no `## Impact` heading present) — this stays advisory-only with no forced routing, per discovery answer 7.
- Reworking the `full` workflow's missing-template-file issue (tracked separately as `full-workflow-references-missing-template-files-domain-resea`).
- Retroactively re-scoring or re-labeling already-archived changes in `spec/archive/` — the artifacts-per-small-change metric reads archive data as-is; it does not rewrite history.
- Changing the `metta quick` command's own default behavior or its hard-coded workflow selection (`src/cli/commands/quick.ts` is unaffected).
- Building any UI/dashboard surface for the new metrics — they render through the existing `metta progress` text/JSON output only.
- Migrating existing `.metta.yaml` files to add an `escalation` field — the field is optional precisely so no migration is needed; legacy changes simply report no escalation.
- Changing gate/verification behavior in `metta finalize` or `metta ship` — routing and escalation are propose/complete-time concerns in this change, not finalize-time gates.
