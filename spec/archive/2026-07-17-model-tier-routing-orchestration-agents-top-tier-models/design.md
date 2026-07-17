# Design: model-tier-routing-orchestration-agents-top-tier-models

## Approach

Layer model selection onto the existing instruction-generation pipeline rather than
templating agent frontmatter. `InstructionGenerator.generate()`
(`src/context/instruction-generator.ts:50-123`) already receives `params.workflow`
(the tier string threaded from `instructions.ts:68`) and the resolved `AgentDefinition`
— both inputs `resolveAgentModel` needs, so resolution is additive: one new optional
constructor/param arg (`modelsConfig`), one new emitted field (`agent.model`). Planning
agents and `reviewer`/`verifier` are a hard-coded `inherit` path, never looked up in
config — satisfying "Planning Cohort Requires Top-Tier Model" and "Safety-Net Immunity
For Reviewer And Verifier" (spec.md:44-121) structurally, not by convention. Rung-1
escalation is recorded through a new CLI touchpoint mirroring `metta iteration record`
(`src/cli/commands/iteration.ts`), keeping the "orchestrator calls a CLI command at a
skill-contract checkpoint" pattern consistent across iteration counters and model
escalations. Denominator integrity for the escalation-rate metric (US-6, spec.md:175-202)
is solved in code, not prose: `instructions.ts` itself — not the orchestrator — records
every non-inherit executor resolution, so the rate's denominator cannot silently drift
from reality even if a skill's prose contract is followed imperfectly.

## Components

- **`ModelAliasEnum`** (new, `src/schemas/project-config.ts`) — shared by config and
  escalation schemas.
- **`ModelsConfigSchema`** (new, `project-config.ts`) — optional `models` field on
  `ProjectConfigSchema` (`project-config.ts:67-85`).
- **`resolveAgentModel`** (new, `src/context/model-resolver.ts` — standalone per
  research §3 Option C, unit-testable independent of `ContextEngine`) — pure function
  called from `generate()`.
- **`InstructionGenerator.generate()`** (`instruction-generator.ts:50-123`) — gains
  `params.modelsConfig?: ModelsConfig`; `InstructionOutput.agent` gains `model`.
- **`instructions.ts`** (`src/cli/commands/instructions.ts:64-131`) — loads
  `cfg.models`, passes it to `generate()`; extends the existing best-effort metrics
  stamp block (lines 97-131) to also append a `model_runs` record; applies the
  Rung-1 escalation override before calling `generate()`.
- **`metta model-escalation record`** (new CLI command,
  `src/cli/commands/model-escalation.ts`, modeled on `iteration.ts`) — orchestrator
  touchpoint for writing `model_escalations`.
- **`ChangeMetadataSchema`** (`src/schemas/change-metadata.ts:56-73`) — gains
  `model_escalations` and `model_runs` array fields.
- **`getModelEscalationRate`** (new, `src/util/ceremony-metrics.ts`, mirrors
  `getArtifactsPerSmallChange` at lines 59-89) — feeds `progress.ts`.
- **Skill files** — `.claude/skills/metta-execute/SKILL.md` (deviation rules,
  lines 54-59, and the `Agent(subagent_type: ...)` examples, lines 36-45) and
  `.claude/skills/metta-verify/SKILL.md` fix-loop — gain pass-through and
  escalation-recording wording.

## Data Model

```ts
// src/schemas/project-config.ts
export const ModelAliasEnum = z.enum(['sonnet', 'opus', 'haiku', 'fable', 'inherit'])
export type ModelAlias = z.infer<typeof ModelAliasEnum>

export const ModelProfileEnum = z.enum(['quality', 'balanced', 'budget'])

export const ModelsConfigSchema = z.object({
  profile: ModelProfileEnum.optional(),
  executor: z.object({
    trivial: ModelAliasEnum.optional(),
    quick: ModelAliasEnum.optional(),
  }).strict().optional(),
  reviewer: z.literal('inherit').optional(),
  verifier: z.literal('inherit').optional(),
}).strict().optional()
// ProjectConfigSchema gains: models: ModelsConfigSchema
```

