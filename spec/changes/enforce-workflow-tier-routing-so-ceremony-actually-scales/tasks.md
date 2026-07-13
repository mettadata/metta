<!--
Requirement -> Task coverage:
- AutoDownscalePromptAtIntent: 2.1, 2.2
- EscalationSchema: 1.1, 1.2
- EscalationRecording: 2.1, 2.2
- StatusEscalationSurface: 3.1
- SkillRoutingPreStep: 4.1
- EscalationJustificationGuidance: 4.1, 4.2
- ProgressCeremonyRatioMetric: 3.2, 3.3
- ProgressArtifactsPerSmallChangeMetric: 3.2, 3.3
-->

# Tasks: enforce-workflow-tier-routing-so-ceremony-actually-scales

## Batch 1: Schema foundation

- [ ] **Task 1.1: Add EscalationSchema to ChangeMetadataSchema**
  - Files: src/schemas/change-metadata.ts
  - Action: Add `EscalationSchema = z.object({ from_tier: z.enum(['trivial', 'quick', 'standard', 'full']), to_tier: z.enum(['trivial', 'quick', 'standard', 'full']), justification: z.string().min(1), timestamp: z.string().datetime() }).strict()` per design Data Model. Add `escalation: EscalationSchema.optional()` to `ChangeMetadataSchema` alongside the other optional fields (near `stop_after`). Export the inferred `Escalation` type alongside `ChangeMetadata`. Fulfills EscalationSchema.
  - Verify: npx tsc --noEmit
  - Done: change-metadata.ts compiles with `EscalationSchema` and `Escalation` type exported and `escalation` present as an optional field on `ChangeMetadataSchema`.

- [ ] **Task 1.2: Schema tests for escalation presence/absence**
  - Files: tests/schemas.test.ts
  - Action: In the existing `describe('ChangeMetadataSchema', ...)` block, add cases covering: (a) `schema_accepts_populated_escalation` — a metadata object with a populated `escalation` (`from_tier: 'quick'`, `to_tier: 'standard'`, non-empty `justification`, ISO `timestamp`) parses successfully and the field round-trips on the result; (b) `schema_accepts_legacy_file_without_escalation` — a metadata object omitting `escalation` entirely parses successfully with `escalation` absent (`undefined`) and no Zod error; (c) a metadata object with `escalation.justification: ''` fails validation (min-length guard). Fulfills EscalationSchema.
  - Verify: npx vitest run tests/schemas.test.ts
  - Done: all new assertions pass; existing ChangeMetadataSchema tests remain green.

## Batch 2: Core downscale-default and escalation-recording behavior

- [ ] **Task 2.1: Flip downscale default and record escalation in complete.ts**
  - Files: src/cli/commands/complete.ts
  - Action: In the intent-time downscale branch, change the `askYesNo` options at the `Scored as ... collapse workflow` call from `{ defaultYes: false, jsonMode: json }` to `{ defaultYes: currentMetadata.workflow_locked !== true, jsonMode: json }`. Leave the two sibling upscale `askYesNo` calls (post-intent upscale prompt and post-implementation upscale prompt) unchanged with `defaultYes: false`. In the `else` branch that currently only emits the informational banner when `takeYes` is `false`, additionally compose an `escalation` patch — `{ from_tier: recommendedTier, to_tier: currentWorkflow, justification: <canned string>, timestamp: new Date().toISOString() }` — and pass it into the same `ctx.artifactStore.updateChange(changeName, { ... })` call used for the accept path's `workflow`/`artifacts` write (i.e. call `updateChange` with just `{ escalation: {...} }` in this branch, since `workflow`/`artifacts` do not change here). Use the canned justification from design Data Model: `"kept ${currentWorkflow}: workflow_locked"` when `currentMetadata.workflow_locked === true` suppressed the Yes default, else `"kept ${currentWorkflow}: declined downscale"`. Do not write an `escalation` object anywhere on the `takeYes === true` accept path. Keep all of this inside the existing outer `try/catch` so it remains advisory-only. Fulfills AutoDownscalePromptAtIntent, EscalationRecording.
  - Verify: npx tsc --noEmit
  - Done: complete.ts compiles; the downscale prompt's effective default derives from `workflow_locked`; an `escalation` object is written to `.metta.yaml` exactly when the change stays above the scored recommendation, and never when it downscales to the recommendation.

