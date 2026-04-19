# Code Review: adaptive-workflow-tier-selection-emit-complexity-score-after (quality)

## Verdict

PASS_WITH_WARNINGS (0 critical, 5 warnings, 7 suggestions)

The capability is well-structured, the parser is careful, the scorer is the single authoritative source for the tier threshold (as the rubric requires), and tests exercise every branch via real CLI integration. The main concerns are (a) a small but real spec-compliance gap (the downscale-suppression-on-quick guarantee from `AutoDownscalePromptAtIntent` is not enforced in code), (b) triplicated tier-rank tables that are neither centralised nor imported from the authoritative module, and (c) redundancy in `renderStatusLine`'s output format.

## Findings

### Warnings (should fix)

1. **Spec gap: downscale does fire when chosen workflow is `quick`** — `src/cli/commands/complete.ts:185`
   The rubric at `spec/specs/adaptive-workflow-tier-selection/spec.md:60` and the change spec `AutoDownscalePromptAtIntent` explicitly state:
   > "The downscale prompt MUST NOT fire for `/metta-quick` runs because quick is already the smallest named interactive workflow."
   The code only gates on `recRank < chosenRank`. For `currentWorkflow === 'quick'` (rank 1) with `recommendedTier === 'trivial'` (rank 0) this guard is satisfied, so a downscale prompt to `/metta-trivial` *will* fire, contradicting the spec. Add an early-return when `currentWorkflow === 'quick'` in the downscale branch (or document that `trivial` is treated as an interactive tier and update the spec accordingly — either direction resolves the mismatch). No integration test covers this case.

2. **Tier-rank mapping duplicated across three modules** — `src/complexity/renderer.ts:6-11`, `src/cli/commands/complete.ts:15-20`, `src/complexity/scorer.ts:9-14`
   `{ trivial: 0, quick: 1, standard: 2, full: 3 }` is redeclared as `TIER_ORDER`, `TIER_RANK`, and `TIER_SCORE` respectively. If the authoritative threshold lives in `scorer.ts` (per the rubric), then the rank lookup should be exported from there (e.g. `export const TIER_RANK` and `export function tierRank(name: string): number`) and consumed by the other two. The review brief called tier-comparison centralisation out as a specific focus area, and this is the largest concentration of drift risk in the change.

3. **`Tier` type alias duplicated** — `src/complexity/renderer.ts:4` and `src/complexity/scorer.ts:7`
   `renderer.ts` declares a local `type Tier` instead of `import type { Tier } from './scorer.js'`. Same shape, same 4-member union, no reason to duplicate. Fixes land naturally when (2) is addressed.

4. **`renderStatusLine` format renders the recommended tier twice** — `src/complexity/renderer.ts:59-68`
   Output is literally `Complexity: <recommended> (N file[s]) -- recommended: <recommended>`, because the function only receives `score` (not the current workflow). The rubric format `Complexity: <tier> (N file[s]) -- recommended: <workflow>` is ambiguous about whether the first `<tier>` should be the chosen or the recommended one, and the test only asserts the recommended value is there. Consider either accepting a `currentWorkflow` parameter (mirroring `renderBanner`) and rendering `<current>` first to surface the disagreement clearly, or trimming the redundant "-- recommended: <workflow>" suffix to just `Complexity: <recommended> (N file[s])`. As shipped, the output carries the same token twice with no new information.

5. **Scorer's inner mdast helper is duplicated from the parser module** — `src/complexity/scorer.ts:35-42` and `src/complexity/file-count-parser.ts:29-36`
   `extractText` exists with identical implementation in both files. The scorer uses it only inside `hasH2Heading`. Either export `extractText` from `file-count-parser.ts` (and `getHeadingText` as well), or move `hasH2Heading` into the parser module alongside the other mdast walkers. Today the two files walk the same mdast shape with their own copies of the same helper.

### Suggestions (nice to have)

