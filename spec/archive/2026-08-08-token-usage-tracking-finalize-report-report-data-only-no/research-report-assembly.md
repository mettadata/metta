# Research: TOKENS.md Report Assembly at Finalize

Scope: the finalize-time `TOKENS.md` step only — assembler module design, template placement, finalizer wiring, config toggle, GAPS derivation. Recording CLI, guard hook, skill wording, and progress aggregate are covered by sibling research docs.

## 1. The UAT precedent, precisely

All findings below are from the worktree at the paths given.

### 1.1 Placement in `Finalizer.finalize` (`src/finalize/finalizer.ts`)

The finalize pipeline is strictly ordered; UAT generation is **Step 5b**, and the tokens step must slot in as **Step 5c** immediately after it:

1. Step 1 — load change metadata (`artifactStore.getChange`). **The full `ChangeMetadata` — including `token_usage` and `artifact_timings` — is already in memory here**; the tokens assembler needs no extra reads.
2. Step 2 — completeness gate: any incomplete required artifact returns early with `uatPath: null`. No report file is reachable.
3. Step 3 — dry-run merge for conflict detection; conflict returns early.
4. Step 4 — quality gates; failure (non-dry-run) returns early before any spec write.
5. Step 5 — caller dry-run returns here (`archiveName: '(dry-run)'`, `uatPath: null`); otherwise the real spec merge is written (a late conflict still aborts).
6. **Step 5b — UAT generation** (finalizer.ts:165-193): gated on `this.projectRoot`, lazily imports `ConfigLoader`, checks `config.uat.enabled`, calls `generateUat(...)`, writes via `this.artifactStore.writeArtifact(changeName, 'UAT.md', markdown)`.
7. Step 6 — `artifactStore.archive(changeName)` moves the change dir; `uatPath` is then computed as the **post-archive** path: `join(this.specDir, 'archive', archiveName, 'UAT.md')` when generated, else `null`.
8. Steps 6b-8 — gates.yaml into archive, doc generation (its own independent try/catch), refresh placeholder.

Properties the tokens step must replicate exactly:

- **Warn-and-continue degradation** — the whole Step 5b body is wrapped in `try/catch`; on error it sets `uatError = getErrorMessage(err)` and finalize proceeds. The catch also does **best-effort cleanup of a partially written file**: `rm(join(specDir, 'changes', changeName, 'UAT.md'), { force: true }).catch(() => {})` so a truncated file is never swept into the archive.
- **No stray file on failed paths** — structural, not defensive: generation code is simply unreachable on the completeness/conflict/gate/dry-run return paths. The spec's "No Stray Tokens Report" requirement is satisfied for free by placement.
- **Config-loader reuse** — Step 5b declares `let configLoader` in method scope and uses `configLoader ??= new ConfigLoader(...)`; Step 7 reuses the same instance (per-instance cache makes the second `load()` free). Step 5c should join this pattern.
- **Date injection** — the finalizer passes `generatedAt: new Date().toISOString().slice(0, 10)`; the generator "MUST NOT read the clock" (uat-generator.ts:17). This is what makes the determinism scenario (fixed date → byte-identical output) testable.
- **Result/CLI flow** — `FinalizeResult` carries `uatPath: string | null` and optional `uatError`; the result spread is `...(uatError ? { uatError } : {})` (finalizer.ts:249). In `src/cli/commands/finalize.ts`: JSON success payload adds `uatPath: result.uatPath` and `...(result.uatError ? { uatWarning: result.uatError } : {})` (lines 146-147); human mode prints `  UAT script: <path>` when present and a yellow `Warning: UAT generation failed: ...` on `uatError` (lines 172-173). `tokensPath`/`tokensError`→`tokensWarning` should be four parallel lines.

### 1.2 The assembler module (`src/finalize/uat-generator.ts`)

Key facts: the "UAT assembler" is **not** in a `src/uat/` directory — it is a sibling file of the finalizer, `src/finalize/uat-generator.ts`. It is functional-core style: one exported async function `generateUat(input): Promise<UatGeneratorResult>` over a typed input struct, pure computation in module-private helpers, I/O limited to reading change-dir files and the template. Its final act renders through the shared `TemplateEngine`:

```ts
const engine = new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname])
const markdown = await engine.render('uat.md', { change_name, generated_date, source_tier, uat_steps })
```

The `import.meta.url`-relative path resolves to `src/templates/artifacts/` in dev and `dist/templates/artifacts/` at runtime, because `tsc` emits `dist/finalize/uat-generator.js` and the build's `copy-templates` script copies `src/templates/artifacts` → `dist/templates/artifacts` wholesale (package.json:18). **A new `src/templates/artifacts/tokens.md` therefore requires zero build-script changes**, and `package.json` `files` already ships `src/templates` (line 14).

### 1.3 The template (`src/templates/artifacts/uat.md`)

