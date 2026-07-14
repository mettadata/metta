# Design: enforce-workflow-tier-routing-so-ceremony-actually-scales

## Approach

This design follows research.md's selected approach exactly: a one-line conditional default flip on the existing `askYesNo` call at `complete.ts:246`, a co-located escalation write inside the same intent-scoring block (no new `ArtifactStore` method), a new sibling helper to `git-log-timings.ts` for ceremony-ratio computation, and an unnumbered routing pre-step section in `metta-propose/SKILL.md` placed above `## Steps` rather than renumbering. None of research's decisions are relitigated.

`AutoDownscalePromptAtIntent` (US-1) and `EscalationSchema`/`EscalationRecording` (US-2) are two faces of one change: flipping the default from No to Yes when `workflow_locked !== true` makes downscaling the silent path, and recording an `escalation` object whenever the decision keeps the change above its scored recommendation makes staying heavy the auditable path. `StatusEscalationSurface` (US-3) is a pure read/render addition against the new schema field. `SkillRoutingPreStep` and `EscalationJustificationGuidance` (US-4) push the same bias upstream into the orchestrator's routing decision, as documentation-only template edits. `ProgressCeremonyRatioMetric` and `ProgressArtifactsPerSmallChangeMetric` (US-5, US-6) close the loop, reusing `spec/archive/`'s retained `workflow` field and one repo-wide `git log` pass.

Together these enforce tier routing at every lifecycle point where ceremony compounds: skill-level bias before a change exists, CLI-level bias at intent completion, a permanent record when the bias is overridden, and a project-level feedback signal verifying the policy works over time.

## Components

**`complete.ts`** (`AutoDownscalePromptAtIntent`, `EscalationRecording`) — in the downscale branch (lines 222-290): (1) line 246 `defaultYes: false` becomes `defaultYes: currentMetadata.workflow_locked !== true`, satisfying both interactive-suffix display and non-interactive resolution via `askYesNo`'s existing logic (`helpers.ts:286-289`, `293-296`); sibling upscale calls (lines 317-323, 415-420) keep `defaultYes: false` unconditionally. (2) When the decision resolves No (or `workflow_locked` suppressed it), compose `{ escalation: { from_tier: recommendedTier, to_tier: currentWorkflow, justification: <canned string>, timestamp: new Date().toISOString() } }` into the same `ctx.artifactStore.updateChange` call already used at lines 277-280/342-345. Remains inside the existing `try/catch` (line 361) so it stays advisory-only.

**`helpers.ts`** — no code change; `askYesNo` (282-315) already implements the full default/suffix matrix once callers pass the correct `defaultYes`.

**`change-metadata.ts`** (`EscalationSchema`) — add `EscalationSchema` (see Data Model) and `escalation: EscalationSchema.optional()` alongside the other optional fields in `ChangeMetadataSchema` (47-63); export the inferred `Escalation` type near line 65.

**`artifact-store.ts`** — no code change. `updateChange` (80-88) already merges-and-revalidates via `state.write`; the schema addition alone satisfies `EscalationSchema`'s presence/absence scenarios for `getChange`/`updateChange`.

**`status.ts`** (`StatusEscalationSurface`) — `toChangeJson` (84-91) already spreads `...metadata`, so `escalation` flows into `--json` with no code change beyond the schema. `printChangeStatus` (93-139) gains a block after the token-totals block (ends 126) and before iteration-counters (starts 128): prints `Escalation: <from> -> <to> (<justification>)` when `metadata.escalation` is present.

**`src/util/ceremony-metrics.ts`** (new, sibling to `git-log-timings.ts`) (`ProgressCeremonyRatioMetric`, `ProgressArtifactsPerSmallChangeMetric`) — two functions using the same never-throw `execFileAsync` pattern (`git-log-timings.ts:1-4, 20-35`):
- `getCeremonyCommitRatio(projectRoot)` — `git log --format=%s` (no path filter), classifies subjects by conventional-commit prefix, returns `{ ceremony, total, ratio }` or `null` only on git failure.
- `getArtifactsPerSmallChange(specDir)` — reads `spec/archive/*/.metta.yaml`, filters `workflow === 'quick' || workflow === 'trivial'`, averages `Object.keys(artifacts).length`; returns `null` (not `0`) when the filtered set is empty.

**`progress.ts`** — imports both alongside the existing `getGitLogTimings` import (line 6), calls both once near the top of the action handler, adds two fields to the `--json` payload (alongside `active`/`completed`/`summary`, lines 62-84) and two lines to the human summary block (after line 153).

