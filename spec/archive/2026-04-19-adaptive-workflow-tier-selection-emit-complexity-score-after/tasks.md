# Tasks for adaptive-workflow-tier-selection-emit-complexity-score-after

## Batch 1 (no dependencies)

- [ ] **Task 1.1: Extend ChangeMetadataSchema with complexity and auto-accept fields**
  - **Files**: `src/schemas/change-metadata.ts`, `tests/schemas.test.ts`
  - **Action**: Add `ComplexityScoreSchema` (score 0-3, signals.file_count, recommended_workflow enum), then extend `ChangeMetadataSchema` with three explicit optional fields: `complexity_score: ComplexityScoreSchema.optional()`, `actual_complexity_score: ComplexityScoreSchema.optional()`, `auto_accept_recommendation: z.boolean().optional().default(false)`, and `workflow_locked: z.boolean().optional()`. Preserve `.strict()`. Export `ComplexityScore` and `ComplexityScoreSchema` types. Add unit tests covering: schema accepts full complexity block, schema accepts legacy file without fields, `actual_complexity_score` does not overwrite `complexity_score`.
  - **Verify**: `npx vitest run tests/schemas.test.ts && npx tsc --noEmit`
  - **Done**: All new schema tests pass; `tsc --noEmit` exits 0; no existing schema tests regress.

- [ ] **Task 1.2: Implement file-count-parser module**
  - **Files**: `src/complexity/file-count-parser.ts`, `tests/complexity-file-count-parser.test.ts`
  - **Action**: Create `src/complexity/file-count-parser.ts` exporting `parseFileCountFromSection(markdownSource: string, sectionHeading: string): number`. Use `unified().use(remarkParse)` to walk the AST: locate the target H2 heading, collect `inlineCode` nodes in the section body, apply the extension-anchored/prefix-anchored discriminator (`.ts`, `.yaml`, `.md`, `.js`, `.go`, `.py`, `.rs`, `.sh`, `.json`, `.toml`; or prefix `src/`, `tests/`, `dist/`, `.metta/`), deduplicate by exact string, return count. Return 0 when heading is absent or no matching nodes found. Add unit tests covering: heading present with matching files, heading absent returns 0, deduplication of repeated references, non-file inline-code nodes are excluded.
  - **Verify**: `npx vitest run tests/complexity-file-count-parser.test.ts && npx tsc --noEmit`
  - **Done**: All parser unit tests pass; `tsc --noEmit` exits 0.

- [ ] **Task 1.3: Implement scorer module**
  - **Files**: `src/complexity/scorer.ts`, `tests/complexity-scorer.test.ts`
  - **Action**: Create `src/complexity/scorer.ts` exporting four pure functions: `tierFromFileCount(n: number): 'trivial' | 'quick' | 'standard' | 'full'` with canonical thresholds (<=1 trivial, 2-3 quick, 4-7 standard, >=8 full) as the single authoritative definition; `scoreFromIntentImpact(intentMd: string): ComplexityScore | null` calling `parseFileCountFromSection(intentMd, '## Impact')`; `scoreFromSummaryFiles(summaryMd: string): ComplexityScore | null` calling `parseFileCountFromSection(summaryMd, '## Files')`; `isScorePresent(metadata: ChangeMetadata): boolean`. Import `ComplexityScore` from schemas, `parseFileCountFromSection` from `./file-count-parser.js`. Add unit tests covering all four tier boundary values (1, 2, 4, 8), null return when section absent, `isScorePresent` true/false cases.
  - **Verify**: `npx vitest run tests/complexity-scorer.test.ts && npx tsc --noEmit`
  - **Done**: All scorer unit tests pass; thresholds encoded in one location only; `tsc --noEmit` exits 0.

