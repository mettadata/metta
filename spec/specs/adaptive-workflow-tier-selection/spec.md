# Adaptive Workflow Tier Selection

**Source:** `src/complexity/scorer.ts`, `src/complexity/file-count-parser.ts`, `src/complexity/renderer.ts`
**Consumers:** `src/cli/commands/complete.ts`, `src/cli/commands/status.ts`, `src/cli/commands/instructions.ts`
**Schema:** `src/schemas/change-metadata.ts` (`ComplexityScoreSchema`, `ChangeMetadataSchema`)
**Tests:** `tests/complexity-file-count-parser.test.ts`, `tests/complexity-scorer.test.ts`, `tests/complexity-renderer.test.ts`, `tests/complexity-tracking.test.ts`
**RFC 2119 Keywords:** MUST, MUST NOT, SHOULD, MAY

---

## Purpose

Adaptive Workflow Tier Selection is the scoring and prompting capability that estimates the scope of a change immediately after intent is authored, persists that estimate in change metadata, and surfaces advisory and interactive prompts that let the user (or an `--auto` flag) adjust the chosen workflow up or down so the framework's fan-out matches the real blast radius of the change. It exists to eliminate two symmetric failure modes in fixed-fan-out workflows: wasted tokens on trivial changes that run full review fan-outs, and missing planning artifacts on changes that outgrew their chosen workflow. The capability is print-only by default (an advisory banner) and only mutates state when the user (or `--auto`) accepts a prompt.

---

## Scoring Signal (v1)

The v1 signal set contains a single input: the **file count**, derived from markdown parsing of the change's own artifacts.

**Pre-implementation (intent time).** The file count is parsed from the `## Impact` section of `intent.md`. The parser walks the mdast, locates the first H2 whose text is exactly `Impact`, collects every `inlineCode` node in the section body, filters them through an extension-anchored (`.ts`, `.yaml`, `.yml`, `.md`, `.js`, `.jsx`, `.tsx`, `.go`, `.py`, `.rs`, `.sh`, `.json`, `.toml`) or prefix-anchored (`src/`, `tests/`, `dist/`, `.metta/`, `spec/`) discriminator, deduplicates the tokens by exact string, and returns the count. When the `## Impact` heading is entirely absent the scorer MUST return `null` so callers can distinguish "intent not authored" from "intent authored but impact empty"; when the heading exists but the filtered set is empty the scorer returns a zero-file score (tier `trivial`).

**Post-implementation (implementation-complete recompute).** The file count is re-parsed from the `## Files` section of `summary.md` using the identical parser. The recomputed score is written to a parallel metadata field and MUST NOT overwrite the original intent-time score.

Logic lives in `parseFileCountFromSection` (`src/complexity/file-count-parser.ts`) and the two thin wrappers `scoreFromIntentImpact` and `scoreFromSummaryFiles` (`src/complexity/scorer.ts`).

---

## Tier Thresholds

The tier mapping is the single authoritative definition of the adaptive-workflow boundaries and is encoded in exactly one function: `tierFromFileCount` in `src/complexity/scorer.ts`. No other file in the codebase duplicates these boundaries.

| Tier     | File count   | Numeric score |
|----------|--------------|---------------|
| trivial  | <= 1 file    | 0             |
| quick    | 2-3 files    | 1             |
| standard | 4-7 files    | 2             |
| full     | 8+ files     | 3             |

Boundary cases (encoded directly by `tierFromFileCount`):

- `n == 0` -> `trivial`
- `n == 1` -> `trivial`
- `n == 2` -> `quick`
- `n == 3` -> `quick`
- `n == 4` -> `standard`
- `n == 7` -> `standard`
- `n == 8` -> `full`

The numeric `score` field on the persisted `ComplexityScore` object mirrors this 0..3 range and is validated by Zod as an integer in `[0, 3]`.

---

## Prompt Modes

Four prompt modes are defined. All four are driven from `src/cli/commands/complete.ts` and share the `askYesNo` helper (`src/cli/helpers.ts`) and the `renderBanner` / `renderStatusLine` renderers (`src/complexity/renderer.ts`).

### intent-downscale

