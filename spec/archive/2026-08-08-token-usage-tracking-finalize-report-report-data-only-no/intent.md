# token-usage-tracking-finalize-report-report-data-only-no

## Problem

The user is burning top-model credits across metta-driven changes and has no empirical answer to "where do the credits go" — which artifacts, which agent roles, and which model tiers consume the tokens. Without that data, any change to executor routing (e.g. pushing more work to cheap models) would be guesswork.

Metta structurally cannot observe token counts itself: it runs in instruction mode with no hosted-model API calls anywhere in the codebase, so there is no programmatic point where token counts flow through metta code. However, the orchestrator (the Claude Code session driving the skills) sees each subagent's token usage in its completion report. This is exactly the situation already solved twice in this codebase by contractual recording: the iteration-record pattern (`src/cli/commands/iteration.ts`, called by skill templates to persist review/verify iteration counters) and the model-escalation-record pattern (`src/cli/commands/model-escalation.ts`, called by skills to append Rung-1 escalation records to `.metta.yaml`). Token usage today has no equivalent recording channel, no per-change report, and no cross-change aggregate — the data evaporates when the session ends.

Affected parties: the user paying for credits (primary), and any future routing/tiering work that needs per-role and per-model token evidence before touching model resolution.

## Proposal

Add end-to-end token-usage observability — record, report, aggregate — with report data only and no cost actions. Four coordinated pieces:

**1. Recording CLI: `metta tokens record`**
- New command `metta tokens record --task <artifact-or-task-id> --agent <role> --model <alias> --tokens <n> [--change <name>]`, mirroring `src/cli/commands/model-escalation.ts` exactly: `createCliContext`, auto-select when exactly one active change exists (typed errors for zero or multiple), Zod-validate the record before append, persist via `artifactStore.updateChange`, JSON success payload under `--json`, typed error payload (`code: 4`) and `process.exit(4)` on failure.
- New `token_usage` array on `ChangeMetadataSchema` (`src/schemas/change-metadata.ts`), each entry a strict Zod object: `{ task: string, agent: string, model: ModelAliasEnum, tokens: positive int, timestamp: ISO datetime }`. This is a new field distinct from the existing `artifact_tokens` record (which holds context-engine context/budget figures, not usage) — naming and docs must keep the two unambiguous.
- Guard-hook classification: add `tokens` to the instrumentation allowlist (`ALLOWED_SUBCOMMANDS`) in `metta-guard-bash.mjs` exactly as `iteration` and `model-escalation` are classified, in **both** copies (`.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs`), byte-identical, with `node --check` validation after edit.

**2. Skill-contract recording instruction**
- The agent-execution pattern in the lifecycle skills that spawn subagents — metta-plan, metta-execute, metta-verify, metta-next (wherever the established pass-through wording appears) — gains one instruction: after each subagent returns, record its reported token usage via `metta tokens record`, with role = the agent type spawned, model = the model passed (or `inherit`), tokens = the count from the completion report.
- All edits land in template+deployed pairs (`src/templates/skills/**` and `.claude/skills/**`) and remain byte-identical.
- Reviewer, verifier, and planning roles are all recordable — this is observability, not routing; no model-resolution behavior changes.

**3. Finalize report: TOKENS.md**
- Finalize assembles a `TOKENS.md` report into the change directory pre-archive, mirroring the UAT.md Step 5b precedent in `src/finalize/finalizer.ts` in every respect: runs after gates pass and before archive; warn-and-continue degradation (a report failure sets a warning, never fails finalize); no stray file left behind when finalize itself fails; gated by a config toggle `tokens.enabled` (default true) in a strict Zod `TokensConfigSchema` added as a sibling of `UatConfigSchema` in `src/schemas/project-config.ts` (design phase decides final placement, but the preferred shape is a sibling toggle matching `uat.enabled`).
- Report content, produced by a deterministic assembler from an external template file (templates-as-external-files rule — no string-literal templates in TypeScript): a header stating figures are approximate orchestrator-reported counts; totals; per-artifact table (artifact, agent role, model, tokens); per-role rollup; per-model rollup; cheap-vs-inherit split; and a GAPS section listing artifacts that have timing/model_runs evidence of a subagent run but no token record — expected-run set derived from `artifact_timings` keys — so prose-compliance failures in the skill contract are visible rather than silent.
- Finalize output surfaces the report path in both human output and `--json`, additively, exactly like `uatPath` (`tokensPath` plus a warning field on degraded runs).

**4. Progress aggregate**
- `metta progress` gains avg-tokens-per-change grouped by workflow tier, computed from `token_usage` across active and archived changes, following the existing ceremony-metric conventions: explicit no-data presentation distinct from zero, and null passthrough in `--json`.

Cross-cutting constraints (all settled): no API calls anywhere; capability target decided by research — likely extending finalize-ship as the primary spec (report generation), with schema/CLI requirements delegated where they naturally live; full test suite green per batch; near-1:1 test coverage for new modules.

## Impact

- **`src/schemas/change-metadata.ts` (schemas capability):** new optional `token_usage` array on `ChangeMetadataSchema` plus a new strict record schema. Additive; existing `.metta.yaml` files without the field remain valid.
- **CLI surface (`src/cli/`):** new `tokens record` subcommand registered alongside `iteration` and `model-escalation`; command registry/barrel exports updated.
- **Guard hooks:** `metta-guard-bash.mjs` allowlist grows by one entry in both deployed and template copies; existing tier classification is otherwise untouched.
- **Lifecycle skills (instruction-contracts):** metta-plan, metta-execute, metta-verify, metta-next templates and deployed copies gain one recording instruction in the subagent pass-through pattern; no other skill wording changes.
- **Finalize (finalize-ship):** finalizer gains a tokens-report assembly step between gate success and archive; `FinalizeResult` and the finalize CLI output gain additive `tokensPath`/warning fields; existing UAT behavior is unchanged.
- **Config (config-loader/schemas):** `ProjectConfigSchema` gains a `tokens` section (`enabled` default true); existing configs without it remain valid via defaults.
- **`metta progress`:** one new tier-grouped metric; existing metrics unchanged.
- **Archives:** future archived changes carry `TOKENS.md` and `token_usage` data; existing archives are untouched.

## Out of Scope

- Cost-in-dollars conversion of token counts.
- Budget enforcement, limits, alerts, or any blocking behavior based on token data.
- Automatic model-routing or executor-routing changes driven by the data — no model resolution changes of any kind; this change is observability only.
- Retrofitting token data into existing archived changes.
- Tracking the orchestrator's own (non-subagent) token use — only subagent completion-report figures are recorded.
- Exact token accounting: figures are approximate orchestrator-reported values, and the report header says so; no reconciliation against provider billing.
- Changes to the existing `artifact_tokens` (context/budget) field or the context engine's token budgeting.