- [ ] **Task 1.4: Implement renderer module**
  - **Files**: `src/complexity/renderer.ts`, `tests/complexity-renderer.test.ts`
  - **Action**: Create `src/complexity/renderer.ts` exporting `renderBanner(score: ComplexityScore | null | undefined, currentWorkflow: string): string` and `renderStatusLine(score: ComplexityScore | null | undefined): string`. `renderBanner` returns empty string when score is null/undefined; otherwise emits one of three advisory states: agreement (`Advisory: current workflow <tier> matches recommendation <tier>`), downscale (`Advisory: current <chosen>, scored <recommended> -- downscale recommended`), upscale (`Advisory: current <chosen>, scored <recommended> -- upscale recommended`). `renderStatusLine` returns empty string when score is null/undefined; otherwise returns `Complexity: <tier> (N file[s]) -- recommended: <workflow>`. Use existing `color()` helper from `src/cli/helpers.ts` for ANSI. Add unit tests for all three banner states, null guard, status-line singular/plural, null guard on status-line.
  - **Verify**: `npx vitest run tests/complexity-renderer.test.ts && npx tsc --noEmit`
  - **Done**: All renderer unit tests pass; both functions return empty string for null/undefined input; `tsc --noEmit` exits 0.

- [ ] **Task 1.5: Create complexity barrel and add askYesNo helper**
  - **Files**: `src/complexity/index.ts`, `src/cli/helpers.ts`, `tests/cli-helpers.test.ts`
  - **Action**: Create `src/complexity/index.ts` as a barrel re-exporting all public symbols from `./file-count-parser.js`, `./scorer.js`, and `./renderer.js`. Then modify `src/cli/helpers.ts` to add `askYesNo(question: string, opts?: { defaultYes?: boolean; jsonMode?: boolean }): Promise<boolean>`. Extract and generalize the `readline.createInterface` pattern already present in `install.ts`. Return `opts?.defaultYes ?? false` immediately when `!process.stdin.isTTY || opts?.jsonMode`; otherwise create `readline` interface, print question, resolve on line, close interface. Add unit tests for: non-TTY returns default, jsonMode returns default, defaultYes=true returns true without prompt.
  - **Verify**: `npx vitest run tests/cli-helpers.test.ts && npx tsc --noEmit`
  - **Done**: Barrel exports all symbols; `askYesNo` unit tests pass; `tsc --noEmit` exits 0.

## Batch 2 (depends on Batch 1)

- [ ] **Task 2.1: Extend ArtifactStore.createChange with autoAccept parameter**
  - **Depends on**: Task 1.1
  - **Files**: `src/artifacts/artifact-store.ts`, `tests/artifact-store.test.ts`
  - **Action**: Extend the `createChange` method signature to accept an optional `autoAccept?: boolean` parameter as the last argument. When true, persist `auto_accept_recommendation: true` in the `.metta.yaml` metadata block. When `--workflow` is explicitly set, also persist `workflow_locked: true`. Update all internal callers if any pass all positional args. Update unit tests to cover: `autoAccept: true` persists field, omitted `autoAccept` defaults to false, `workflow_locked` set when workflow explicitly provided.
  - **Verify**: `npx vitest run tests/artifact-store.test.ts && npx tsc --noEmit`
  - **Done**: All artifact-store tests pass including new coverage; `tsc --noEmit` exits 0.

- [ ] **Task 2.2: Add --auto flag to propose, quick, and fix-issue commands**
  - **Depends on**: Task 2.1
  - **Files**: `src/cli/commands/propose.ts`, `src/cli/commands/quick.ts`, `src/cli/commands/fix-issue.ts`, `tests/cli.test.ts`
  - **Action**: Add `.option('--auto, --accept-recommended', 'auto-accept adaptive routing recommendations')` to the Commander command definitions in all three files. Pass the resolved `autoAccept` boolean to `ArtifactStore.createChange`. Update CLI tests to assert: `--auto` flag persists `auto_accept_recommendation: true`; `--accept-recommended` alias behaves identically; `--workflow standard --auto` combination sets both fields correctly.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: All three commands accept `--auto` / `--accept-recommended`; CLI tests pass; `tsc --noEmit` exits 0.

