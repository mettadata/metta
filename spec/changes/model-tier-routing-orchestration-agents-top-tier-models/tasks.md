# Tasks: model-tier-routing-orchestration-agents-top-tier-models

<!--
Requirement -> Task mapping (instruction-contracts spec requirements + user stories):

- Emitted Instructions Contract Carries Complete Agent Identity -> 2.1 (US-1, US-2)
- Planning Cohort Requires Top-Tier Model -> 1.1, 1.2, 4.1 (US-1)
- Tier-Coupled Executor Routing -> 1.1, 1.2, 2.1 (US-2)
- Safety-Net Immunity For Reviewer And Verifier -> 1.1, 1.2 (US-3)
- Rung-1 Model Escalation On STOP Or Verify-FAIL -> 1.1, 2.1, 3.1, 4.2 (US-4)
- Rung Discrimination Between Model And Workflow Escalation -> 3.1, 5.1 (US-5)
- Escalation-Rate Metric In Progress Reporting -> 3.2 (US-6)
- Model Vocabulary Validated At Config Load -> 1.1 (US-3)

- US-1 (planning agents always author at top tier) -> 1.1, 1.2, 4.1
- US-2 (profile-driven executor routing by workflow tier) -> 1.1, 1.2, 2.1, 4.2
- US-3 (reviewer and verifier are immune to downgrade) -> 1.1, 1.2
- US-4 (Rung-1 model escalation on STOP or verify-FAIL) -> 1.1, 2.1, 3.1, 4.2
- US-5 (Rung-2 workflow escalation reuses existing upscale machinery) -> 5.1 (verification-only —
  no new upscale code is written by this change; design.md confirms Rung 2 is untouched)
- US-6 (escalation rate makes the cheap-first bet measurable) -> 3.2
-->

## Batch 1: Schemas and pure resolver

### 1.1 Config and escalation-audit schemas

**Files:**
- `src/schemas/project-config.ts`
- `src/schemas/change-metadata.ts`
- `tests/schemas.test.ts`

**Action:**
In `project-config.ts`, add (per design.md's Data Model section, exact shape):
- `ModelAliasEnum = z.enum(['sonnet', 'opus', 'haiku', 'fable', 'inherit'])` and its inferred
  `ModelAlias` type.
- `ModelProfileEnum = z.enum(['quality', 'balanced', 'budget'])`.
- `ModelsConfigSchema = z.object({ profile: ModelProfileEnum.optional(), executor: z.object({
  trivial: ModelAliasEnum.optional(), quick: ModelAliasEnum.optional() }).strict().optional(),
  reviewer: z.literal('inherit').optional(), verifier: z.literal('inherit').optional() }).strict()
  .optional()` — `reviewer`/`verifier` accept **only** the literal `'inherit'`; any other string
  (including any `ModelAliasEnum` member other than `'inherit'`) fails validation with a Zod issue
  at path `models.reviewer` / `models.verifier`. No planning-cohort role name (`proposer`,
  `specifier`, `product`, `researcher`, `architect`, `planner`) is a key anywhere in this schema.
- Add `models: ModelsConfigSchema` to `ProjectConfigSchema`'s field list (the schema is already
  optional per its own definition — do not wrap it in a second `.optional()`).

In `change-metadata.ts`, add:
- `ModelEscalationSchema = z.object({ task: z.string().min(1), from_model: ModelAliasEnum,
  to_model: ModelAliasEnum, trigger: z.enum(['stop_deviation', 'verify_fail']), timestamp:
  z.string().datetime() }).strict()` (import `ModelAliasEnum` from `project-config.ts`).
- `ModelRunSchema = z.object({ task: z.string().min(1), model: ModelAliasEnum, timestamp:
  z.string().datetime() }).strict()`.
