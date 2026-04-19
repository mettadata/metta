# Design: adaptive-workflow-tier-selection-emit-complexity-score-after

## Approach

A single `src/complexity/` module — composed of three pure sub-modules (`scorer.ts`, `file-count-parser.ts`, `renderer.ts`) plus a barrel `index.ts` — is introduced as the complete complexity reasoning surface. The scorer and renderer are invoked at three prompt sites inside `src/cli/commands/complete.ts`: after `markArtifact('intent', 'complete')` for intent-time downscale and upscale, and after `markArtifact('implementation', 'complete')` for post-implementation upscale. A shared `askYesNo` helper in `src/cli/helpers.ts` handles TTY detection and prompt I/O across all three sites. The `--auto` / `--accept-recommended` flag is added to `metta propose`, `metta quick`, and `metta fix-issues` via Commander and persisted as `auto_accept_recommendation: boolean` in the `ChangeMetadataSchema` Zod extension, which also gains `complexity_score` and `actual_complexity_score` optional fields. Workflow collapse and promotion use the YAML-driven diff path: `workflowEngine.loadWorkflow(targetTier, searchPaths)` is called to load the target graph, the artifact map is reconstructed from `buildOrder` carrying forward existing statuses, and `updateChange` writes the result atomically before the existing git auto-commit block. Post-implementation retro-generation (stories + spec) is delegated to the skill layer via a CLI directive printed to stdout after state mutation; the CLI does not spawn agents directly. All three new schema fields are declared explicitly on `ChangeMetadataSchema` — `.strict()` is preserved with the new optional fields added rather than relaxing to `.passthrough()`.

## Components

- **`src/complexity/file-count-parser.ts`** (NEW): Pure remark AST walker. Accepts markdown source and a section-heading label. Walks `tree.children`, locates the target heading, collects `inlineCode` nodes in the section body, applies an extension-anchored or prefix-anchored file-path discriminator (`.ts`, `.yaml`, `.md`, `.js`, `.go`, `.py`, `.rs`, `.sh`, `.json`, `.toml`; or prefix `src/`, `tests/`, `dist/`, `.metta/`), deduplicates by exact string value, and returns the count. Returns 0 when the heading is absent or no matching nodes are found — graceful-zero degradation for advisory-only use. Zero new dependencies; uses the existing `unified().use(remarkParse)` import chain.

- **`src/complexity/scorer.ts`** (NEW): Pure functions `scoreFromIntentImpact(intentMd)`, `scoreFromSummaryFiles(summaryMd)`, `tierFromFileCount(n)`, and `isScorePresent(metadata)`. The two score functions delegate to `file-count-parser.ts` with different heading labels (`## Impact` and `## Files` respectively). `tierFromFileCount` encodes the canonical tier thresholds in one authoritative location: trivial (<=1), quick (2-3), standard (4-7), full (>=8). Returns `ComplexityScore | null`. No I/O.

- **`src/complexity/renderer.ts`** (NEW): Pure functions `renderBanner(score, currentWorkflow)` and `renderStatusLine(score)`. Returns an empty string when `score` is null or undefined, centralizing null-guard logic. Uses the existing `color()` helper from `src/cli/helpers.ts` for ANSI formatting, consistent with `agentBanner` and `banner` patterns. `renderBanner` produces the advisory line for `metta instructions` stderr. `renderStatusLine` produces the `Complexity:` line for `metta status` human mode.

- **`src/complexity/index.ts`** (NEW): Barrel re-export of all public symbols from the three sub-modules.

- **`src/cli/helpers.ts`** (MODIFIED): Add `askYesNo(question: string, opts?: { defaultYes?: boolean; jsonMode?: boolean }): Promise<boolean>`. Extracts and generalizes the `readline.createInterface` pattern already present in `install.ts`. Returns the `defaultYes` value immediately when `!process.stdin.isTTY || opts?.jsonMode`, so CI environments never hang.

- **`src/schemas/change-metadata.ts`** (MODIFIED): Extend `ChangeMetadataSchema` with three new explicitly declared optional fields: `complexity_score: ComplexityScoreSchema.optional()`, `actual_complexity_score: ComplexityScoreSchema.optional()`, and `auto_accept_recommendation: z.boolean().optional().default(false)`. Also add `workflow_locked: z.boolean().optional()` to suppress prompts when `--workflow` was set without `--auto`. `.strict()` is preserved; fields are added explicitly.

- **`src/cli/commands/propose.ts`** (MODIFIED): Add `--auto` Commander option with `--accept-recommended` alias. Pass `autoAccept: boolean` to `ArtifactStore.createChange`.

- **`src/cli/commands/quick.ts`** (MODIFIED): Same `--auto` / `--accept-recommended` option and plumbing as `propose.ts`.

- **`src/cli/commands/fix-issue.ts`** (MODIFIED): Same `--auto` / `--accept-recommended` option and plumbing as `propose.ts`.