- [ ] **Task 2.3: Extend status command with complexity output**
  - **Depends on**: Task 1.1, Task 1.4
  - **Files**: `src/cli/commands/status.ts`, `tests/cli.test.ts`
  - **Action**: Import `renderStatusLine` from `src/complexity/index.js`. In human-readable mode, when `complexity_score` is present call `renderStatusLine(score)` and append the result to the output block. When absent, print `Complexity: not yet scored`. In `--json` mode, include `complexity_score` and `actual_complexity_score` (or null when absent) as top-level fields in the change JSON payload. Ensure exit code 0 in all cases. Update status-related CLI tests to assert: human output shows `Complexity:` line, JSON output includes both score fields, absent score renders without error and exits 0.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: Human and JSON status output match spec scenarios; exit 0 in all paths; tests pass.

- [ ] **Task 2.4: Extend instructions command with advisory banner**
  - **Depends on**: Task 1.1, Task 1.4
  - **Files**: `src/cli/commands/instructions.ts`, `tests/cli.test.ts`
  - **Action**: Import `renderBanner` from `src/complexity/index.js`. Before writing existing output, call `renderBanner(score, currentWorkflow)`. When in `--json` mode, write the banner to `process.stderr` so JSON stdout remains machine-readable; in human mode write to `process.stderr` as the first line before stdout output. When score is absent, write nothing. Ensure the banner does not block execution or alter any artifact. Update instructions-related CLI tests to cover: agreement banner, downscale banner, upscale banner, suppressed when score absent, `--json` banner goes to stderr.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: All four banner scenarios produce correct output; `--json` stdout is uncontaminated; tests pass.

## Batch 3 (depends on Batch 2)

- [ ] **Task 3.1: Add intent-time scoring and downscale prompt to complete command**
  - **Depends on**: Task 1.2, Task 1.3, Task 1.5, Task 2.1
  - **Files**: `src/cli/commands/complete.ts`, `tests/cli.test.ts`
  - **Action**: After `markArtifact('intent', 'complete')`, call `scoreFromIntentImpact(intentMd)`. Persist `complexity_score` via `updateChange` (only when `isScorePresent` is false; never overwrite). Compare `recommended_workflow` to the current `workflow` field. If recommended tier is lower than chosen tier and chosen is not `quick` (quick is the smallest named interactive workflow): check `auto_accept_recommendation` — if true, print auto-accept banner to stderr and take yes path; otherwise call `askYesNo('Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]', { defaultYes: false })`. On yes: call `workflowEngine.loadWorkflow(recommendedTier)`, reconstruct artifact map from `buildOrder` carrying forward existing statuses, drop unstarted planning artifacts (stories, spec, research, design, tasks — status not `complete`), call `updateChange({ workflow, artifacts })`. On no or non-TTY: leave unchanged, emit advisory banner to stderr. Propagate existing git auto-commit block after any state mutation.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: Downscale prompt fires, mutates YAML on yes, skips on no, auto-accepts when flag set; all tests pass.

- [ ] **Task 3.2: Add intent-time upscale prompt to complete command**
  - **Depends on**: Task 3.1
  - **Files**: `src/cli/commands/complete.ts`, `tests/cli.test.ts`
  - **Action**: Immediately after the downscale block (same intent-complete site), add upscale logic: if `recommended_workflow` tier is higher than chosen workflow tier, check `auto_accept_recommendation` — if true, print auto-accept banner and take yes path; otherwise call `askYesNo('Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]', { defaultYes: false })`. Hard cap: if recommended is `full`, emit advisory to stderr (`Advisory: scored full -- upscale to full is not yet supported; consider standard`) and do not fire the prompt. On yes: call `workflowEngine.loadWorkflow(recommendedTier)`, diff artifact IDs against existing map, insert missing stages as `pending`, call `updateChange({ workflow, artifacts })`. On no or non-TTY: leave unchanged. Propagate existing git auto-commit.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: Upscale prompt fires and inserts artifacts on yes; full-cap advisory emitted without prompt; auto-accept skips prompt; non-TTY takes no path; tests pass.

