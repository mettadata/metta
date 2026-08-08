# Design: token-usage-tracking-finalize-report-report-data-only-no

## Approach

This change is deliberately the union of two shipped precedents — the UAT finalize report (2026-07-21) and the model-escalation contractual recording (2026-07-17) — and the design mirrors both on every axis rather than inventing new structure. Four coordinated pieces, all composition (new sibling modules and additive fields), no inheritance, no new abstractions:

1. **Recording channel** — a new `metta tokens record` CLI command as a structural clone of `src/cli/commands/model-escalation.ts` (`tokens` group, `record` subcommand), appending strict-Zod-validated `token_usage` records to change metadata via `artifactStore.updateChange`. Guard hooks allowlist `tokens` in `ALLOWED_SUBCOMMANDS` in both copies, byte-identical.
2. **Skill contract** — one verbatim, byte-identical recording instruction inserted at four anchors (metta-plan new step 2d, metta-execute after the `agent.model` pass-through paragraph, metta-verify between steps 2 and 3, metta-next `## Rules` bullet), template + deployed pairs kept identical.
3. **Finalize report** — `src/finalize/tokens-report-generator.ts` (pure-data input, caller-injected date) rendering the external template `src/templates/artifacts/tokens.md` via the shared `TemplateEngine`, wired as **Step 5c** in `Finalizer.finalize` immediately after the UAT Step 5b block and before archive, gated by `config.tokens.enabled`, with independent warn-and-continue try/catch and partial-file cleanup. `tokensPath`/`tokensWarning` surface additively, parallel to `uatPath`.
4. **Progress aggregate** — `getAvgTokensPerChangeByTier` in `src/util/ceremony-metrics.ts`, cloned from `getModelEscalationRate`'s active+archive iteration, fixed four tier keys, per-tier `{mean, sample_size} | null`, null passthrough in `--json`.