- **`src/artifacts/artifact-store.ts`** (MODIFIED): `createChange` accepts a new optional `autoAccept?: boolean` parameter. When true, persists `auto_accept_recommendation: true` in `.metta.yaml`. When `--workflow` is explicitly set, also persists `workflow_locked: true`.

- **`src/cli/commands/complete.ts`** (MODIFIED): Three prompt insertion sites added:
  1. After `markArtifact('intent', 'complete')` — intent-time downscale: call `scoreFromIntentImpact`, persist `complexity_score`, compare recommended tier to current workflow; if recommendation is lower and current workflow is not `quick`, fire `askYesNo` (default No) unless `auto_accept_recommendation`; on Yes, load target workflow YAML, reconstruct artifact map from `buildOrder`, call `updateChange`.
  2. After the downscale block at the same intent site — intent-time upscale: if recommendation is higher, fire `askYesNo` (default No); on Yes, load target workflow YAML, diff artifact IDs against existing map, insert missing stages as `pending`, call `updateChange`. Cap auto-upscale at `standard` in v1; if recommendation is `full`, emit advisory to stderr but do not prompt to promote to `full`.
  3. After `markArtifact('implementation', 'complete')` — post-implementation upscale: call `scoreFromSummaryFiles`, persist `actual_complexity_score`; if recomputed tier exceeds current workflow, fire `askYesNo` (default No); on Yes, update `workflow`, insert `stories` and `spec` as `pending` artifacts (skip if already present), print directive to stdout for the skill layer; on No, print warning to stderr. Exit 0 in all paths.

- **`src/cli/commands/status.ts`** (MODIFIED): Human output calls `renderStatusLine(score)` to produce the `Complexity:` line. JSON output includes `complexity_score` and `actual_complexity_score` fields (or `null` when absent). Exits 0 in all cases.

- **`src/cli/commands/instructions.ts`** (MODIFIED): Before JSON stdout output, calls `renderBanner(score, currentWorkflow)` and writes result to `process.stderr` so `--json` stdout stays machine-readable.

- **`src/templates/skills/metta-quick/SKILL.md`** (MODIFIED): Trivial-detection gate section extended: checks `recommended_workflow === 'trivial'` and reduces fan-out to 1 quality reviewer + 1 tests/tsc verifier. Documentation note added explaining that `--auto` now also auto-accepts adaptive routing recommendations in addition to its existing discovery-loop scope.

- **`src/templates/skills/metta-propose/SKILL.md`** (MODIFIED): Documentation-only update noting that `--auto` now covers adaptive routing recommendations. No template logic changes.

- **`spec/specs/adaptive-workflow-tier-selection/spec.md`** (NEW): Rubric document covering: v1 scoring signal (file count from `## Impact`), four tier thresholds with exact boundary values, four prompt modes and their trigger conditions, three storage field names and Zod schema shapes, and explicit extension points for deferred signals (spec-surface, capability-count, line-delta) and deferred retroactive artifacts (research, design, tasks).

## Data Model

```typescript
const ComplexityScoreSchema = z.object({
  score: z.number().int().min(0).max(3),
  signals: z.object({ file_count: z.number().int().min(0) }),
  recommended_workflow: z.enum(['trivial', 'quick', 'standard', 'full']),
})

// ChangeMetadataSchema extension (explicit declarations, .strict() preserved):
complexity_score: ComplexityScoreSchema.optional(),
actual_complexity_score: ComplexityScoreSchema.optional(),
auto_accept_recommendation: z.boolean().optional().default(false),
workflow_locked: z.boolean().optional(),
```

The `complexity_score` field is written once at intent-complete time and frozen; it is never overwritten by subsequent operations. The `actual_complexity_score` field is written at implementation-complete time via `scoreFromSummaryFiles` and coexists with `complexity_score` as an independent parallel field. The `auto_accept_recommendation` field defaults to `false` on all legacy `.metta.yaml` files and parses without error. All four fields are optional so that pre-existing change metadata remains valid through the existing Zod validation path in `ArtifactStore`.

## API Design

New and changed function signatures:

```typescript
// src/complexity/file-count-parser.ts
function parseFileCountFromSection(markdownSource: string, sectionHeading: string): number

// src/complexity/scorer.ts
function scoreFromIntentImpact(intentMd: string): ComplexityScore | null
function scoreFromSummaryFiles(summaryMd: string): ComplexityScore | null
function tierFromFileCount(n: number): 'trivial' | 'quick' | 'standard' | 'full'
function isScorePresent(metadata: ChangeMetadata): boolean

// src/complexity/renderer.ts
function renderBanner(score: ComplexityScore | null | undefined, currentWorkflow: string): string
function renderStatusLine(score: ComplexityScore | null | undefined): string

// src/cli/helpers.ts
function askYesNo(
  question: string,
  opts?: { defaultYes?: boolean; jsonMode?: boolean }
): Promise<boolean>

// src/artifacts/artifact-store.ts
function createChange(
  description: string,
  workflow: string,
  artifactIds: string[],
  baseVersions: Record<string, string>,
  autoAccept?: boolean
): Promise<ChangeName>
```