- [ ] **Task 3.3: Add post-implementation upscale prompt to complete command**
  - **Depends on**: Task 3.2
  - **Files**: `src/cli/commands/complete.ts`, `tests/cli.test.ts`
  - **Action**: After `markArtifact('implementation', 'complete')`, call `scoreFromSummaryFiles(summaryMd)`, persist `actual_complexity_score` via `updateChange`. If recomputed tier exceeds current workflow tier: check `auto_accept_recommendation` — if true, print auto-accept banner and take yes path; otherwise call `askYesNo('Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]', { defaultYes: false })`. Yes path: update `workflow` field; check artifact list for existing `stories` and `spec` entries with status `complete` — only insert as `pending` those not already present and complete; print directive to stdout: `Post-impl upscale accepted. Run: metta instructions stories --change <name>  then  metta instructions spec --change <name>. Verification resumes after both are complete.`; call `updateChange`. No path (or non-TTY): print warning to stderr: `Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`; leave `workflow` unchanged. Exit 0 in all paths. Propagate git auto-commit.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: `actual_complexity_score` always persisted; yes path updates workflow, inserts only absent artifacts, prints directive; no path prints warning, leaves workflow unchanged; exit 0 everywhere; skip re-insert if stories/spec already complete; tests pass.

## Batch 4 (depends on Batch 3)

- [ ] **Task 4.1: Update metta-quick skill with trivial fan-out gate and --auto documentation**
  - **Depends on**: Task 3.3
  - **Files**: `src/templates/skills/metta-quick/SKILL.md`
  - **Action**: Extend the trivial-detection gate section: when `complexity_score.recommended_workflow === 'trivial'`, reduce review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. Non-trivial quick runs keep the default 3-reviewer and 3-verifier fan-out. Add explicit note that tests and tsc run on every change regardless of tier. Add documentation note explaining that `--auto` now also auto-accepts adaptive routing recommendations in addition to its existing discovery-loop scope. Apply even when user declined the downscale prompt and remained on quick workflow.
  - **Verify**: `npx tsc --noEmit && grep -q 'trivial' src/templates/skills/metta-quick/SKILL.md && grep -q '\-\-auto' src/templates/skills/metta-quick/SKILL.md`
  - **Done**: SKILL.md contains trivial fan-out gate (1 reviewer, 1 verifier) and `--auto` documentation note; `tsc --noEmit` exits 0.

- [ ] **Task 4.2: Update metta-propose skill with --auto documentation**
  - **Depends on**: Task 3.3
  - **Files**: `src/templates/skills/metta-propose/SKILL.md`
  - **Action**: Documentation-only update. Add a note that `--auto` now covers adaptive routing recommendations in addition to its existing discovery-loop scope. No template logic changes.
  - **Verify**: `grep -q '\-\-auto' src/templates/skills/metta-propose/SKILL.md && npx tsc --noEmit`
  - **Done**: SKILL.md contains `--auto` documentation expansion; `tsc --noEmit` exits 0.

- [ ] **Task 4.3: Create adaptive-workflow-tier-selection rubric spec**
  - **Depends on**: Task 3.3
  - **Files**: `spec/specs/adaptive-workflow-tier-selection/spec.md`
  - **Action**: Create the rubric document at `spec/specs/adaptive-workflow-tier-selection/spec.md`. Must include sections covering: v1 scoring signal (file count from `## Impact` section of `intent.md`), four tier thresholds with exact boundary values (<=1 trivial, 2-3 quick, 4-7 standard, >=8 full), four prompt modes (intent-downscale, intent-upscale, post-implementation-upscale, intra-quick-downsize) and their trigger conditions, three storage field names (`complexity_score`, `actual_complexity_score`, `auto_accept_recommendation`) and their Zod schema shapes, and explicit extension points naming deferred signals (spec-surface, capability-count, line-delta) and deferred retroactive artifacts (research, design, tasks) as planned-but-not-yet-implemented.
  - **Verify**: `ls /home/utx0/Code/metta/spec/specs/adaptive-workflow-tier-selection/spec.md && grep -q 'extension points' /home/utx0/Code/metta/spec/specs/adaptive-workflow-tier-selection/spec.md`
  - **Done**: Rubric document exists with all required sections; deferred signals and artifacts named as extension points.