1. **Consider consolidating `hasH2Heading` and `parseFileCountFromSection` into one pass** — `src/complexity/file-count-parser.ts` and `src/complexity/scorer.ts:78-94`
   Each call to `scoreFromIntentImpact` / `scoreFromSummaryFiles` parses the markdown via `unified().use(remarkParse).parse` twice — once in `hasH2Heading`, once in `parseFileCountFromSection`. For the intent / summary sizes we handle that is cheap, but a single function returning `{ headingExists: boolean; fileCount: number }` would halve the parse work and remove the interleaved null-vs-zero special case.

2. **`Complexity: not yet scored` empty-state is only rendered in status, not in instructions** — `src/cli/commands/status.ts:111` vs `src/cli/commands/instructions.ts:38-41`
   Consistent with the spec (banner must be suppressed when the score is absent), but it does mean a new user reading `metta instructions` output before writing intent gets no hint that a score is pending. Not a defect, but worth considering a dim one-line hint symmetric to status.

3. **Prompt references a skill path (`/metta-trivial`) that does not exist** — `src/cli/commands/complete.ts:201,277`
   `src/templates/skills/` has no `metta-trivial` subdir (only quick/standard/propose/auto etc.). The user-visible prompt `collapse workflow to /metta-trivial?` is verbatim from the rubric and matches tests, but no skill maps to it. Either add a `metta-trivial` skill or document the trivial workflow as a metadata-only state that downshifts inside `/metta-quick`. This is a design ambiguity that's going to surface again on first use.

4. **`STUB_MARKERS` now duplicates known artifact IDs as string literals** — `src/cli/commands/complete.ts:38-42`
   Unrelated to this change but noticed while reading. Each time a new artifact type is added, this list has to be updated by hand. Deriving it from the union of workflow artifact IDs would remove the drift risk.

5. **`DROPPABLE_PLANNING_ARTIFACTS` lives alongside `STUB_MARKERS` in `complete.ts`** — `src/cli/commands/complete.ts:28-32`
   Belongs closer to the workflow engine or a dedicated `adaptive` module since it's semantic policy ("which stages are safe to drop on downscale"). Today it is a magic set literal inside the `complete` command.

6. **Empty `catch {}` on adaptive-scoring is too broad** — `src/cli/commands/complete.ts:319-321,422-424`
   The comment says "advisory-only and must not block the complete command" — fair, but swallowing every error (including programmer errors like a bad import path) silently makes debugging adaptive-routing regressions painful. Consider logging the caught error to stderr behind a `MEBBA_DEBUG` env check, or narrowing the catch to known Zod / fs errors.

7. **Integration-test file is a single 500-line module mixing unrelated parsers** — `tests/complexity-tracking.test.ts`
   The file mixes `parseComplexityTracking` (constitution parser) with the adaptive-workflow CLI integration tests. The `describe('adaptive-workflow integration', ...)` block is 300+ lines and really wants its own file (e.g. `tests/adaptive-workflow-integration.test.ts`) for discoverability and to respect the near-1:1 test-to-source file ratio called out in the project conventions.

## Recommendations

**Before ship.** Address warning (1): either add the `currentWorkflow === 'quick'` guard in the intent-downscale branch and a test case, or update both the rubric and the change spec to drop the "MUST NOT fire" rule. The code/spec mismatch is small but the spec uses RFC-2119 MUST — it has to be reconciled.

**Soon after ship.** Consolidate the tier-rank mapping per warning (2), remove the duplicated `Tier` type per warning (3), and decide whether the status-line format should display the chosen tier or drop the redundant trailing "recommended:" per warning (4).

**Opportunistic.** Merge `hasH2Heading` into the file-count parser module (warning 5), split the integration tests into their own file (suggestion 7), and reconsider the silent `catch {}` blocks in `complete.ts` (suggestion 6).

Nothing here is blocking merge, but warnings 1-3 are quick fixes and are the kind of drift that's easy to resolve now and expensive to resolve later once new signals and new prompt modes start adding to the scorer.
