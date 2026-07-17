# Verification: model-tier-routing-orchestration-agents-top-tier-models

Verified against the 8-requirement instruction-contracts delta in `spec.md`. Every requirement was
exercised live against the built CLI (`npm run build`, then `node dist/cli/index.js` driven inside
throwaway fixture projects created with `metta install` in a scratchpad temp dir), plus static
evidence from source and tests. Fixtures were deleted after verification.

**Overall verdict: PASS** — all 8 requirements verified with live evidence; all gates green
(1447/1447 tests, tsc clean, build clean).

## Live fixture setup

- **fixture-a**: fresh git repo → `metta install` → `models:\n  profile: budget` appended to
  `.metta/config.yaml` → `metta quick "fix typo in readme"` (quick-tier change
  `fix-typo-readme`) → intent authored and completed so `implementation` reached `ready`.
- **fixture-b**: identical install, initially **no** `models` block (config-less control), quick
  change `another-small-fix`; later given `profile: budget` for the zero-escalations metric case.

## Requirement 1 (MODIFIED): Emitted Instructions Contract Carries Complete Agent Identity — PASS

- **Live**: `metta instructions implementation --json` in fixture-a (budget, quick) emitted the
  agent object `{name: "metta-executor", persona: "You are an implementation engineer...",
  tools: [Read, Write, Edit, Bash, Grep, Glob], model: "sonnet"}` — all four fields present;
  name/persona/tools match `src/templates/agents/metta-executor.md`.
- **Tool-list edit reflected at next generation (live)**: appended `WebFetch` to the runtime agent
  definition (`dist/templates/agents/metta-verifier.md` — the file `loadAgentDefinition` reads,
  `src/agents/agent-registry.ts:71`); next `instructions verification --json` emitted
  `[..., 'WebFetch']`; restoring the file restored the emitted list. Note: the fixture's deployed
  `.claude/agents/` copy is *not* the generation-time source — the shipped template dir is, which
  satisfies "sourced from that agent's definition file at generation time".
- **No models config → inherit everywhere (live)**: in config-less fixture-b, all three quick-tier
  artifacts emitted `inherit`: `intent: metta-proposer -> inherit`,
  `implementation: metta-executor -> inherit`, `verification: metta-verifier -> inherit`.

## Requirement 2 (ADDED): Planning Cohort Requires Top-Tier Model — PASS

- **No pins (live grep)**: `grep -rn "^model:" src/templates/agents/ .claude/agents/` → zero
  matches across all 24 agent files, including all 12 planning-cohort files (proposer, specifier,
  product, researcher, architect, planner × template + deployed).
- **Live resolution**: proposer emitted `inherit` in fixture-a under budget profile at quick tier
  (the maximally-downgrading configuration).
- **Schema exposes no planning-cohort key (live)**: config with `models.planner: haiku` rejected
  at load with Zod `unrecognized_keys` naming `planner` at path `["models"]` (`ModelsConfigSchema`
  is `.strict()` with only `profile`/`executor`/`reviewer`/`verifier` keys,
  `src/schemas/project-config.ts:75-83`).
- **Structural**: `resolveAgentModel` hard-returns `inherit` for the six-cohort set before ever
  reading config (`src/context/model-resolver.ts:22-29,51`).

## Requirement 3 (ADDED): Tier-Coupled Executor Routing — PASS

- **Quick tier → cheap model (live)**: fixture-a (budget, quick) → implementation `model: sonnet`.
- **Standard tier → inherit (live)**: edited `workflow: quick` → `standard` in the change's
  `.metta.yaml`, same command → `model: inherit`; restored to `quick`.
- **Per-call evaluation of *current* tier**: the tier flip above changed the emission with no other
  state change — tier is read from `metadata.workflow` per generation
  (`src/cli/commands/instructions.ts:90`), not cached. Config-less and no-designation cases resolve
  inherit (`src/context/model-resolver.ts:54-58`; fixture-b live evidence above).

## Requirement 4 (ADDED): Safety-Net Immunity For Reviewer And Verifier — PASS

- **reviewer downgrade rejected (live)**: `models.reviewer: haiku` → `metta instructions` exited
  **4** with Zod `invalid_literal`, path `["models","reviewer"]`, received `haiku`, expected
  `"inherit"`.
- **verifier downgrade rejected identically (live)**: `models.verifier: haiku` → same error shape,
  path `["models","verifier"]`.
- **Schema**: reviewer/verifier accept only `z.literal('inherit')`
  (`src/schemas/project-config.ts:81-82`); resolver hard-inherits both roles regardless of input
  (`src/context/model-resolver.ts:52`).
- **Every shipped profile resolves both to inherit**: `PROFILE_MAP` carries executor tiers only
  (`src/context/model-resolver.ts:32-36`); live: verifier emitted `inherit` under budget profile at
  quick tier; matrix test covers all three profiles × both roles
  (`tests/model-resolver.test.ts:39-68`), including a hand-built schema-bypass config.

## Requirement 5 (ADDED): Rung-1 Model Escalation On STOP Or Verify-FAIL — PASS

- **Denominator stamp (live)**: on the `ready` implementation artifact, generation emitted `sonnet`
  and appended `model_runs: [{task: implementation, model: sonnet, timestamp:
  2026-07-17T05:50:29.961Z}]` (ISO timestamp) to `.metta.yaml`
  (`src/cli/commands/instructions.ts:149-163`).
- **Escalation CLI + ratchet (live)**: `metta model-escalation record --task implementation --from
  sonnet --to inherit --trigger verify_fail` → next generation emitted `model: inherit` at quick
  tier (would be `sonnet` absent the ratchet, `src/cli/commands/instructions.ts:84`) and appended
  **no** further `model_runs` record (array stayed length 1).