**`src/templates/skills/metta-propose/SKILL.md`** (`SkillRoutingPreStep`, `EscalationJustificationGuidance`) — insert an unnumbered `## Routing pre-step (run before Step 1)` section directly above `## Steps` (line 14), avoiding renumbering of ~10 "Step N" cross-references (e.g. lines 92, 97). Classifies the description against small/bounded criteria and, absent an explicit `--workflow` flag, directs the orchestrator to `metta quick` instead of continuing to Step 1; also documents that explicit `--workflow standard`/`--workflow full` requires a recorded justification. **Must be applied identically to `.claude/skills/metta-propose/SKILL.md`** (see Risks).

**`CLAUDE.md`** — Metta Workflow section gains the same default-routing/justification statement, regenerated via `/metta-refresh` conventions, not hand-edited.

## Data Model

```
EscalationSchema = z.object({
  from_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  to_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  justification: z.string().min(1),
  timestamp: z.string().datetime(),
}).strict()

// ChangeMetadataSchema gains:
escalation: EscalationSchema.optional()
```

`from_tier`/`to_tier` reuse the tier enum already used by `ComplexityScoreSchema.recommended_workflow` (`change-metadata.ts:28`), not a generic string. `timestamp` uses `z.string().datetime()` for consistency with `created` (line 49), populated via `new Date().toISOString()`.

Canned justification strings (non-empty, keyed by cause per research):
- `workflow_locked === true` suppressed the Yes default: `"kept ${to_tier}: workflow_locked"`
- unlocked prompt resolved No (non-TTY/`--json`/auto-off or interactive decline): `"kept ${to_tier}: declined downscale"`. Exact wording is a planner-level implementation detail; only non-emptiness is contractual.

`metta progress --json` gains two top-level fields:
```
ceremony_commit_ratio: { ceremony: number; total: number; ratio: number } | null
artifacts_per_small_change: { mean: number; sample_size: number } | null
```
`null` renders as the explicit no-data indicator in both JSON and human output — never a bare `0`.

## API Design

**`metta status` human output** — new line after the token/iteration block, only when `metadata.escalation` is present: `Escalation: quick -> standard (kept standard: workflow_locked)`.

**`metta status --json`** — `escalation` appears verbatim as a top-level field (via the existing `...metadata` spread) when present; absent entirely (not `null`) when not present — unlike `complexity_score`/`actual_complexity_score`, which are explicitly normalized to `null`, `escalation` has no such requirement in spec.

**`metta progress` human output** — two new summary lines, e.g. `Ceremony commits: 34% (534/1569 chore/docs)` and `Artifacts per small change: 3.2 (avg over 12 quick/trivial changes)` or `Artifacts per small change: no data`.

**`metta progress --json`** — adds `ceremony_commit_ratio` and `artifacts_per_small_change` per Data Model.

**Interactive prompt wording** — unchanged: `Scored as <tier> (N files) -- collapse workflow to /metta-<tier>?`; only the suffix and non-interactive resolution change:

| workflow_locked | Interactive | Non-interactive (no TTY / `--json` / auto off) |
|---|---|---|
| `!== true` | `[Y/n]`, empty -> Yes | resolves Yes, no prompt printed |
| `=== true` | `[y/N]`, empty -> No | resolves No, no prompt printed |

`auto_accept_recommendation: true` continues to bypass the prompt and auto-select Yes regardless of `workflow_locked` (existing branch, `complete.ts:228-238`, unchanged).

## Dependencies

Internal only — no new npm packages. `ceremony-metrics.ts` uses `node:child_process`/`node:util`, already used by `git-log-timings.ts`, plus `node:fs/promises`, already used in `progress.ts`/`artifact-store.ts`. No `package.json` change.

## Risks & Mitigations

**(a) Non-interactive callers relying on keep-current-tier.** Automation that ran `metta complete intent` non-interactively expecting the heavier tier to persist will now see it auto-downscale when unlocked. This is the intended spec-mandated change (`AutoDownscalePromptAtIntent`); `EscalationRecording` and `StatusEscalationSurface` give visibility, and callers needing the old behavior get it by passing `--workflow` explicitly (sets `workflow_locked: true`, restores the No default). No opt-out flag is introduced, per Out of Scope.

**(b) Ceremony-ratio misclassification.** Precise rule: a commit is ceremony iff its subject matches `^(chore|docs)(\(.+\))?:` (lowercase conventional-commit type, optional scope). Merge commits (`Merge ...` subjects) do not match this prefix and are counted in `total` but not the ceremony numerator — they land in "functional/other," the simplest defensible rule, avoiding a second special case. Subjects with no recognized type prefix are likewise counted in `total` only. Document this explicitly in the implementation to prevent a future reader from treating merges as ceremony.

**(c) Template/deployed skill copy drift.** `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` are asserted byte-identical by `tests/grounding.test.ts:34-38` and `tests/skill-discovery-loop.test.ts:71-75`. The routing pre-step and justification text must land in both files in the same task/commit; verify via the existing byte-identity tests, not a manual diff.