Only `{profile, executor, reviewer, verifier}` are representable keys — no
planning-cohort name is a valid key at all (spec.md:66-69). `reviewer`/`verifier`
accept only the literal `'inherit'`; any other value fails `z.literal` with a
field-naming Zod issue at `models.reviewer`/`models.verifier` (US-3).

**Named-profile expansion** (hard-coded map in `model-resolver.ts`, not schema
surface):

| profile | executor.trivial | executor.quick |
|---|---|---|
| `quality` | inherit | inherit |
| `balanced` | sonnet | sonnet |
| `budget` | haiku | sonnet |

`budget` reserves `haiku` for `trivial` (lowest-ambiguity work) and steps up to
`sonnet` at `quick` (more surface area, still executor-only) — a monotonic
cost/tier curve rather than uniform cheapness, so the profile itself models the
same "more tier, less discount" shape as the tier-coupled routing rule.

```ts
// src/schemas/change-metadata.ts
export const ModelEscalationSchema = z.object({
  task: z.string().min(1),
  from_model: ModelAliasEnum,
  to_model: ModelAliasEnum,
  trigger: z.enum(['stop_deviation', 'verify_fail']),
  timestamp: z.string().datetime(),
}).strict()

export const ModelRunSchema = z.object({
  task: z.string().min(1),
  model: ModelAliasEnum,
  timestamp: z.string().datetime(),
}).strict()

// ChangeMetadataSchema (change-metadata.ts:56-73) gains, both optional, both
// append-only — never `escalation` (singular, unrelated declined-downscale
// concept, change-metadata.ts:47-54):
//   model_escalations: z.array(ModelEscalationSchema).optional()
//   model_runs: z.array(ModelRunSchema).optional()
```

`model_runs` is the honest denominator: every generation call that resolves
`agent.model !== 'inherit'` for `executor` appends one record, written by
`instructions.ts` itself (code path, not orchestrator prose) alongside the
existing `artifact_timings`/`artifact_tokens` stamp.

## API Design

`resolveAgentModel(role: AgentRole, workflowTier: string, modelsConfig: ModelsConfig | undefined): ModelAlias`:

```
PLANNING_COHORT = {proposer, specifier, product, researcher, architect, planner}
if role in PLANNING_COHORT: return 'inherit'          // hard path, never looked up
if role in {reviewer, verifier}: return 'inherit'      // hard path, never looked up
if role !== 'executor': return 'inherit'
if !modelsConfig or workflowTier not in {trivial, quick}: return 'inherit'
explicit = modelsConfig.executor?.[workflowTier]
if explicit: return explicit                           // explicit map wins
if modelsConfig.profile: return PROFILE_MAP[modelsConfig.profile][workflowTier] ?? 'inherit'
return 'inherit'
```

**Precedence**: an explicit `executor.trivial`/`executor.quick` value always wins
over the profile's expansion for that tier key; the profile only fills tiers the
explicit map leaves unset. `instructions.ts` logs a stderr warning (not a
validation error — both-set is a legitimate override pattern) when both `profile`
and `executor` are present, naming which tier keys came from which source.

`generate()` (`instruction-generator.ts:104-123`) calls `resolveAgentModel(role,
params.workflow, params.modelsConfig)` after the existing `tools` extraction and
sets `agent.model` on the returned object. `role` is derived from
`params.agent.name` by stripping the `metta-` prefix, matching the existing
`AGENT_CONTEXT_BUDGETS` key convention (`instructions.ts:11-21`).

**Escalation override.** Before calling `generate()`, `instructions.ts` reads
`metadata.model_escalations` and applies: *if any record has `task === artifactId`,
force `agent.model = 'inherit'` for this and all future generations of that
artifact, bypassing `resolveAgentModel` entirely.* Rung-1 is a one-way ratchet —
once a task has escalated, metta never retries it at a cheap tier within the same
change; there is no "completed re-run" state to track, so presence alone is the
predicate (simpler and safer than trying to detect whether the escalated re-run
has since finished).