Spec merge target: **finalize-ship as the single merge target with the scope-note requirement**, per the capability-mapping research decision. `SpecMerger` supports exactly one H1-derived capability per change; the UAT and model-escalation precedents both chose this shape, and the scope note keeps future relocation reversible. If a later change adds a second token feature, log a backlog item to extract a `token-observability` capability via reconciliation (per the scope note's relocation clause).

### ADRs — carried-forward flags, resolved

**ADR-1: The `cheap` alias — records carry concrete `ModelAliasEnum` values; the split is non-inherit vs inherit.**
`ModelAliasEnum` is `['sonnet','opus','haiku','fable','inherit']`; there is no `cheap` member, so the spec delta's scenario datum `model: "cheap"` would fail the very schema the delta defines. Resolution (recommended by all three affected research tracks, adopted here):
- Records always carry the **concrete alias** the subagent ran at (`haiku`, `sonnet`, `opus`, `fable`) or `inherit` when no model was passed. No enum change — adding `'cheap'` would leak into model-resolution config (`ModelsConfigSchema.executor`, `model_runs`, `model_escalations`), violating the observability-only constraint.
- The report split is computed as **non-inherit vs inherit**: sum of tokens where `model !== 'inherit'` vs `model === 'inherit'`, rendered under the heading label **"Cheap/pinned (non-inherit) vs inherit"** so the spec's "cheap-vs-inherit" intent stays legible while the data stays truthful.
- The spec.md scenario datums using `model: "cheap"` / `--model cheap` are **spec-authoring errors corrected to a real alias (`haiku`)**, and the "cheap-vs-inherit split" requirement wording is aligned to the non-inherit definition. The implementation tasks MUST include this scenario-datum fix to `spec/changes/token-usage-tracking-finalize-report-report-data-only-no/spec.md` (occurrences: the Token Usage Record Schema scenario record, the two Tokens Record CLI scenario command lines, the guard-hook scenario command line, and the Tokens Report Content split wording/scenario).

**ADR-2: GAPS derivation is exact string match; ordering is deterministic.**
`gaps = sortedKeys(artifact_timings ?? {}).filter(k => !tokenUsage.some(r => r.task === k))`. Exact match of `token_usage[].task` against `artifact_timings` keys — records with fine-grained task ids (e.g. `T1`) count in totals and rollups but do **not** clear an artifact-level gap; the skill instruction wording steers `--task` toward artifact ids for this reason. Empty timings + empty usage → GAPS states "no gaps found"; timings present with no records → fully-populated GAPS. Ordering rules for byte-identical output: **per-artifact table in record (append) order; per-role rollup, per-model rollup, and GAPS sorted lexicographically.**

**ADR-3: Present-but-empty `token_usage` arrays are excluded from progress averages**, exactly like the absent field (which the spec mandates for pre-feature archives). An empty array contributes zero observations; counting it as a 0-token change would deflate averages and blur the no-data-vs-zero distinction the ceremony-metric conventions enforce.

**ADR-4: No-`projectRoot` finalizer construction skips tokens generation with `tokensPath: null`**, byte-parallel to UAT today — Step 5c is gated on `this.projectRoot` exactly as Step 5b is.

Minor decisions settled here: progress human line uses `formatThousandsK` (`20k`) for consistency with the existing token display convention; changes whose `workflow` string is outside the four known tiers are ignored by the metric (stable JSON shape over dynamic keys); the metta-plan constitution-checker spawn is covered by the "after each subagent returns" wording — its records land in rollups but never in GAPS math (harmless, accepted).

## Components

| Component | File | Responsibility |
|---|---|---|
| `TokenUsageRecordSchema` + `token_usage` field | `src/schemas/change-metadata.ts` (modified) | Strict record schema; optional additive array on `ChangeMetadataSchema`. Doc comments disambiguate from the existing `artifact_tokens` (context-engine budget figures), which is untouched. |
| `TokensConfigSchema` + `tokens` field | `src/schemas/project-config.ts` (modified) | Strict `{ enabled: boolean default true }` sibling of `UatConfigSchema`; wired as `tokens: TokensConfigSchema.default({})` on `ProjectConfigSchema`. No `ConfigLoader` changes — it parses the schema as-is. |
| `registerTokensCommand` | `src/cli/commands/tokens.ts` (new) | `tokens` group → `record` subcommand. Structural clone of `model-escalation.ts`: `createCliContext`, verbatim auto-selection block, `TokenUsageRecordSchema.parse` before a single `updateChange` append, `outputJson` success payload, typed error + `process.exit(4)`. |
| CLI registration | `src/cli/index.ts` (modified) | One import + one `registerTokensCommand(program)` call beside `registerIterationCommand`/`registerModelEscalationCommand`. NOT added to `CONFIG_PARSE_EXEMPT_COMMANDS` or `DRIFT_CHECK_EXEMPT_COMMANDS`. |
| Guard-hook allowlist | `.claude/hooks/metta-guard-bash.mjs` + `src/templates/hooks/metta-guard-bash.mjs` (modified, byte-identical) | One `'tokens'` entry in `ALLOWED_SUBCOMMANDS` after `'model-escalation'`, with the append-only-instrumentation inline comment. `node --check` both after edit. No other set changes. |
| `generateTokensReport` | `src/finalize/tokens-report-generator.ts` (new) | Functional-core assembler: pure computation of total, per-artifact table, per-role rollup, per-model rollup, non-inherit-vs-inherit split, GAPS; only I/O is rendering `tokens.md` via `TemplateEngine`. Never reads the clock. |
| Tokens report template | `src/templates/artifacts/tokens.md` (new) | External template skeleton: title, `{change_name}`/`{generated_date}` metadata, fixed approximate-figures disclaimer prose, per-section body slots (`{total}`, `{per_artifact_table}`, `{per_role_rollup}`, `{per_model_rollup}`, `{split}`, `{gaps}`). Shipped by the existing `copy-templates` step — zero build changes. |
| Finalizer Step 5c | `src/finalize/finalizer.ts` (modified) | Mirrors Step 5b line-for-line: `this.projectRoot` gate, shared `configLoader ??=` instance, `config.tokens.enabled` check, `generateTokensReport(...)`, `artifactStore.writeArtifact(changeName, 'TOKENS.md', markdown)`, catch → `tokensError` + best-effort `rm` of partial `TOKENS.md`; post-archive `tokensPath` computed beside `uatPath`. `FinalizeResult` gains `tokensPath: string | null` and optional `tokensError`. |
| Finalize CLI output | `src/cli/commands/finalize.ts` (modified) | Four lines parallel to the uat lines: JSON success gains `tokensPath` + conditional `tokensWarning`; human mode prints the tokens path line when present and a warning on degradation. Error JSON shapes untouched. |
| `getAvgTokensPerChangeByTier` | `src/util/ceremony-metrics.ts` (modified) | Never-throwing helper cloned from `getModelEscalationRate`: active via `ArtifactStore`, archives via `StateStore.read('archive/<entry>/.metta.yaml', ChangeMetadataSchema)`, catch-skip per entry; per-change total summed from `token_usage`; absent or empty arrays excluded (ADR-3); grouped by the fixed four tiers. |
| Progress rendering | `src/cli/commands/progress.ts` (modified) | JSON key `avg_tokens_per_change_by_tier` with verbatim null passthrough; one human line rendering all four tiers as `formatThousandsK` value or explicit `no data`. |
| Skill recording instruction | 4 template + 4 deployed `SKILL.md` files (modified) | One verbatim instruction (below) at the four anchors; no other wording changes; template/deployed pairs byte-identical. |

## Data Model

**`TokenUsageRecordSchema`** (`src/schemas/change-metadata.ts`, sibling of `ModelEscalationSchema`, every constraint precedented in-file):

```ts
export const TokenUsageRecordSchema = z.object({
  /** Artifact or task id the usage applies to (artifact ids clear GAPS; finer ids count in rollups only). */
  task: z.string().min(1),
  /** Subagent role spawned (e.g. 'metta-executor', 'spec-writer'). */
  agent: z.string().min(1),
  /** Concrete alias the subagent ran at, or 'inherit' when no model was passed. Never a tier word. */
  model: ModelAliasEnum,
  /** Approximate orchestrator-reported count from the subagent completion report. */
  tokens: z.number().int().positive(),
  timestamp: z.string().datetime(),
}).strict()
```

On `ChangeMetadataSchema` (itself `.strict()`): `token_usage: z.array(TokenUsageRecordSchema).optional()` — additive; existing `.metta.yaml` files without it remain valid. Distinct from `artifact_tokens` (keyed `{context, budget}` context-engine record) — that field's schema and semantics are byte-for-byte unchanged; both doc comments name the other to keep them unambiguous.

**`TokensConfigSchema`** (`src/schemas/project-config.ts`):

```ts
export const TokensConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()
// ProjectConfigSchema: tokens: TokensConfigSchema.default({})
```

Unknown keys and non-boolean `enabled` rejected; omitted `tokens` key defaults to enabled.

**`FinalizeResult`** (additive): `tokensPath: string | null` (post-archive `join(specDir, 'archive', archiveName, 'TOKENS.md')` when generated; `null` when disabled, degraded, dry-run, early-return, or no-projectRoot) and optional `tokensError: string`, spread as `...(tokensError ? { tokensError } : {})`.

**Progress metric shape:** `Record<'trivial'|'quick'|'standard'|'full', { mean: number; sample_size: number } | null>` — all four keys always emitted; `null` per tier with no contributing changes; wholly empty data → all four `null`.

**TOKENS.md report layout** (deterministic; ordering per ADR-2): (1) header — change name, generation date, approximate-figures disclaimer; (2) total tokens; (3) per-artifact table `| Artifact/task | Agent | Model | Tokens |` in record order; (4) per-role rollup, lexicographic; (5) per-model rollup, lexicographic; (6) "Cheap/pinned (non-inherit) vs inherit" split — two figures summing to the total; (7) GAPS — lexicographic timing keys with no exact-match record, or the explicit "No gaps found" line.

## API Design

**CLI:** `metta tokens record --task <artifact-or-task-id> --agent <role> --model <alias> --tokens <n> [--change <name>]`
- `--change` omitted: auto-select when exactly one active change exists; typed error naming candidates when multiple, "No active changes." when zero (verbatim model-escalation block).
- Flow: build record with `new Date().toISOString()` → `TokenUsageRecordSchema.parse` (rejects `--tokens 0`, `12.5`, negatives, non-enum `--model` before any write) → append to `[...(meta.token_usage ?? []), record]` → single `artifactStore.updateChange(changeName, { token_usage: next })` (full-metadata re-validation on write). Validation precedes the single write, so no partial state on failure.
- Success: `--json` → `outputJson({ change, task, agent, model, tokens })`; human → one confirmation line. Failure: `--json` → `outputJson({ error: { code: 4, type: 'tokens_record_error', message } })`, human → `console.error`, then `process.exit(4)`.

**Generator:**

```ts
export interface TokensReportInput {
  changeName: string
  /** 'YYYY-MM-DD', injected by the caller — the generator MUST NOT read the clock. */
  generatedAt: string
  tokenUsage: TokenUsageRecord[]                    // metadata.token_usage ?? []
  artifactTimings: Record<string, ArtifactTiming>   // metadata.artifact_timings ?? {}
}
export async function generateTokensReport(input: TokensReportInput): Promise<{ markdown: string }>
```

Template resolved via `new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname])` → `engine.render('tokens.md', {...})` (works from `src/` in dev and `dist/` at runtime). Purer than the UAT generator — the finalizer already holds the metadata, so the only I/O is the template read; two runs over identical inputs with a fixed date are byte-identical.

**Finalizer wiring:** Step 5c is structurally unreachable on the completeness/conflict/gate/dry-run return paths (the no-stray requirement is satisfied by placement, not defense); its own try/catch keeps UAT and tokens degradation fully independent; finalizer passes `generatedAt: new Date().toISOString().slice(0, 10)`.

**Progress:** `getAvgTokensPerChangeByTier(specDir, artifactStore)`; JSON payload key `avg_tokens_per_change_by_tier` beside `model_escalation_rate`; human line e.g. `  Avg tokens per change: trivial no data · quick 20k · standard 50k · full no data`.

**Skill instruction** (one verbatim block, byte-identical at all four anchors):

> After each subagent returns, record its reported token usage:
> `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name>`
> — `--task` is the artifact or task id it worked, `--agent` is the `subagent_type` you spawned, `--model` is the model alias you passed to `Agent(...)` (use `inherit` when you omitted the `model` parameter), and `--tokens` is the token count from its completion report. This applies to every spawn — planner, executor, reviewer, and verifier alike.

Always includes `--change <name>` explicitly, matching both recording precedents. Anchors: metta-plan — new step 2d before `metta complete` (old 2d → 2e); metta-execute — new paragraph directly after the `agent.model` pass-through paragraph (which defines the `--model` semantics); metta-verify — new step between steps 2 and 3 (renumber); metta-next — new `## Rules` bullet beside the commit-ownership rule.

## Dependencies

**Internal (all existing, no new modules):** `ArtifactStore.getChange`/`updateChange`/`writeArtifact`/`listChanges`/`archive`; `StateStore.read` for archive metadata; `TemplateEngine`; `ConfigLoader` (shared Step 5b instance, per-instance cache); `createCliContext`/`outputJson`/`getErrorMessage`; `ModelAliasEnum`; `formatThousandsK`; `copy-templates` build step (already covers `src/templates/artifacts/` and `hooks/`/`skills/`; `package.json` `files` already ships `src/templates`).

**External:** zod, commander — already in use; **zero new packages**. No AI provider calls anywhere (constitution constraint; the report is deterministic assembly).

**Vendor lock-in check:** none introduced. Everything is filesystem + local CLI. The recording *contract* assumes an orchestrator that reports subagent token usage (Claude Code today), but the CLI/schema/report are tool-agnostic — any orchestrator that can run a shell command can record; degradation is a visible GAPS entry, not breakage.

**Test-enforcement dependency:** `tests/template-deploy-sync.test.ts` auto-discovers every file under `src/templates/{skills,hooks}` and asserts byte-identical `.claude/` twins — the skill and guard-hook edits are covered automatically; no new identity test needed.

## Files to create / modify

**New source (3):**
- `src/cli/commands/tokens.ts`
- `src/finalize/tokens-report-generator.ts`
- `src/templates/artifacts/tokens.md`

**Modified source (7):**
- `src/schemas/change-metadata.ts` — `TokenUsageRecordSchema` + `token_usage` field
- `src/schemas/project-config.ts` — `TokensConfigSchema` + `tokens` field
- `src/cli/index.ts` — register `tokens`
- `src/finalize/finalizer.ts` — Step 5c, `FinalizeResult.tokensPath`/`tokensError`
- `src/cli/commands/finalize.ts` — `tokensPath`/`tokensWarning` in both output modes
- `src/util/ceremony-metrics.ts` — `getAvgTokensPerChangeByTier`
- `src/cli/commands/progress.ts` — JSON key + human line

**Hooks (2, byte-identical pair):**
- `.claude/hooks/metta-guard-bash.mjs`
- `src/templates/hooks/metta-guard-bash.mjs`

**Skills (8, four byte-identical pairs):**
- `src/templates/skills/metta-plan/SKILL.md` + `.claude/skills/metta-plan/SKILL.md`
- `src/templates/skills/metta-execute/SKILL.md` + `.claude/skills/metta-execute/SKILL.md`
- `src/templates/skills/metta-verify/SKILL.md` + `.claude/skills/metta-verify/SKILL.md`
- `src/templates/skills/metta-next/SKILL.md` + `.claude/skills/metta-next/SKILL.md`

**New tests (3):**
- `tests/tokens-command.test.ts` — mirrors `tests/model-escalation-command.test.ts` (append + JSON + ISO round-trip; subsequent append; `-5`/`12.5`/bad-model rejected without mutation; auto-select; multi-change exit 4 naming candidates; nonexistent `--change` exit 4)
- `tests/tokens-report-generator.test.ts` — mirrors `tests/uat-generator.test.ts` (all sections; determinism/byte-identity with fixed date; ordering rules; GAPS exact-match incl. fine-grained-task non-clearing; empty-usage full-GAPS; no-gaps wording; template placeholders present in the shipped `tokens.md`, per the `uat-template-contract` precedent)
- `tests/skill-tokens-record.test.ts` — mirrors `tests/skill-iteration-record.test.ts` (verbatim instruction present in all four templates)

**Modified tests (6):**
- `tests/schemas.test.ts` — `TokenUsageRecordSchema` block (valid record; 0/12.5/non-enum/unknown-key rejections; metadata without `token_usage` valid; `artifact_tokens` untouched); `TokensConfigSchema` block (default, strict rejections)
- `tests/metta-guard-bash.test.ts` — allow case for orchestrator-issued `metta tokens record ...` (byte-parallel to the model-escalation case)
- `tests/finalizer.test.ts` — Step 5c placement/ordering, degradation independence, partial-file cleanup, disabled toggle, dry-run/gate-failure no-stray, `tokensPath` in result
- `tests/cli-finalize.test.ts` — `tokensPath`/`tokensWarning` JSON and human shapes; error shapes unchanged
- `tests/ceremony-metrics.test.ts` — `getAvgTokensPerChangeByTier` unit cases (tier grouping, absent and empty-array exclusion, unknown-tier ignore, all-null empty result)
- `tests/progress-ceremony-metrics.test.ts` — extend `writeArchiveMetadata` with optional `token_usage`; tier averages across active+archived; per-tier null vs 0 in JSON; human no-data wording; pre-feature archive skipped

**Spec fix (1):**
- `spec/changes/token-usage-tracking-finalize-report-report-data-only-no/spec.md` — correct the `model: "cheap"` / `--model cheap` scenario datums to `haiku` and align the split requirement wording to "cheap/pinned (non-inherit) vs inherit" (ADR-1)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Skill-contract non-compliance (orchestrator forgets to record, or a change runs through out-of-scope skills — propose/quick/auto/fix-issues/fix-gap) | The GAPS section makes every unrecorded artifact visible in TOKENS.md — that visibility is the feature. The coverage gap for the five out-of-scope skills is an accepted, documented limitation; extend later if GAPS data shows it matters. |
| Spec-vs-schema contradiction ships as written (`model: "cheap"` fails its own schema) | ADR-1 resolves it in design; the spec.md datum fix is an explicit implementation task, so verify runs against a self-consistent spec. |
| Tokens-report failure blocks finalize, or a partial `TOKENS.md` is swept into the archive | Independent try/catch → `tokensError` warning, finalize proceeds; best-effort `rm` of the partial file in the catch; structural placement makes generation unreachable on all failure/dry-run paths. Covered by dedicated finalizer test cases. |
| Guard-hook copies or skill template/deployed pairs drift | `tests/template-deploy-sync.test.ts` auto-discovers and enforces byte-identity for both; `node --check` on both hook copies after edit; one verbatim instruction string removes per-skill drift surface. |
| Non-deterministic report output breaks the byte-identity scenario | Generator takes caller-injected `generatedAt` and never reads the clock; explicit ordering rules (record order / lexicographic); `TemplateEngine.substitute` is single-pass, so injected table content cannot re-trigger substitution. Determinism unit-tested with fixed inputs. |
| `token_usage` confused with the pre-existing `artifact_tokens` context-engine field | Distinct names, cross-referencing doc comments on both schemas, and a regression scenario asserting `artifact_tokens` parsing is byte-for-byte unchanged. |
| Progress averages skewed by empty arrays or unknown tier strings | ADR-3 excludes empty and absent arrays; unknown `workflow` values ignored for this metric; per-tier `null` (never `0`) for no-data, passed through verbatim in JSON — all unit-tested. |
| Fine-grained `--task` ids (e.g. `T1`) leave artifact-level gaps despite recorded usage | Accepted by ADR-2 (exact match keeps derivation deterministic); the skill instruction wording steers `--task` to artifact ids; such records still count in totals/rollups so no tokens are lost from the report. |
| finalize-ship spec accumulates non-finalize requirements (~94 → ~104) | Scope-note requirement authorizes future relocation via reconciliation; backlog a `token-observability` extraction if a second token feature lands. |