- Add `model_escalations: z.array(ModelEscalationSchema).optional()` and `model_runs:
  z.array(ModelRunSchema).optional()` to `ChangeMetadataSchema`. Do **not** touch the existing
  singular `escalation: EscalationSchema` field — it is a separate, already-shipped concept
  (declined intent-time downscale, owned by `adaptive-workflow-tier-selection`) and must keep
  parsing unchanged.

In `tests/schemas.test.ts`, extend the existing `describe('ProjectConfigSchema', ...)` and
`describe('ChangeMetadataSchema', ...)` blocks (do not create new top-level describes) with cases
covering: `ModelAliasEnum` accepts all five documented values and rejects an out-of-vocabulary
string with a typed Zod error naming the offending field; `ModelsConfigSchema` accepts an absent
`models` key with no behavior change to the rest of `ProjectConfigSchema`; a `models.reviewer` or
`models.verifier` value other than `'inherit'` fails with an issue path `models.reviewer` /
`models.verifier`; every one of `quality`/`balanced`/`budget` is a valid `profile` value;
`ChangeMetadataSchema` parses legacy metadata with no `model_escalations`/`model_runs` keys
unchanged, and parses populated arrays of each.

**Verify:**
```
npx vitest run tests/schemas.test.ts
npm run lint
```