- [ ] **Task 2.2: Downscale-default matrix and escalation tests**
  - Files: tests/cli-complete.test.ts
  - Action: Add test cases covering the 2x2 matrix from design's API Design table plus the accept path: (1) `workflow_locked === true`, non-interactive (`--json` or no TTY) — resolves No, workflow stays at the chosen tier, `.metta.yaml` gains an `escalation` with `from_tier`/`to_tier` matching the scored/chosen tiers and a non-empty `justification` containing `workflow_locked`; (2) `workflow_locked !== true` (absent), non-interactive — resolves Yes with no prompt printed, workflow collapses to the recommended tier, no `escalation` object is written; (3) `workflow_locked !== true`, interactive, simulated answer `n` — prompt suffix is `[Y/n]`, workflow stays at the chosen tier, `.metta.yaml` gains an `escalation` with justification containing `declined downscale`; (4) `workflow_locked !== true`, interactive, simulated empty/`y` answer — workflow collapses to the recommended tier, no `escalation` object written. Follow the existing mkdtemp/runCli harness pattern already used in this file. Fulfills AutoDownscalePromptAtIntent, EscalationRecording.
  - Verify: npx vitest run tests/cli-complete.test.ts
  - Done: all four matrix cases pass; existing tests in the file remain green.

## Batch 3: Surfacing — status and progress

- [ ] **Task 3.1: Surface escalation in metta status (human + --json)**
  - Files: src/cli/commands/status.ts, tests/cli-status.test.ts
  - Action: In `printChangeStatus`, after the token-totals block and before the iteration-counters block, add: when `metadata.escalation` is present, print `Escalation: ${metadata.escalation.from_tier} -> ${metadata.escalation.to_tier} (${metadata.escalation.justification})`; when absent, print nothing (no placeholder line). No code change is needed for `--json` — `toChangeJson`'s existing `...metadata` spread already carries `escalation` verbatim when present and omits it entirely when absent (unlike `complexity_score`, do not normalize it to `null`). Add tests in tests/cli-status.test.ts for: human output shows the escalation line with correct from/to/justification when present; `--json` output includes the `escalation` field verbatim when present; both human and `--json` render normally with no escalation section/field and no error when `escalation` is absent. Fulfills StatusEscalationSurface.
  - Verify: npx vitest run tests/cli-status.test.ts
  - Done: all three scenarios (human-with-escalation, json-with-escalation, no-escalation-either-mode) pass.