- **Durable audit record (live)**: persisted `model_escalations` entry carries all four required
  fields — `task: implementation`, `from_model: sonnet`, `to_model: inherit`,
  `trigger: verify_fail` (plus timestamp) — and survived across processes: a later fresh
  `instructions` invocation (after a config restore) still resolved `inherit` from the ratchet.
- **STOP trigger**: `stop_deviation` is the sibling enum value in the same recorder; skill contract
  evidence under Requirement 8 below. Command coverage: `tests/model-escalation-command.test.ts`.

## Requirement 6 (ADDED): Rung Discrimination Between Model And Workflow Escalation — PASS

- **Tier unchanged by Rung-1 (live)**: `.metta.yaml` read `workflow: quick` before and after the
  escalation record + escalated re-generation; the tier-routing `escalation` field
  (`src/schemas/change-metadata.ts:91`) remained absent/untouched — `model_escalations` (line 92)
  is a distinct field.
- **Scope overflow routes to upscale machinery**: the only writer of `model_escalations` in
  non-test source is the `model-escalation` command (`src/cli/commands/model-escalation.ts:66-68`);
  scope-overflow scoring and upscale live in the pre-existing adaptive-workflow-tier-selection path
  (`src/cli/commands/complete.ts:422-505`) which never touches `model_escalations`.
- **Upscale → planning at top-tier**: planning roles are a hard-inherit path under every tier and
  config (`src/context/model-resolver.ts:51`; live proposer evidence above), so post-upscale
  planning generations necessarily emit `inherit`.

## Requirement 7 (ADDED): Escalation-Rate Metric In Progress Reporting — PASS

- **Computed rate, both modes (live, fixture-a after 1 run + 1 escalation)**: human —
  `Model escalation rate: 100% (1/1 cheap-tier runs escalated)`; `--json` —
  `"model_escalation_rate": {"escalated": 1, "total": 1, "rate": 1}` (same pattern as
  `ceremony_commit_ratio`).
- **Zero not omitted (live, fixture-b with 1 cheap run, 0 escalations)**:
  `Model escalation rate: 0% (0/1 cheap-tier runs escalated)`; JSON
  `{escalated: 0, total: 1, rate: 0}`.
- **Explicit no-data (live, fixture-b before any cheap run)**: human —
  `Model escalation rate: no data`; JSON key present with explicit `null` — never a numeric zero
  (`src/cli/commands/progress.ts:184-186`, `src/util/ceremony-metrics.ts:105-109`).
- **Honesty constraint**: reporting code and docs state the metric "measures only
  STOP/verify-FAIL-driven escalations; it makes no claim about cheap-executor output that produced
  neither a STOP report nor a verify FAIL" (`src/util/ceremony-metrics.ts:101-103`,
  `src/cli/commands/progress.ts:23-24`); no output text claims silent-wrong-output detection.

## Requirement 8 (ADDED): Model Vocabulary Validated At Config Load — PASS

- **In-vocabulary accepts (live)**: `profile: budget` loaded and resolved throughout the fixture
  runs.
- **Out-of-vocabulary rejected (live)**: `models.executor.quick: gpt-4` → typed load failure
  (exit 4, `instructions_error` wrapping the Zod issue) with `invalid_enum_value`, path
  `["models","executor","quick"]`, received `gpt-4`, options
  `[sonnet, opus, haiku, fable, inherit]` (`ModelAliasEnum`, `src/schemas/project-config.ts:67`).
- **Never silently substituted (live)**: the failing invocation produced only the error envelope —
  no `agent` block, no instruction output, no coerced value; after restoring a valid config the
  next generation resolved from the restored config (and the persisted ratchet).

## Planning inversion, guard, and skill-contract checks (cross-cutting)

- **Byte identity (live diff)**: `diff -rq src/templates/skills/ .claude/skills/` → identical;
  `diff -rq src/templates/hooks/ .claude/hooks/` → identical; all 12 agent template/deployed pairs
  `cmp`-identical.
- **Guard allowlist (live)**: `model-escalation` present at line 23 of both
  `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs`;
  `node --check` passes on both copies.
- **Skill contracts (live grep)**: `metta-execute/SKILL.md:48` — read `agent.model` for **every**
  executor spawn, pass non-`inherit` as the Agent tool's `model` parameter, omit for `inherit`;
  `:63` — on STOP under a non-inherit model, run `metta model-escalation record ... --trigger
  stop_deviation` then re-invoke top-tier. `metta-verify/SKILL.md:31` — on verify-FAIL of a
  downgraded run, record with `--trigger verify_fail` then spawn the fix executor top-tier. Both
  skill pairs byte-identical (covered by the skills diff above).

## Gates

| Gate | Result |
|------|--------|
| `npx vitest run` | **PASS** — 87 files, 1447/1447 tests, 0 failures (240s) |
| `npx tsc --noEmit` (also `npm run lint`) | **PASS** — clean |
| `npm run build` | **PASS** — compile + template copy clean |

Working tree clean after verification (dist edit for the tool-list scenario restored from
`src/templates/agents/`; `dist/` is untracked build output).

## Observations (non-blocking)

- The instructions banner double-prefixes the agent name (`[METTA-METTA-EXECUTOR]`) — cosmetic,
  already flagged in summary.md as a paper-cut candidate.
- The generation-time agent-definition source is metta's shipped `templates/agents` directory, not
  a project's deployed `.claude/agents/` copy; the copies are kept byte-identical so behavior
  matches, but edits made only to a project's deployed copy do not affect emitted
  `name`/`persona`/`tools`. Consistent with the spec's wording; noted for future spec clarity.

## Verdict

**PASS** — all 8 requirements and all 22 scenarios verified, dominated by live CLI evidence in
disposable fixtures; all gates green.