- **Trigger**: after `metta complete intent` during a `metta propose` or `metta fix-issues` run, when `scoreFromIntentImpact` returns a `recommended_workflow` tier strictly lower than the chosen workflow tier, and the chosen workflow is not already `quick` (quick is the smallest named interactive workflow for downscale purposes).
- **Default behavior**: print `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>? [y/N]` and wait for a yes/no answer. Default is No. On Yes the `.metta.yaml` `workflow` field is updated to the recommended tier and unstarted planning artifacts (stories, spec, research, design, tasks — any artifact whose status is not `complete`) are dropped from the artifact list. On No, the original workflow is preserved and an advisory banner is emitted to stderr.
- **Auto-accept interaction**: when `auto_accept_recommendation` is `true` in `.metta.yaml`, the interactive prompt is skipped, an auto-accept banner is printed to stderr, and the Yes path is taken. Non-TTY environments (no `process.stdin.isTTY`, or `--json`) without auto-accept take the No path.

### intent-upscale

- **Trigger**: after `metta complete intent`, when `scoreFromIntentImpact` returns a `recommended_workflow` tier strictly higher than the chosen workflow tier. **Hard cap**: when the recommended tier is `full`, the prompt MUST NOT fire; instead an advisory is emitted to stderr (`Advisory: scored full -- upscale to full is not yet supported; consider standard`).
- **Default behavior**: print `Scored as <tier> (N files) -- promote workflow to /metta-<tier>? [y/N]` and wait for a yes/no answer. Default is No. On Yes the `.metta.yaml` `workflow` field is updated to the recommended tier and missing planning stages present in the target workflow's `buildOrder` are inserted into the artifact list as `pending`. On No, the original workflow is preserved.
- **Auto-accept interaction**: when `auto_accept_recommendation` is `true`, the prompt is skipped and the Yes path is taken (with the same full-cap behavior). Non-TTY without auto-accept takes the No path.

### post-impl-upscale

- **Trigger**: after `metta complete implementation`, when `scoreFromSummaryFiles` computes a tier strictly higher than the current workflow tier. `actual_complexity_score` MUST be persisted in both the Yes and No paths, and also persisted silently when the recomputed tier is equal to or lower than the current workflow tier.
- **Default behavior**: print `Implementation touched N files -- promote to /metta-<tier> and retroactively author stories + spec? [y/N]`. Default is No. On Yes: update the `workflow` field, insert `stories` and `spec` as `pending` artifacts only if they are not already present and complete, and print to stdout: `Post-impl upscale accepted. Run: metta instructions stories --change <name>  then  metta instructions spec --change <name>. Verification resumes after both are complete.` On No: emit warning to stderr (`Warning: this change touched N files -- <tier> workflow was recommended; finalize will proceed on <chosen-tier>`) and leave `workflow` unchanged. Exit code MUST be 0 in all paths.
- **Auto-accept interaction**: when `auto_accept_recommendation` is `true`, the prompt is skipped and the Yes path is taken. Non-TTY without auto-accept takes the No path.

### intra-quick-downsize

- **Trigger**: inside the `/metta-quick` skill template, when `complexity_score.recommended_workflow === 'trivial'`. This gate fires regardless of whether the user accepted or declined an intent-time downscale; a user who stays on `quick` with a trivial-scored change still benefits from the reduced fan-out.
- **Default behavior**: the skill reduces review and verify fan-out to exactly 1 quality reviewer and 1 tests/tsc verifier. Non-trivial `quick` runs keep the default 3-reviewer and 3-verifier fan-out. Tests and tsc MUST run on every change regardless of tier.
- **Auto-accept interaction**: this mode has no interactive prompt. `--auto` on `metta quick` continues to cover its pre-existing discovery-loop scope and is orthogonal to this fan-out gate; the trivial fan-out applies whenever the score indicates `trivial`.

---

## Storage Fields

Three optional fields extend `ChangeMetadataSchema` in `src/schemas/change-metadata.ts`. All three MUST be optional so legacy `.metta.yaml` files written before this capability was introduced continue to validate.

### complexity_score

- **Shape**: `ComplexityScoreSchema.optional()`. The `ComplexityScoreSchema` is a `z.object({ score: z.number().int().min(0).max(3), signals: z.object({ file_count: z.number().int().min(0) }).strict(), recommended_workflow: z.enum(['trivial', 'quick', 'standard', 'full']) }).strict()`.
- **Written**: once, at intent-authoring time, by `src/cli/commands/complete.ts` after `markArtifact('intent', 'complete')`. The write is guarded by `isScorePresent(metadata)` so the field is never overwritten by a later intent edit or reinvocation.
- **Read**: by `metta status` (both human and `--json`), by `metta instructions` (for the advisory banner), and by `metta complete` itself (to decide which prompt mode to fire). All read paths tolerate absence.