## Batch 5 (depends on Batch 4)

- [ ] **Task 5.1: Integration test -- propose downscale accept path**
  - **Depends on**: Task 3.1, Task 4.3
  - **Files**: `tests/complexity-tracking.test.ts`
  - **Action**: Add a vitest integration test simulating `metta propose --workflow standard` followed by `metta complete intent` where `intent.md` has an `## Impact` section listing one file. Stub or mock TTY input to answer `y` to the downscale prompt. Assert: `.metta.yaml` `workflow` field changes to `trivial`, unstarted planning artifacts are removed from the artifact list, `complexity_score` is persisted with `recommended_workflow: trivial`, exit code is 0.
  - **Verify**: `npx vitest run tests/complexity-tracking.test.ts && npx tsc --noEmit`
  - **Done**: Integration test passes end-to-end; `.metta.yaml` mutation and artifact-list drop are asserted.

- [ ] **Task 5.2: Integration test -- quick upscale accept at intent time**
  - **Depends on**: Task 3.2
  - **Files**: `tests/complexity-tracking.test.ts`
  - **Action**: Add an integration test simulating `metta quick` followed by `metta complete intent` where `intent.md` has an `## Impact` section listing five files (scoring `standard`). Stub TTY input to answer `y` to the upscale prompt. Assert: `.metta.yaml` `workflow` field changes to `standard`, previously absent planning artifacts are inserted as `pending`, `complexity_score` persisted with `recommended_workflow: standard`, exit code 0.
  - **Verify**: `npx vitest run tests/complexity-tracking.test.ts && npx tsc --noEmit`
  - **Done**: Integration test passes; workflow promotion and artifact insertion asserted.

- [ ] **Task 5.3: Integration test -- post-implementation upscale accept path**
  - **Depends on**: Task 3.3
  - **Files**: `tests/complexity-tracking.test.ts`
  - **Action**: Add an integration test simulating a `quick` change where `summary.md` has a `## Files` section listing five distinct files. Stub TTY input to answer `y`. Assert: `actual_complexity_score` persisted with `recommended_workflow: standard`, `.metta.yaml` `workflow` updated to `standard`, `stories` and `spec` artifacts marked `pending` in artifact list, directive string `Post-impl upscale accepted.` present in stdout, exit code 0. Add a second sub-test for the decline path (`n`): asserts `actual_complexity_score` persisted, workflow unchanged, warning string present in stderr, `stories`/`spec` not added, exit 0.
  - **Verify**: `npx vitest run tests/complexity-tracking.test.ts && npx tsc --noEmit`
  - **Done**: Accept and decline paths fully covered; `actual_complexity_score` persistence, directive output, and warning output all asserted.

- [ ] **Task 5.4: Integration test -- --auto flag propagates across all three prompt sites**
  - **Depends on**: Task 5.1, Task 5.2, Task 5.3
  - **Files**: `tests/complexity-tracking.test.ts`
  - **Action**: Add an integration test that creates a change with `--auto`, runs `metta complete intent` (triggering both downscale and upscale conditions across separate sub-tests), and runs `metta complete implementation` (triggering post-impl upscale). For each site assert: no interactive prompt is printed, auto-accept banner present in stderr (`Auto-accepting recommendation:`), yes path is taken (workflow updated, artifacts mutated as appropriate), exit code 0. Also assert that `--accept-recommended` alias produces identical behavior to `--auto`.
  - **Verify**: `npx vitest run tests/complexity-tracking.test.ts && npx tsc --noEmit`
  - **Done**: All three auto-accept paths covered in a single coherent test run; no prompt printed; banner emitted; state mutations confirmed; `tsc --noEmit` exits 0.