**Escalation write path.** `metta model-escalation record --task <artifactId>
--from <model> --to inherit --trigger stop_deviation|verify_fail --change <name>`
(`src/cli/commands/model-escalation.ts`), structured identically to
`iteration.ts:14-72`: reads current metadata, appends to `model_escalations` via
`ArtifactStore.updateChange`, Zod-validated on write. Skill-contract wording:
- `metta-execute/SKILL.md` Deviation Rules (lines 54-59): on STOP, run
  `metta model-escalation record --task <id> --from <resolved-model> --to inherit
  --trigger stop_deviation` before re-invoking the executor.
- `metta-verify/SKILL.md` fix loop: on verify-FAIL against a downgraded-model run,
  run the same command with `--trigger verify_fail` before the fix re-run.

**Skill pass-through** (`metta-execute/SKILL.md:36-45` and equivalents): "Read
`agent.model` from `metta instructions <id> --json`. If it is not `inherit`, pass
it as `Agent(subagent_type: "metta-executor", model: "<value>", ...)`. If it is
`inherit`, omit the `model` parameter."

**Metric.** `getModelEscalationRate(specDir, artifactStore)` scans active changes
(`artifactStore.listChanges()` + `getChange`) and `${specDir}/archive/<entry>/.metta.yaml`
(mirroring `getArtifactsPerSmallChange`, `ceremony-metrics.ts:59-89`), summing
`model_runs.length` (denominator, all non-inherit executor resolutions) and
`model_escalations.length` (numerator) across all changes. Returns `null` when the
denominator is 0 (no cheap-tier invocations recorded at all — spec.md's explicit
no-data scenario), else `{ escalated, total, rate }` with `rate: 0` when
`escalated === 0`. Wired into `progress.ts` beside `ceremonyRatio`/
`artifactsPerSmall` (`progress.ts:21-22, 90-91, 163-174`): `--json` gains
`model_escalation_rate`; human output gains a "Model escalation rate: N% (x/y
cheap-tier runs escalated)" / "no data" line in the same conditional shape.

**Frontmatter cleanup.** Delete the `model: sonnet` line (line 4 in each file) from
`src/templates/agents/{metta-proposer,metta-architect,metta-planner,metta-specifier,metta-researcher}.md`
and their byte-identical `.claude/agents/` copies — 5 files × 2 locations = 10
edits, confirmed by research §6 grep. No new key added; absence already means
inherit, per `metta-product.md`'s existing pattern.

## Risks & Mitigations

- **Prose-contract compliance.** Model pass-through and escalation recording live
  in skill Markdown, not enforced code — an orchestrator could skip them. Mitigated
  because this is an advisory cost-efficiency path, not a safety boundary: reviewer/
  verifier immunity and planning-cohort inherit are enforced structurally in
  `resolveAgentModel` and `ModelsConfigSchema` regardless of skill compliance: worst
  case of a missed pass-through is the session running an executor at top-tier
  cost, not an unsafe cheap-tier reviewer/verifier run.
- **Denominator integrity.** A rate metric is only honest if "total cheap-tier
  invocations" is real, not inferred. Mitigated by writing `model_runs` from
  `instructions.ts` itself (code, at the same point `artifact_timings`/
  `artifact_tokens` are already stamped) rather than depending on orchestrator
  self-reporting.
- **Config precedence confusion.** Both `profile` and `executor` set could look
  ambiguous. Mitigated by an explicit, code-level precedence rule (explicit wins
  per-tier-key) plus a logged warning at generation time.
- **Vendor lock-in.** `ModelAliasEnum` values (`sonnet`/`opus`/`haiku`/`fable`/
  `inherit`) are Claude Code's documented agent-model vocabulary
  (research.md fn. 1) — a project using a different AI tool as its metta executor
  would need a different alias set. This is accepted scope per research §1 (full
  model-ID passthrough deferred, not built); flagged here as a real, not hidden,
  coupling to Claude Code specifically.
