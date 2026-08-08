VERDICT: PASS

# Quality Review: token-usage-tracking-finalize-report-report-data-only-no

Reviewer focus: dead code, naming consistency, duplication, test coverage gaps,
TypeScript strictness, doc comments, commit hygiene.

Scope reviewed: all 24 files in `git diff main...HEAD -- src tests`, plus the
second guard-hook copy (`.claude/hooks/metta-guard-bash.mjs`), against the
mirrored precedents (`model-escalation.ts`, `uat-generator.ts`,
`ceremony-metrics.ts`).

Verification run in the worktree:
- `npx tsc --noEmit` — clean (exit 0)
- `vitest run` on tokens-report-generator, skill-tokens-record, schemas,
  ceremony-metrics, finalizer, tokens-command — 252/252 passing

## Summary

Clean, disciplined implementation. Every new surface faithfully mirrors its
stated precedent (`registerTokensCommand` mirrors `registerModelEscalationCommand`
line-for-line; `generateTokensReport` mirrors `generateUat`'s pure-helpers +
orchestration layout and clock-injection contract; `getAvgTokensPerChangeByTier`
mirrors `getModelEscalationRate`'s never-throw scan). Test-to-source mapping is
fully 1:1 (3 new source surfaces ↔ 3 new test files; all 6 modified sources have
matching modified tests). No Critical or Major findings — 4 Minor.

## Findings

### Critical

None.

### Major

None.

### Minor

1. **`src/finalize/finalizer.ts:212-216` — Step 5c re-imports `ConfigLoader` and
   re-runs `configLoader.load()` despite the shared `configLoader ??=` variable.**
   The `let configLoader` hoisted above Step 5b (line 180) exists precisely to
   share the loader between 5b and 5c, yet 5c still dynamically re-imports the
   class (a binding that goes unused at runtime whenever 5b already assigned the
   variable) and calls `.load()` a second time. This is duplication *beyond* the
   deliberate structural mirroring — the half-finished sharing suggests the
   intended factoring (load `config` once above both steps, branch on
   `config.uat.enabled` / `config.tokens.enabled`) was started but not completed.
   Fix suggestion: hoist a single config load above Step 5b; both steps read
   their own toggle from it. Behavior-neutral.

2. **`src/cli/commands/progress.ts:234` vs `src/util/ceremony-metrics.ts:608` —
   fixed tier order duplicated; exported `WorkflowTier` type is unused outside
   its module.** `progress.ts` re-declares
   `(['trivial', 'quick', 'standard', 'full'] as const)` inline because
   `WORKFLOW_TIERS` is module-private, while the exported `WorkflowTier` type has
   no importers anywhere in `src/` or `tests/` (near-dead export). If the tier
   set ever changes, the two lists can drift silently (the human render would
   just skip/invent tiers — no type error, since indexing
   `Record<WorkflowTier, ...>` with the wider literal union still checks).
   Fix suggestion: export `WORKFLOW_TIERS` from `ceremony-metrics.ts`, iterate it
   in `progress.ts`, and derive `WorkflowTier` as
   `typeof WORKFLOW_TIERS[number]` — one source of truth, and the type export
   earns its keep.

3. **`src/util/ceremony-metrics.ts:629-687` — third copy of the
   active-changes + archive scan skeleton.** `getAvgTokensPerChangeByTier`
   repeats the `listChanges`/`getChange` loop and the
   `readdir(archive)` + `StateStore.read(ChangeMetadataSchema)` loop already
   present in `getArtifactsPerSmallChange` (lines ~100-116) and
   `getModelEscalationRate` (lines ~147-186), including identical catch-and-skip
   comments. Mirroring the precedent was the right default and is not flagged as
   such — but at three instances the pattern has crossed from mirroring into a
   factoring opportunity: a shared
   `forEachChangeMetadata(specDir, store, visit)` helper would collapse ~40
   duplicated lines per metric and pin the skip-corrupt-entries semantics in one
   place. Suggestion for a follow-up refactor; not a blocker on this change.

4. **`tests/tokens-command.test.ts:10-27` — local `runCli`/`CLI_PATH` duplicate
   `tests/helpers/cli.ts`.** Noted and accepted: this faithfully mirrors the
   direct precedent (`tests/model-escalation-command.test.ts:10-12` does the
   same), so it is the codebase's established pattern for command tests, not a
   new regression. If the helper duplication ever gets consolidated, both files
   should move together.

## Checks that came back clean

- **Dead code / unused exports:** none found beyond the `WorkflowTier` nit in
  finding 2. All new exports (`TokenUsageRecordSchema`, `TokenUsageRecord`,
  `TokensConfigSchema`, `TokensConfig`, `generateTokensReport`,
  `TokensReportInput`, `TokensReportResult`, `getAvgTokensPerChangeByTier`,
  `registerTokensCommand`, `tokensPath`/`tokensError` on `FinalizeResult`) have
  real consumers in src or tests. Private helpers in
  `tokens-report-generator.ts` (`fmt`, `rollup`, `renderTable`, `renderSplit`,
  `computeGaps`, etc.) are each used.
- **Naming consistency:** `registerTokensCommand`, `tokens_record_error` +
  exit 4, auto-select-single-change wording, and the Zod-parse-then-append shape
  all match `model-escalation.ts` exactly. `getAvgTokensPerChangeByTier` and the
  snake_case JSON key `avg_tokens_per_change_by_tier` match the
  ceremony-metrics conventions. `tokens-report-generator.ts` is kebab-case;
  `TokensReportInput`/`TokensReportResult` reasonably parallel
  `UatGeneratorInput`/`UatGeneratorResult`. `fmt` (comma thousands) is not a
  duplicate of `progress.ts`'s `formatThousandsK` (rounds to `Nk`) — different
  semantics, correctly kept separate.
- **TypeScript strictness:** no `any` anywhere in the diff; `Parameters<typeof
  realRender>` / `unknown`-narrowing used in test mocks; all new imports carry
  `.js` extensions per Node16 ESM; `tsc --noEmit` clean.
- **Doc comments:** the `token_usage` vs `artifact_tokens` disambiguation is
  present in all three places it matters — `TokenUsageRecordSchema` doc
  (change-metadata.ts:430-434), inline comments on both fields inside
  `ChangeMetadataSchema` (change-metadata.ts:452, 460-461), and the
  `registerTokensCommand` header (tokens.ts:14-15). The report-data-only intent
  ("nothing reads these records to make routing decisions") is stated on the
  command doc.
- **Test coverage:** near-1:1 ratio holds. New tests cover append order,
  rollup sorting, the T1-vs-tasks exact-match gap rule, empty/absent
  `token_usage` (never counted as 0), non-tier workflows, corrupt archive
  entries, config toggle default/off, degraded finalize (template failure,
  partial-write cleanup, EISDIR injection), UAT-tokens independence both ways,
  dry-run/abort paths asserting no stray TOKENS.md, byte-for-byte preservation
  of the `incomplete_artifacts` and `gates_failed` JSON payload shapes, guard
  hook allowance, and the verbatim skill instruction across all four SKILL.md
  files. Template contract test mirrors the uat-template-contract precedent.
  Only unexercised edge: a non-numeric `--tokens abc` (NaN path) — subsumed by
  the 12.5 and -5 rejections through the same `z.number().int().positive()`
  check; not worth blocking on.
- **Templates:** `tokens.md` is a real template file rendered via
  `TemplateEngine` — no string-literal templates in TS, per the constitution.
- **Guard hook:** both copies (`src/templates/hooks/metta-guard-bash.mjs:24`
  and `.claude/hooks/metta-guard-bash.mjs:24`) carry the `tokens` allowance
  with a rationale comment consistent with the `iteration`/`model-escalation`
  entries.
- **Commit hygiene:** all 30 branch commits are conventional
  (`feat`/`docs`/`chore` with the change-name scope); implementation vs
  artifact-ceremony commits are correctly typed.