### actual_complexity_score

- **Shape**: `ComplexityScoreSchema.optional()` — identical shape to `complexity_score`.
- **Written**: once, at `metta complete implementation` time, by `src/cli/commands/complete.ts` after `markArtifact('implementation', 'complete')` and after `scoreFromSummaryFiles(summaryMd)` is invoked. This field MUST NOT overwrite `complexity_score`; the two coexist as parallel fields. It is persisted in all paths (Yes, No, non-TTY, auto-accept, and silent-equal-or-lower).
- **Read**: by `metta status --json` as a top-level field on the change payload (or `null` when absent); surfaced in status human output as part of the complexity line when present.

### auto_accept_recommendation

- **Shape**: `z.boolean().optional()` (defaults conceptually to `false` when absent; the schema treats `undefined` as falsy without emitting a default on write).
- **Written**: by `ArtifactStore.createChange` when `metta propose`, `metta quick`, or `metta fix-issues` is invoked with `--auto` or its alias `--accept-recommended`. The field is persisted in `.metta.yaml` as `true` in that case, and omitted otherwise.
- **Read**: by `src/cli/commands/complete.ts` at every adaptive-routing prompt site (intent-downscale, intent-upscale, post-impl-upscale). When `true`, the interactive prompt is bypassed and the Yes path is taken; an auto-accept banner is printed to stderr so the record is visible.

A fourth field, `workflow_locked: z.boolean().optional()`, is set to `true` by `ArtifactStore.createChange` when `--workflow <tier>` is explicitly provided. It is not consumed by the prompt modes in v1 but is reserved for future policy that may suppress auto-upscale when the user has explicitly locked a workflow.

---

## Extension Points

This capability was scoped intentionally narrow for v1. The following are named here as planned-but-not-yet-implemented extension points. A future contributor adding any of these MUST extend `ComplexityScoreSchema.signals` in `src/schemas/change-metadata.ts`, extend the scoring logic in `src/complexity/scorer.ts` (and the relevant parser module), and update this rubric doc to record the new boundary rules.

### Deferred signals

- **spec-surface** — counting changes to public API or spec-surface area (e.g. capabilities added, contract changes in `spec/specs/*/spec.md`) as a complexity input alongside file count. Deferred because the intent-time signal is not yet rich enough to characterize surface impact reliably.
- **capability-count** — counting the number of `spec/specs/` capability folders touched by a change as a complexity input. Deferred because intent.md does not yet cross-reference capability folders directly and would require a new parser.
- **line-delta** — using estimated (intent-time) or actual (summary-time) line-counts as a scoring signal beyond file count. Deferred because v1 file count already provides sufficient discrimination for the trivial/quick/standard/full bands.

### Deferred retroactive artifacts

The post-impl-upscale Yes path currently retroactively inserts only `stories` and `spec` artifacts. The following are deferred and MUST NOT be produced by the retroactive path in v1:

- **research** — retroactive authoring of `research.md`. Deferred because research is a pre-implementation investigation artifact; retroactive authoring would be speculative.
- **design** — retroactive authoring of `design.md`. Deferred for the same reason as research: design is a forward-looking artifact and retroactive authoring would misrepresent the decision timeline.
- **tasks** — retroactive authoring of `tasks.md`. Deferred because tasks are a planning artifact whose value is in-flight execution; retroactive tasks would duplicate what `summary.md` already records.

### Extension mechanism

A future contributor adding a new signal or retroactive artifact MUST:

1. Extend `ComplexityScoreSchema.signals` in `src/schemas/change-metadata.ts` with the new signal field (e.g. `spec_surface_count: z.number().int().min(0)`), keeping all new fields as additive so existing metadata continues to validate.
2. Extend the scorer in `src/complexity/scorer.ts` — either by adding a new parser module alongside `src/complexity/file-count-parser.ts` and invoking it from `scoreFromIntentImpact` / `scoreFromSummaryFiles`, or by introducing a new top-level scoring function.
3. Revisit `tierFromFileCount` — if combining signals, introduce a `tierFromSignals(signals)` replacement and deprecate the single-signal function, keeping the 0..3 numeric output stable.
4. Update this rubric doc under a new `## Scoring Signal (vN)` section and add the new signal to the Extension Points section as "implemented in vN".
5. Update the renderer in `src/complexity/renderer.ts` only if the new signal should surface in the advisory banner or status line text; otherwise the renderer remains untouched and the new signal is exposed only in the `--json` status output via the schema.