The template is a thin skeleton — title, metadata bullet list with `{change_name}` / `{generated_date}` / `{source_tier}` placeholders, fixed prose, and one `{uat_steps}` body slot. All tables/structure are computed in TypeScript and injected as a pre-rendered markdown string. `TemplateEngine.substitute` is a single-pass `\{(\w+)\}` replace over the template (unknown keys are left literal; injected values are not re-scanned), so injected table content cannot trigger recursive substitution.

### 1.4 Test precedent

`tests/uat-generator.test.ts` (generator unit tests), `tests/finalizer.test.ts` (pipeline placement, degradation, no-stray-file), `tests/cli-finalize.test.ts` (output shapes), `tests/uat-template-contract.test.ts` (template placeholders present in the shipped file). A `tests/tokens-report-generator.test.ts` plus additions to the finalizer/CLI tests maintains the near-1:1 ratio.

## 2. Config toggle precedent (`src/schemas/project-config.ts`)

`UatConfigSchema` (lines 45-49) is the exact shape to clone:

```ts
export const UatConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()
```

wired as `uat: UatConfigSchema.default({})` on `ProjectConfigSchema` (line 108). `TokensConfigSchema` + `tokens: TokensConfigSchema.default({})` as an adjacent sibling gives: strict rejection of unknown keys/non-boolean `enabled`, and omitted-key defaulting to enabled — all three config scenarios in the spec, with no `ConfigLoader` changes (it just parses the schema; `config.tokens` flows to the finalizer through the same `configLoader.load()` call Step 5b already makes).

## 3. Data inputs and the GAPS derivation (`src/schemas/change-metadata.ts`)

- `artifact_timings: z.record(z.string(), ArtifactTimingSchema).optional()` (line 86) — keyed by **artifact id**. Written in two places: `src/cli/commands/instructions.ts:124-150` stamps `artifact_timings[id].started` when instructions for an artifact are emitted (best-effort), and `src/cli/commands/complete.ts:39-53` stamps `.completed` on `metta complete`. So a key's presence is evidence an artifact's work was started/run — exactly the spec's "expected-run set = `artifact_timings` keys".
- `model_runs: z.array(ModelRunSchema).optional()` (line 94) — `{ task, model, timestamp }`, appended in `instructions.ts:154-161` **only for non-inherit executor resolutions**. It is therefore a *subset* of runs and per the spec is corroborating evidence only; the GAPS derivation is defined over `artifact_timings` keys alone, which is the right call (inherit-model runs leave no `model_runs` record but do leave a timing).
- `artifact_tokens` (line 87, `{ context, budget }`) — context-engine figures. The tokens report must not read or confuse this field; naming discipline: the new field is `token_usage`, records `TokenUsageRecordSchema`.

**Gap rule (recommended):** `gaps = sortedKeys(artifact_timings ?? {}).filter(k => !token_usage.some(r => r.task === k))` — exact string match of `token_usage[].task` against timing keys. Records whose `task` doesn't match any timing key (e.g. fine-grained task ids like `T1` under an `implementation` artifact) still count in totals/rollups but don't clear a gap; that is faithful to the spec text ("no matching `token_usage` record for that task") and keeps the derivation deterministic. Worth one sentence in the design doc so the skill wording steers orchestrators toward artifact-id-valued `--task`. Empty/absent `token_usage` with non-empty timings → fully-populated GAPS section (spec scenario "No token records still yields a report"); empty timings and empty usage → empty table, zero total, and GAPS says "no gaps found" (there is no expected-run evidence).

## 4. One spec inconsistency to surface for design

`ModelAliasEnum` is `['sonnet', 'opus', 'haiku', 'fable', 'inherit']` (project-config.ts:77) — **there is no `cheap` alias**. Yet the spec delta's Token Usage Record Schema scenario feeds `model: "cheap"` through `TokenUsageRecordSchema.parse` and expects success, and the report requires a "cheap-vs-inherit split ... tokens recorded at the `cheap` alias". In the existing codebase "cheap tier" is prose shorthand (progress.ts:221, ceremony-metrics.ts:131-135, model-resolver PROFILE_MAP where budget→`haiku`/`sonnet`) for *non-inherit executor resolutions*, never an enum value. Design must pick one:

- (a) compute the split as **non-inherit vs inherit** (sum of tokens where `model !== 'inherit'` vs `=== 'inherit'`), matching existing "cheap-tier runs" terminology, and correct the schema scenario to a real alias — **recommended**; zero schema churn, consistent with `getModelEscalationRate` semantics; or
- (b) add `'cheap'` to `ModelAliasEnum` — rejected: the enum backs `ModelsConfigSchema.executor` and `model_runs`/`model_escalations`, so a `cheap` value would leak into model-resolution config, which this observability-only change must not touch.

This affects the assembler's split computation and one spec scenario; flagging here so it is settled in design, not discovered in execute.

## 5. Options for the assembler

### Option A — `src/finalize/tokens-report-generator.ts`, pure-data input, template in `src/templates/artifacts/tokens.md` (recommended)

Sibling file of `uat-generator.ts`, exporting one function:

```ts
export interface TokensReportInput {
  changeName: string
  /** 'YYYY-MM-DD', injected by the caller — the generator MUST NOT read the clock. */
  generatedAt: string
  tokenUsage: TokenUsageRecord[]          // metadata.token_usage ?? []
  artifactTimings: Record<string, ArtifactTiming>  // metadata.artifact_timings ?? {}
}
export async function generateTokensReport(input: TokensReportInput): Promise<{ markdown: string }>
```

All sections (total, per-artifact table, per-role rollup, per-model rollup, split, GAPS) are pure computation over the input arrays; the only I/O is the template load via `new TemplateEngine([new URL('../templates/artifacts', import.meta.url).pathname])` and `engine.render('tokens.md', {...})`. Template carries the header skeleton (`{change_name}`, `{generated_date}`, the approximate-figures disclaimer as fixed prose) and one-or-few body slots (`{tokens_body}`, or per-section slots `{totals}`, `{per_artifact_table}`, ... — per-section slots make the template contract test stronger; either satisfies the rule). Finalizer Step 5c mirrors Step 5b line-for-line: `config.tokens.enabled` gate, `generateTokensReport({...})`, `artifactStore.writeArtifact(changeName, 'TOKENS.md', markdown)`, catch → `tokensError` + best-effort `rm` of the partial `TOKENS.md`; post-archive `tokensPath` computed next to `uatPath`.

- Pros: closest possible mirror of the precedent (same directory, same function shape, same template mechanism, same finalizer wiring, same test layout); *purer* than the UAT generator because the finalizer already holds the metadata — no filesystem reads at all beyond the template, making the two byte-identical-runs scenario a trivial unit test; zero build changes (`copy-templates` copies the whole `artifacts/` dir); degradation independence between UAT and tokens falls out of separate try/catch blocks, matching the existing Step 5b vs Step 7 independence.
- Cons: `src/finalize/` grows by one file (it has five today — fine); none of substance.

### Option B — new top-level `src/tokens/` module directory

`src/tokens/tokens-report-generator.ts` (+ future tokens code) with its own barrel.

- Pros: a home if token features multiply (aggregation, budgets).
- Cons: **diverges from the precedent this spec repeatedly says to mirror** — UAT lives in `src/finalize/`, not `src/uat/`; the rest of this change scatters naturally anyway (schema → `src/schemas/`, CLI → `src/cli/commands/tokens.ts` beside `model-escalation.ts`, progress metric → `src/util/`), so a `src/tokens/` dir would hold exactly one file; the template resolution path would become `../templates/artifacts` from a different depth — same string, but a second module tree to keep aligned. Budgets/routing are explicitly out of scope, so the "future growth" argument is speculative.

### Option C — fold assembly inline into `Finalizer.finalize`

- Pros: no new file.
- Cons: rejected outright — violates functional-core/imperative-shell, breaks the 1:1 test-file convention (the assembler's rollup/GAPS logic wants direct unit tests, not finalize-pipeline tests), bloats a 250-line method that is already the imperative shell, and contradicts the precedent (`generateUat` was deliberately extracted).

### Template placement sub-decision

`src/templates/artifacts/tokens.md` is the only placement consistent with the precedent: `artifacts/` already holds change-artifact templates (`uat.md`, `intent.md`, `spec.md`, ...), the copy-templates script and `package.json` `files` already cover it, and the UAT generator's search path points there. A new `src/templates/reports/` dir would need copy-script and search-path additions for no benefit.

## 6. Recommendation

**Option A.** Create `src/finalize/tokens-report-generator.ts` (pure-data input, caller-injected date, single exported `generateTokensReport`) rendering `src/templates/artifacts/tokens.md` via `TemplateEngine`; wire it as Step 5c in `Finalizer.finalize` — after the UAT block, before `artifactStore.archive` — with its own `config.tokens.enabled` gate (from `TokensConfigSchema`, a strict sibling of `UatConfigSchema` defaulting `{ enabled: true }`), its own try/catch setting `tokensError` with best-effort partial-file cleanup, and `tokensPath` computed post-archive exactly as `uatPath` is; surface `tokensPath`/`tokensWarning` in `src/cli/commands/finalize.ts` as four lines parallel to the existing uat lines. GAPS = sorted `artifact_timings` keys with no exact-match `token_usage.task`. Deterministic ordering rule for byte-identical output: per-artifact table in record (append/chronological) order; per-role, per-model rollups and GAPS sorted lexicographically.

**Carry-forward flags for design:**
1. The `cheap` alias does not exist in `ModelAliasEnum` — compute the split as non-inherit vs inherit and fix the spec scenario datum (Section 4).
2. Gap matching is exact `task` == timing key; skill wording should direct `--task` to artifact ids (Section 3).
3. No-projectRoot finalizer construction skips tokens generation with `tokensPath: null`, same as UAT today.

No external grounding was required: every question in this phase (finalizer behavior, template pipeline, schema shapes, build copy step) is answered deterministically by the worktree source; no external API or library behavior was in question.
