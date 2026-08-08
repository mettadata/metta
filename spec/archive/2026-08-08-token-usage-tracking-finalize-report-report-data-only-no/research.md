# Research: token-usage-tracking-finalize-report-report-data-only-no

## Decision: Mirror the established precedents on every axis — finalize-ship merge target, model-escalation CLI clone, UAT-generator report clone, verbatim skill instruction, ceremony-metrics helper

Four parallel research tracks were run; per-approach findings live in:

- [research-capability-mapping.md](research-capability-mapping.md)
- [research-recording-channel.md](research-recording-channel.md)
- [research-report-assembly.md](research-report-assembly.md)
- [research-skill-contract-progress.md](research-skill-contract-progress.md)

### Approaches Considered

1. **Capability mapping — extend `finalize-ship` as single merge target with scope note** (selected) — `src/finalize/spec-merger.ts` supports exactly one H1-derived capability per change, so a multi-capability split is structurally impossible in one change; the UAT delta (2026-07-21, H1 `finalize-ship`) and model-escalation delta (2026-07-17, scope-note pattern) are the two closest precedents and both chose this shape. A net-new `token-observability` capability was rejected: it would split the finalizer's step-order/degradation contract across two specs, and the only prior net-new instrumentation capability (iteration-record slug) was erased in the 2026-07-16 spec reset.
2. **CLI surface — `tokens` group with `record` subcommand in `src/cli/commands/tokens.ts`** (selected) — structural clone of `model-escalation.ts` (createCliContext, verbatim auto-selection block, Zod-parse before single `updateChange` append, `outputJson` success payload, `{error:{code:4,type:'tokens_record_error',message}}` + exit 4). Flat `tokens-record` and nesting under an existing group were rejected (breaks sibling pattern and guard first-word classification). Guard hooks: add `'tokens'` to `ALLOWED_SUBCOMMANDS` in both copies (`.claude/hooks/` and `src/templates/hooks/`), byte-identical, `node --check` after edit; `tests/template-deploy-sync.test.ts` enforces identity automatically.
3. **Report assembly — `src/finalize/tokens-report-generator.ts` + `src/templates/artifacts/tokens.md`** (selected) — pure-data input (`{changeName, generatedAt, tokenUsage, artifactTimings}`, caller-injected date, generator never reads the clock), rendered via the shared `TemplateEngine`; wired as Step 5c in `Finalizer.finalize` after the UAT Step 5b block and before archive, with its own `config.tokens.enabled` gate (`TokensConfigSchema` strict sibling of `UatConfigSchema`, default `{enabled: true}`), independent try/catch → `tokensError` with best-effort partial-file `rm`, and post-archive `tokensPath` computed exactly like `uatPath`. Zero build changes — `copy-templates` already ships `src/templates/artifacts/`. A `src/tokens/` module dir and inline-in-finalizer assembly were rejected (diverge from precedent / violate functional core).
4. **Skill contract + progress — one verbatim instruction, four anchors; `getAvgTokensPerChangeByTier` helper** (selected) — a single byte-identical recording instruction inserted at: metta-plan new step 2d, metta-execute directly after the `agent.model` pass-through paragraph, metta-verify between steps 2 and 3, metta-next as a `## Rules` bullet beside the commit-ownership rule. Always include `--change <name>` explicitly (both existing recording precedents do). Content test: new `tests/skill-tokens-record.test.ts` mirroring `skill-iteration-record.test.ts`. Progress: new helper in `src/util/ceremony-metrics.ts` cloned from `getModelEscalationRate` (active via ArtifactStore, archives via `StateStore.read('archive/<entry>/.metta.yaml')`, catch-skip per entry), fixed four tier keys `trivial|quick|standard|full`, per-tier `{mean, sample_size} | null`, JSON key `avg_tokens_per_change_by_tier` with verbatim null passthrough, human line with explicit `no data` wording. Per-skill tailored phrasing and dynamic tier keys were rejected (drift risk / unstable JSON shape).

### Rationale

Every open question had a deterministic in-repo answer; no external grounding was required. The change is deliberately the union of two shipped precedents — the UAT finalize report and the model-escalation contractual recording — and all four tracks independently converged on "mirror the precedent exactly": same directories, same function shapes, same template mechanism, same guard classification, same test harnesses (`tests/model-escalation-command.test.ts`, `tests/uat-generator.test.ts`, `tests/finalizer.test.ts`, `tests/progress-ceremony-metrics.test.ts` as direct templates). This minimizes review surface and keeps the byte-identity and degradation properties testable with existing conventions.

### Design-phase carry-forward flags (must be settled in design.md)

1. **`cheap` is not a `ModelAliasEnum` member** (`['sonnet','opus','haiku','fable','inherit']`). The spec delta's schema scenario feeds `model: "cheap"` and mandates a "cheap-vs-inherit split" — as written the example record fails its own schema. All three affected tracks independently recommend: record concrete aliases, compute the split as **non-inherit vs inherit**, and correct the spec scenario datum via MODIFIED in design/tasks. Adding `'cheap'` to the enum is rejected — it would leak into model-resolution config, violating the observability-only constraint.
2. **GAPS derivation rule:** `gaps = sortedKeys(artifact_timings ?? {}).filter(k => !token_usage.some(r => r.task === k))` — exact string match; records with fine-grained task ids count in totals/rollups but do not clear gaps. Skill wording steers `--task` toward artifact ids. Empty timings + empty usage → "no gaps found"; timings without records → fully-populated GAPS.
3. **Deterministic ordering** for byte-identical output: per-artifact table in record order; rollups and GAPS sorted lexicographically.
4. **Empty-array tier exclusion:** changes with absent `token_usage` are excluded from the progress average (spec-mandated); recommend also excluding present-but-empty arrays — design to confirm.
5. **Known coverage gap (accepted):** metta-propose/quick/auto/fix-issues/fix-gap skills are out of scope for the recording instruction; changes driven through them will show gaps in TOKENS.md — that visibility is the feature, not a bug.
6. **No-projectRoot finalizer** skips tokens generation with `tokensPath: null`, same as UAT today.
7. Schemas spec uses a legacy numbered format — any future relocation of the `token_usage` schema requirement needs format-aware reconciliation (noted for posterity, no action now).

### Artifacts Produced

- [Approach: capability mapping](research-capability-mapping.md)
- [Approach: recording channel — CLI/schema/guard](research-recording-channel.md)
- [Approach: report assembly — TOKENS.md](research-report-assembly.md)
- [Approach: skill contract + progress aggregate](research-skill-contract-progress.md)