**Done:** `ModelsConfigSchema`'s representable key set is exactly `{profile, executor, reviewer,
verifier}`; `reviewer`/`verifier` structurally cannot hold any value but `'inherit'`; an
out-of-vocabulary model string is rejected with a typed, field-naming error; `ChangeMetadataSchema`
round-trips `model_escalations`/`model_runs` and still parses metadata files with neither key
present.

---

### 1.2 Pure model-resolution function

**Files:**
- `src/context/model-resolver.ts` (new)
- `tests/model-resolver.test.ts` (new)

**Action:**
Create `resolveAgentModel(role: AgentRole, workflowTier: string, modelsConfig: ModelsConfig |
undefined): ModelAlias` implementing design.md's API Design pseudocode exactly:
- `PLANNING_COHORT = new Set(['proposer', 'specifier', 'product', 'researcher', 'architect',
  'planner'])` — hard path, returns `'inherit'` without ever reading `modelsConfig`.
- `role === 'reviewer' || role === 'verifier'` — hard path, returns `'inherit'` without ever
  reading `modelsConfig`.
- `role !== 'executor'` (any role outside the two hard paths above, e.g. `discovery`,
  `constitution-checker`) — returns `'inherit'`.
- Executor path: if `!modelsConfig` or `workflowTier` is not `'trivial'` or `'quick'`, return
  `'inherit'`. Otherwise: an explicit `modelsConfig.executor?.[workflowTier]` value wins if
  present; else fall back to `PROFILE_MAP[modelsConfig.profile]?.[workflowTier]` if a profile is
  set; else `'inherit'`.
- Hard-code `PROFILE_MAP` per design.md's table: `quality: { trivial: 'inherit', quick: 'inherit'
  }`, `balanced: { trivial: 'sonnet', quick: 'sonnet' }`, `budget: { trivial: 'haiku', quick:
  'sonnet' }`.
- Export an `AgentRole` type/union covering the same 9 short names as `AGENT_CONTEXT_BUDGETS` in
  `src/cli/commands/instructions.ts` (`proposer, specifier, product, researcher, architect,
  planner, executor, verifier, reviewer`) plus any other role string is legal input (falls through
  to the `role !== 'executor'` branch) — do not import from `instructions.ts` (avoid a
  cli->context reverse dependency); define the literal set locally, matching the same strings.
- This is a pure function: no I/O, no imports from `ContextEngine`/`TemplateEngine`/CLI modules.

In `tests/model-resolver.test.ts`, cover the full scenario matrix: every planning-cohort role at
every tier with every profile/explicit combination resolves `'inherit'`; `reviewer`/`verifier`
resolve `'inherit'` under every profile/tier/explicit-map combination, including one that
attempts (via a hand-built object bypassing the schema) to set a cheap value; `executor` with no
`modelsConfig` resolves `'inherit'` at every tier; `executor` at `standard`/`full` tier resolves
`'inherit'` regardless of profile or explicit map; `executor` at `trivial`/`quick` under each named
profile resolves exactly the `PROFILE_MAP` table value; an explicit `executor.quick`/`executor
.trivial` value wins over a simultaneously-set `profile` for that tier key, while the profile
still fills the other tier key when the explicit map leaves it unset.

**Verify:**
```
npx vitest run tests/model-resolver.test.ts
npm run lint
```

**Done:** Every cell of the scenario matrix above passes; `resolveAgentModel` never returns a
non-`'inherit'` value for any role except `executor`, and never returns a non-`'inherit'` value for
`executor` outside `trivial`/`quick` tier.

---

## Batch 2: Emission, ratchet, and denominator

### 2.1 Wire model emission, escalation ratchet, and model_runs into instruction generation

**Files:**
- `src/context/instruction-generator.ts`
- `src/cli/commands/instructions.ts`
- `tests/instructions-agent-registry.test.ts`
- `tests/instructions-stamps-timings.test.ts`
- `tests/instructions-model-emission.test.ts` (new)

**Action:**
In `instruction-generator.ts`:
- Add `params.modelsConfig?: ModelsConfig` and `params.escalated?: boolean` to `generate()`'s
  params object (import `ModelsConfig`/`ModelAlias` types from `../schemas/project-config.js`).
- `InstructionOutput.agent` gains `model: ModelAlias`.
- After the existing `tools` extraction (around line 83), derive `role` from `params.agent.name` by
  stripping the `metta-` prefix (matching the `AGENT_CONTEXT_BUDGETS` key convention in
  `instructions.ts`). Compute `agent.model`: if `params.escalated` is `true`, force `'inherit'`
  without calling the resolver; otherwise call `resolveAgentModel(role, params.workflow,
  params.modelsConfig)` from `./model-resolver.js`.
- Set the computed value on the returned `agent` object alongside `name`/`persona`/`tools`/`rules`.

In `instructions.ts`:
- Load `cfg.models` via `ctx.configLoader.load()` (the verification-artifact block already does an
  equivalent `ctx.configLoader.load()` call — reuse one load, don't call it twice).
- Compute `const escalated = (metadata.model_escalations ?? []).some(r => r.task === artifactId)`
  before calling `generate()`; pass both `modelsConfig: cfg.models` and `escalated` into the
  `generate()` call. This is the one-way ratchet: once any `model_escalations` record exists for
  this `artifactId`, every future generation for it resolves to `'inherit'`, regardless of profile
  or tier — there is no un-escalation path.
- When `profile` and `executor` are both set in `cfg.models`, write a `process.stderr` warning
  naming which tier keys came from the explicit map vs. the profile (per design.md's Precedence
  note) — informational only, never a validation error, never blocking.
- Extend the existing best-effort metrics stamp block (`artifact_timings`/`artifact_tokens`,
  currently lines ~97-131): when `output.agent.model !== 'inherit'` **and** the resolved `role` for
  this artifact is `'executor'`, append `{ task: artifactId, model: output.agent.model, timestamp:
  new Date().toISOString() }` to `metadata.model_runs` and include it in the same
  `ctx.artifactStore.updateChange` call already writing `artifact_timings`/`artifact_tokens`. This
  write must remain inside the same `try`/`catch` that already swallows and warns on instrumentation
  failures — it MUST NOT block or throw into the instructions path. Do not gate this on the
  `preStatus === 'ready' || 'in_progress'` check any differently than the existing stamps are
  gated — same guard, same block.

In `tests/instructions-agent-registry.test.ts`, extend fixtures to assert: with no `models` key in
`.metta/config.yaml`, `metta instructions --json` output is identical to today's shape plus
`agent.model === 'inherit'` on every artifact/tier combination; with a `budget` profile and a
change fixture at `quick` tier, the `implementation` artifact's `agent.model` resolves to
`'sonnet'` (per the `budget` table) while a `standard`-tier fixture on the same profile resolves to
`'inherit'`; a non-executor artifact (e.g. `spec`) resolves to `'inherit'` under the `budget`
profile at every tier.

In `tests/instructions-model-emission.test.ts` (new), assert the ratchet and denominator behavior
against a temp-project fixture (mirror the `mkdtemp` + CLI-driven pattern in
`instructions-agent-registry.test.ts`): a `quick`-tier, `budget`-profile fixture's first
`metta instructions implementation --json` call appends one `model_runs` record and resolves
`agent.model` to `'sonnet'`; writing a `model_escalations` record with `task: 'implementation'`
directly into the fixture's `.metta.yaml` (via `ArtifactStore`) causes the next
`metta instructions implementation --json` call to resolve `agent.model` to `'inherit'` and append
no further `model_runs` record; a non-executor artifact never appends a `model_runs` record even
when its resolved model would (hypothetically) not be inherit.

**Verify:**
```
npx vitest run tests/instructions-agent-registry.test.ts tests/instructions-stamps-timings.test.ts tests/instructions-model-emission.test.ts
npm run lint
npm test
```

**Done:** `metta instructions` emits `agent.model` on every artifact; a no-`models`-config project
is byte-for-byte identical to pre-change output outside the new `model` field; the escalation
ratchet forces `'inherit'` for any artifact with a prior `model_escalations` record; `model_runs`
gains exactly one record per non-inherit executor resolution and none otherwise.

---

## Batch 3: Escalation CLI and metric

### 3.1 `metta model-escalation record` CLI command

**Files:**
- `src/cli/commands/model-escalation.ts` (new)
- `src/cli/index.ts`
- `src/templates/hooks/metta-guard-bash.mjs`
- `.claude/hooks/metta-guard-bash.mjs`
- `tests/model-escalation-command.test.ts` (new)
- `tests/metta-guard-bash.test.ts`

**Action:**
Create `registerModelEscalationCommand(program)` in `model-escalation.ts`, structured identically
to `iteration.ts:14-72`: a `model-escalation record` subcommand requiring `--task <id>`, `--from
<model>`, `--to <model>`, `--trigger <stop_deviation|verify_fail>`, and an optional `--change
<name>` (same auto-select-when-exactly-one-active-change convention as `iteration.ts`). Validate
`--trigger` is exactly one of the two literal strings (throw with a clear message otherwise, same
error-shape convention as `iteration.ts`'s `--phase` validation). Read the current change's
metadata via `ctx.artifactStore.getChange`, append `{ task, from_model, to_model, trigger,
timestamp: new Date().toISOString() }` to `metadata.model_escalations` (defaulting an absent array
to `[]`), and persist via `ctx.artifactStore.updateChange` — Zod-validated on write through
`ChangeMetadataSchema`/`ModelEscalationSchema` (Task 1.1). On success, print/emit the recorded
record (JSON: `{ change, task, from_model, to_model, trigger }`; human: a one-line confirmation
mirroring `iteration.ts`'s "Recorded ... for ..." message). On error, same `code: 4` /
`model_escalation_error` shape as `iteration.ts`'s catch block.

Register `registerModelEscalationCommand(program)` in `src/cli/index.ts` alongside
`registerIterationCommand(program)`.

In both `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs`, add
`'model-escalation'` to `ALLOWED_SUBCOMMANDS`, with an inline comment mirroring the existing
`'iteration'` entry's rationale (counter/audit-only instrumentation call made by skills during the
execute/verify fix loop; no broader state-mutating side effects than the iteration counter has).
Keep the two hook files byte-identical after the edit.

In `tests/model-escalation-command.test.ts` (mirror `tests/iteration-command.test.ts`'s fixture
setup exactly), assert: a first `record` call sets `model_escalations` to a one-element array with
the correct fields and an ISO timestamp; an invalid `--trigger` value exits non-zero with a clear
error and does not mutate `model_escalations`; `--change` auto-selection works when exactly one
active change exists and errors listing all changes when more than one exists and `--change` is
omitted.

In `tests/metta-guard-bash.test.ts`, add a case (alongside the existing `'iteration'` coverage
pattern in that file) asserting `metta model-escalation record --task x --from sonnet --to inherit
--trigger stop_deviation` is allowed with no `agent_type` set (an orchestrator-driven, non-forked
Bash call), run against both `HOOK_SOURCES` entries.

**Verify:**
```
npx vitest run tests/model-escalation-command.test.ts tests/metta-guard-bash.test.ts
diff src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs
node --check src/templates/hooks/metta-guard-bash.mjs
node --check .claude/hooks/metta-guard-bash.mjs
npm run lint
```

**Done:** `metta model-escalation record` appends a Zod-valid, retrievable record to
`model_escalations`; the guard-bash hook allows the command from an orchestrator session exactly as
it already allows `metta iteration record`; template and deployed hook copies remain byte-identical.
This task introduces no workflow-tier mutation anywhere — Rung 1 stays model-only, confirming the
Rung-discrimination requirement structurally (there is no code path in this command that touches
`workflow`/`complexity_score`/`actual_complexity_score`).

---

### 3.2 Escalation-rate metric in `metta progress`

**Files:**
- `src/util/ceremony-metrics.ts`
- `src/cli/commands/progress.ts`
- `tests/ceremony-metrics.test.ts`
- `tests/progress-ceremony-metrics.test.ts`

**Action:**
In `ceremony-metrics.ts`, add `getModelEscalationRate(specDir: string, artifactStore:
ArtifactStore): Promise<{ escalated: number; total: number; rate: number } | null>` (import
`ArtifactStore`'s type from `../artifacts/artifact-store.js`). Mirror `getArtifactsPerSmallChange`'s
structure (lines 59-89): scan **active** changes via `artifactStore.listChanges()` +
`artifactStore.getChange(name)`, and **archived** changes via `readdir(join(specDir, 'archive'))` +
`StateStore.read(join('archive', entry.name, '.metta.yaml'), ChangeMetadataSchema)` — skip archive
entries with a missing or schema-invalid `.metta.yaml` rather than throwing (same `try`/`catch`
pattern). Sum `model_runs?.length ?? 0` across every scanned change into `total` (the denominator)
and `model_escalations?.length ?? 0` into `escalated` (the numerator). Return `null` when `total
=== 0` (the explicit no-data case — never conflate with a computed zero). Otherwise return
`{ escalated, total, rate: escalated / total }` — `rate: 0` is a valid, distinct result from `null`
when `escalated === 0` but `total > 0`.

In `progress.ts`, call `getModelEscalationRate(join(ctx.projectRoot, 'spec'),
ctx.artifactStore)` alongside the existing `ceremonyRatio`/`artifactsPerSmall` calls. Add a
`model_escalation_rate` field to the `--json` output object (same position/pattern as
`ceremony_commit_ratio`/`artifacts_per_small_change`, passing the `null`-or-object value through
verbatim). Add a human-output line in the same conditional shape as the `ceremonyRatio`/
`artifactsPerSmall` lines (lines ~163-174): when non-null, `Model escalation rate: N% (x/y
cheap-tier runs escalated)`; when `null`, `Model escalation rate: no data`. Do not phrase this line,
or any comment near it, as claiming the metric detects silent wrong-but-plausible cheap-executor
output that produced neither a STOP report nor a verify-FAIL (spec.md's explicit prohibition) — if
a comment is warranted, state the metric only measures STOP/FAIL-driven escalations.

In `tests/ceremony-metrics.test.ts`, add a `describe('getModelEscalationRate', ...)` block covering:
no active or archived changes with any `model_runs` → `null`; one change with `model_runs.length >
0` and zero `model_escalations` → `{ escalated: 0, total: N, rate: 0 }`; a mix of active and
archived changes with some escalated → correct summed `rate`; an archive entry with an invalid
`.metta.yaml` is skipped rather than throwing.

In `tests/progress-ceremony-metrics.test.ts`, extend fixtures to assert `--json` includes
`model_escalation_rate` (both the no-data `null` case and a populated-object case) and the
human-readable output prints the "no data" line vs. the numeric line under the matching fixture
conditions.

**Verify:**
```
npx vitest run tests/ceremony-metrics.test.ts tests/progress-ceremony-metrics.test.ts
npm run lint
```

**Done:** `metta progress --json` always includes `model_escalation_rate` (never omitted);
human-readable output reports a numeric rate whenever any cheap-tier invocation has been recorded,
including an explicit `0%` when none have escalated, and an explicit "no data" line only when zero
cheap-tier invocations have ever been recorded.

---

## Batch 4: Frontmatter cleanup and skill contracts

### 4.1 Remove downgraded model pin from planning-cohort agent files

**Files:**
- `src/templates/agents/metta-proposer.md`
- `src/templates/agents/metta-architect.md`
- `src/templates/agents/metta-planner.md`
- `src/templates/agents/metta-researcher.md`
- `src/templates/agents/metta-specifier.md`
- `.claude/agents/metta-proposer.md`
- `.claude/agents/metta-architect.md`
- `.claude/agents/metta-planner.md`
- `.claude/agents/metta-researcher.md`
- `.claude/agents/metta-specifier.md`

**Action:**
Delete the `model: sonnet` frontmatter line from all 10 files (the same line in each of the 5
templates and its byte-identical deployed copy). Change nothing else in any of the 10 files —
`description`, `tools`, `color`, and the full markdown body stay untouched. Do not add a `model:
inherit` line in its place: absence of the key already means inherit (this is `metta-product.md`'s
existing, unedited pattern — `metta-product.md` needs no change here since it never had a `model:`
key).

**Verify:**
```
grep -rn "model: sonnet" src/templates/agents/*.md .claude/agents/*.md
for f in metta-proposer metta-architect metta-planner metta-researcher metta-specifier; do diff src/templates/agents/$f.md .claude/agents/$f.md; done
npx vitest run tests/agent-registry.test.ts tests/instructions-agent-registry.test.ts
npm run lint
```
The `grep` must produce no output. Every `diff` must produce no output (exit 0).

**Done:** No planning-cohort agent file (proposer, specifier, researcher, architect, planner,
product) pins a model below inherit; all 10 edited files remain byte-identical, template to
deployed copy.

---

### 4.2 Skill-contract model pass-through and escalation-recording wording

**Files:**
- `src/templates/skills/metta-execute/SKILL.md`
- `.claude/skills/metta-execute/SKILL.md`
- `src/templates/skills/metta-verify/SKILL.md`
- `.claude/skills/metta-verify/SKILL.md`

**Action:**
Apply the same edits to each template and its deployed copy so the pairs stay byte-identical.

In `metta-execute/SKILL.md`:
- Extend the `Agent(subagent_type: ...)` invocation guidance (the parallel-execution examples
  around lines 36-45) with: "Read `agent.model` from `metta instructions <id> --json`. If it is not
  `inherit`, pass it as `Agent(subagent_type: "metta-executor", model: "<value>", ...)`. If it is
  `inherit`, omit the `model` parameter." — worded as an instruction the orchestrator follows for
  every executor spawn, not just the example pair shown.
- Extend the "Deviation Rules" section's "Blocked (>10 lines to fix) → STOP" bullet and the
  general STOP-report handling with: before re-invoking the executor for the affected task, run
  `metta model-escalation record --task <id> --from <resolved-model> --to inherit --trigger
  stop_deviation --change <name>`, then re-invoke the executor with `model` omitted (top-tier).

In `metta-verify/SKILL.md`:
- Extend the fix-loop wording (the "If any gate fails" / re-verify step) with: when a verification
  run FAILs against output produced under a downgraded (non-inherit) model, before spawning the fix
  executor, run `metta model-escalation record --task <id> --from <resolved-model> --to inherit
  --trigger verify_fail --change <name>`, then spawn the fix executor with `model` omitted
  (top-tier).

Keep every other line of both files unchanged (allowed-tools, hooks frontmatter, other steps).

**Verify:**
```
diff src/templates/skills/metta-execute/SKILL.md .claude/skills/metta-execute/SKILL.md
diff src/templates/skills/metta-verify/SKILL.md .claude/skills/metta-verify/SKILL.md
grep -n "agent.model" .claude/skills/metta-execute/SKILL.md
grep -n "model-escalation record" .claude/skills/metta-execute/SKILL.md .claude/skills/metta-verify/SKILL.md
grep -c "stop_deviation" .claude/skills/metta-execute/SKILL.md
grep -c "verify_fail" .claude/skills/metta-verify/SKILL.md
```
Both `diff` commands must produce no output. Both `grep -c` counts must be >= 1.

**Done:** `metta-execute/SKILL.md` documents reading and passing through `agent.model` for every
executor spawn and records a `stop_deviation` escalation before any STOP-triggered re-invocation;
`metta-verify/SKILL.md` records a `verify_fail` escalation before any fix re-run following a FAIL
against downgraded-model output; both skills' template/deployed pairs remain byte-identical.

---

## Batch 5: Full sweep and live proof

### 5.1 End-to-end fixture proof and regression sweep

**Files:**
- `tests/model-tier-routing-e2e.test.ts` (new)

**Action:**
Build a temp-project fixture (mirror the `mkdtemp` + real `.metta/config.yaml` + `ArtifactStore`
pattern used across `tests/instructions-agent-registry.test.ts` and
`tests/model-escalation-command.test.ts`) with a `budget` profile in `models` and a `quick`-tier
active change, and drive the full lifecycle through the CLI (`npx tsx src/cli/index.ts ...`, same
`runCli` helper pattern as the other CLI-integration tests):
1. `metta instructions implementation --json --change <name>` resolves `agent.model` to `'sonnet'`
   (the `budget` profile's `quick`-tier executor value) and appends one `model_runs` record.
2. `metta model-escalation record --task implementation --from sonnet --to inherit --trigger
   stop_deviation --change <name>` records the escalation.
3. A second `metta instructions implementation --json --change <name>` call resolves `agent.model`
   to `'inherit'` (the ratchet) and appends no further `model_runs` record.
4. `metta progress --json` reports `model_escalation_rate` with `total >= 1` and `escalated >= 1`
   reflecting the recorded event.
5. `metta progress` (human output) prints a "Model escalation rate" line with a non-"no data" value.
6. The change's recorded `workflow` field (via `metta status --json` or a direct `.metta.yaml`
   read) is identical before and after step 2 — proving the Rung-1 escalation left the workflow
   tier untouched (Rung Discrimination requirement).

Then run the full repository test suite and typecheck as a regression sweep — no other test file
should need further changes; if one does, that is a signal a prior task's Verify step was
insufficient and must be fixed in this task by correcting the offending file from its owning batch,
not by weakening this task's assertions.

**Verify:**
```
npx vitest run tests/model-tier-routing-e2e.test.ts
npm test
npm run lint
```

**Done:** The fixture proves the full cheap-emission -> STOP -> escalation-record -> ratchet ->
metric chain end-to-end in one CLI-driven run, and the full suite plus typecheck are green with no
regressions anywhere else in the repository.