- [ ] **Task 3.2: Ceremony-ratio and artifacts-per-small-change helper**
  - Files: src/util/ceremony-metrics.ts, tests/ceremony-metrics.test.ts
  - Action: Create `src/util/ceremony-metrics.ts` as a sibling to `src/util/git-log-timings.ts`, reusing its `execFile`/`promisify`/never-throw pattern. Implement `getCeremonyCommitRatio(projectRoot: string): Promise<{ ceremony: number; total: number; ratio: number } | null>` — runs `git log --format=%s` (no path filter) in `projectRoot`; classifies each non-empty subject line as ceremony iff it matches `^(chore|docs)(\(.+\))?:` (lowercase conventional-commit type, optional scope); per design Risks (b), merge commits (`Merge ...` subjects) and any subject without a recognized type prefix count toward `total` only, never toward the `ceremony` numerator — document this rule in a code comment; returns `null` only when the `git log` call itself fails (e.g. not a git repo), and `{ ceremony: 0, total: 0, ratio: 0 }` is never conflated with `null`. Implement `getArtifactsPerSmallChange(specDir: string): Promise<{ mean: number; sample_size: number } | null>` — reads `${specDir}/archive/*/.metta.yaml` (glob the archive directory with `node:fs/promises` `readdir`, parse each `.metta.yaml` with the project's existing YAML+Zod read path or a direct `js-yaml`/existing state-store parse consistent with how `artifact-store.ts` reads `.metta.yaml`), filters to entries whose `workflow` is `'quick'` or `'trivial'`, averages `Object.keys(artifacts).length` across the filtered set, and returns `null` (not `0`) when the filtered set is empty. Fulfills ProgressCeremonyRatioMetric, ProgressArtifactsPerSmallChangeMetric.
  - Verify: npx vitest run tests/ceremony-metrics.test.ts
  - Done: tests cover a mixed chore/docs/functional commit list, a merge-commit subject correctly excluded from the ceremony numerator, an empty/no-git-repo path returning `null`, a populated archive average, and an empty-filtered-archive `null` case; all pass.

- [ ] **Task 3.3: Wire ceremony metrics into metta progress**
  - Files: src/cli/commands/progress.ts, tests/progress-ceremony-metrics.test.ts
  - Action: Import `getCeremonyCommitRatio` and `getArtifactsPerSmallChange` from `../../util/ceremony-metrics.js` alongside the existing `getGitLogTimings` import. Call both once near the top of the action handler (`getCeremonyCommitRatio(ctx.projectRoot)`, `getArtifactsPerSmallChange(join(ctx.projectRoot, 'spec'))`). Add `ceremony_commit_ratio` and `artifacts_per_small_change` as two new top-level fields on the `--json` payload object (alongside `active`/`completed`/`summary`), each rendering the helper's return value verbatim (`null` stays `null`, never coerced to `0`). Add two new human-output summary lines after the existing shipped/active/total summary line, e.g. `Ceremony commits: 34% (534/1569 chore/docs)` when ceremony data is available, and `Artifacts per small change: 3.2 (avg over 12 quick/trivial changes)` or `Artifacts per small change: no data` when the helper returns `null`; apply the equivalent explicit no-data wording for the ceremony line when its helper returns `null`. Fulfills ProgressCeremonyRatioMetric, ProgressArtifactsPerSmallChangeMetric.
  - Verify: npx vitest run tests/progress-ceremony-metrics.test.ts
  - Done: `metta progress` and `metta progress --json` both include the two new metrics; the no-data case renders an explicit indicator (not a bare `0`) in both modes; tests pass.

## Batch 4: Skill routing pre-step and CLAUDE.md guidance

- [ ] **Task 4.1: Routing pre-step in metta-propose skill (template + deployed copy)**
  - Files: src/templates/skills/metta-propose/SKILL.md, .claude/skills/metta-propose/SKILL.md
  - Action: Insert an unnumbered `## Routing pre-step (run before Step 1)` section directly above the existing `## Steps` heading, identically in both files (do not renumber the existing "Step N" cross-references). The section must: classify the incoming change description against small/bounded criteria (single-file edits, typo/text fixes, small self-contained utilities, bug fixes with an obvious localized cause); when the description matches those criteria AND the caller did not pass an explicit `--workflow` flag, direct the orchestrator to run `metta quick` instead of proceeding into Step 1 / the standard proposal pipeline; when the caller passed an explicit `--workflow` flag, defer to that choice without overriding it; and document that choosing `--workflow standard`/`--workflow full` explicitly requires a recorded justification consistent with the escalation contract (`EscalationRecording`). Apply the exact same section text to both files. Fulfills SkillRoutingPreStep, EscalationJustificationGuidance.
  - Verify: npx vitest run tests/grounding.test.ts tests/skill-discovery-loop.test.ts
  - Done: the byte-identity tests (`grounding.test.ts`, `skill-discovery-loop.test.ts`) pass, confirming both files carry the identical new section.

- [ ] **Task 4.2: CLAUDE.md default-routing/justification wording via workflow-primer**
  - Files: src/delivery/workflow-primer.ts, CLAUDE.md
  - Action: Update `workflowPrimerLong()` in `src/delivery/workflow-primer.ts` to add a statement in the `### How to work` section text that quick mode is the default routing decision for small, bounded changes, and that choosing or keeping `--workflow standard` or `--workflow full` above the scored recommendation requires a recorded justification (mirroring the skill guidance from Task 4.1). Do not hand-edit `CLAUDE.md` directly — regenerate it: build the project (`npm run build`) then run `node dist/cli/index.js refresh --no-commit` from the repo root so the marker-delimited `<!-- metta:workflow-start -->...<!-- metta:workflow-end -->` section in `CLAUDE.md` picks up the updated `workflowPrimerLong()` text. Fulfills EscalationJustificationGuidance.
  - Verify: npx vitest run tests/refresh.test.ts && npm run build && node dist/cli/index.js refresh --no-commit
  - Done: `CLAUDE.md`'s Metta Workflow section states that quick is the default routing decision for small/bounded changes and that escalation above it requires justification; `tests/refresh.test.ts` passes.

## Batch 5: Full gate sweep

- [ ] **Task 5.1: Full gate sweep across all batches**
  - Files: (none — whole-repo verification)
  - Action: Run the full test suite, the TypeScript type checker, and the production build to confirm no regressions were introduced across Batches 1-4.
  - Verify: npx vitest run && npx tsc --noEmit && npm run build
  - Done: all three commands exit 0 with no failing tests, no type errors, and a successful build.