CLI flag additions (Commander):
```
metta propose "<desc>" [--workflow <tier>] [--auto | --accept-recommended]
metta quick "<desc>"   [--workflow <tier>] [--auto | --accept-recommended]
metta fix-issues       [--workflow <tier>] [--auto | --accept-recommended]
```

Directive output on post-implementation upscale accept (stdout, exact format):
```
Post-impl upscale accepted. Run: metta instructions stories --change <name>  then  metta instructions spec --change <name>. Verification resumes after both are complete.
```

Auto-accept banner (stderr, printed before skipping any prompt):
```
Auto-accepting recommendation: <direction> to /metta-<tier> (was <current>, scored <recommended>)
```

## Dependencies

**Internal (all already present):**
- `workflow-engine` (`WorkflowEngine.loadWorkflow`) — used by the YAML-diff mechanism at all three prompt sites in `complete.ts`
- `artifact-store` (`ArtifactStore.updateChange`, `createChange`) — state mutation path for all tier transitions
- `remark-parse` / `unified` — already project dependencies (`remark-parse: ^11.0.0`, `unified: ^11.0.5`); used by `file-count-parser.ts` following the pattern in `spec-parser.ts` and `stories-parser.ts`
- `node:readline` — Node.js built-in; already used in `install.ts` for the existing `askYesNo` pattern being extracted to `helpers.ts`
- `src/cli/helpers.ts` — existing module receiving the `askYesNo` addition

**External (none new):**
No new runtime dependencies are introduced. All scoring, parsing, rendering, and prompt I/O is implemented with the project's existing dependency set.

## Risks & Mitigations

**R1 — `full` workflow template files missing.** The `full-workflow-references-missing-template-files-domain-resea` issue documents that `full.yaml` references stage templates that do not yet exist. An auto-upscale to `full` would leave the change in an unrunnable state.
_Mitigation:_ Cap auto-upscale target at `standard` in v1. When `recommended_workflow` is `full`, emit an advisory to stderr (`Advisory: scored full -- upscale to full is not yet supported; consider standard`) but do not fire the upscale prompt. This is a hard guard in `complete.ts`, not a user-configurable option.

**R2 — Remark parser misses file references in bare prose (no backticks).** Format C intents and any inline-code nodes that use bold or other markup instead of backticks return a file count of 0, which maps to `trivial`.
_Mitigation:_ The scorer defaults to `trivial` when `file_count` is 0, which is the conservative (non-disruptive) choice — it recommends less work rather than more. The advisory-only nature of the score means a false `trivial` result does not block any lifecycle step. Documented in the rubric as a known v1 limitation.

**R3 — Post-impl retro-gen leaves change in intermediate state if user exits after accepting but before running `metta instructions stories`.** After the CLI prints the directive and exits 0, `stories` and `spec` are marked `pending` in `.metta.yaml`. If the orchestrating skill crashes or is interrupted, those artifacts remain `pending` indefinitely.
_Mitigation:_ The `pending` state is clean and inspectable via `metta status`. Re-running `metta status` shows the pending retro-artifacts. The finalize gate (`metta finalize`) already blocks until all artifacts in the artifact list are `complete`, so the change cannot be shipped in an incomplete state. Recovery is: run the directive commands again. No corruption possible.

**R4 — Non-TTY and stdin-closed environments (CI) could hang the prompt.** If `process.stdin.isTTY` is truthy in a CI context (e.g., a pseudo-TTY wrapper), the `readline` interface will block indefinitely waiting for input.
_Mitigation:_ `askYesNo` checks `process.stdin.isTTY` first and returns `defaultYes ?? false` immediately when falsy. The `jsonMode` option additionally suppresses in `--json` mode regardless of TTY state. Both checks are applied before any `readline.createInterface` call.

**R5 — `auto_accept_recommendation: true` silently applies a scorer recommendation that is wrong for the change.** A user who passed `--auto` and gets a false-trivial score (see R2) would have the workflow collapsed without seeing a prompt.
_Mitigation:_ When auto-accepting any prompt, the CLI always prints a one-line banner to stderr: `Auto-accepting recommendation: downscale to /metta-<tier> (was <current>, scored <recommended>)`. This gives the user a visible record of every auto-accepted decision. The user can abandon the change (`metta status` shows the transition) and redo manually without `--auto`.

**R6 — Pre-implementation upscale artifacts (stories, spec) could be overwritten if post-implementation upscale also fires.** If a user accepted the intent-time upscale and stories/spec were authored, then post-implementation upscale also fires and the Yes path tries to insert them again.
_Mitigation:_ The post-implementation upscale Yes path checks whether `stories` and `spec` already exist in the artifact list with status `complete`. If present, it skips the directive for that artifact and does not re-insert them. Only `actual_complexity_score` and the `workflow` field are updated. This prevents redundant agent spawns and preserves already-authored artifacts.
