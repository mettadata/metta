# Review: token-usage-tracking-finalize-report-report-data-only-no

Merged from three parallel reviewer personas (iteration 1). Overall: **PASS_WITH_WARNINGS** — 0 Critical, 0 Major findings across all three; 14 Minor findings noted below for follow-up, none blocking.

- Correctness: PASS_WITH_WARNINGS (5 minor)
- Security: PASS_WITH_WARNINGS (5 minor)
- Quality: PASS (4 minor)

---

VERDICT: PASS_WITH_WARNINGS

# Correctness Review: token-usage-tracking-finalize-report-report-data-only-no

Reviewer scope: logic errors, off-by-one, edge cases, spec Given/When/Then compliance.
All 10 relevant test files were run in the worktree: 450/450 pass.

## Spec compliance matrix (every scenario checked against implemented behavior)

| Requirement | Scenarios | Status |
|---|---|---|
| Token Usage Record Schema | valid record round-trip; 0 / 12.5 / bad-model / unknown-key rejected; metadata without `token_usage` valid, `artifact_tokens` untouched | Implemented (`src/schemas/change-metadata.ts:71-78,102,111-113`) and tested (`tests/schemas.test.ts`) |
| Tokens Record CLI Command | single-change append; `--change beta` targeting; ambiguous/missing change exit 4; invalid tokens writes nothing | Implemented (`src/cli/commands/tokens.ts`), structural clone of `model-escalation.ts` confirmed; validation (`TokenUsageRecordSchema.parse`) strictly precedes the single `updateChange` write, so exit-4 paths leave no partial state — verified by tests asserting `token_usage` stays `undefined` after each rejection |
| Guard Hook Allowlist | allow `tokens`; byte-identical copies; `node --check`; other classifications unchanged | Verified directly: `diff` of both hook copies is empty, `node --check` passes on both, diff shows exactly one added `ALLOWED_SUBCOMMANDS` line per copy |
| Skill Recording Instruction | four skills carry the instruction; template/deployed pairs byte-identical; no routing wording changed | Verified: all four pairs byte-identical (`diff -q`); diffs show only the added verbatim instruction plus mechanical renumbering (plan 2d->2e, verify 3/4->4/5); `tests/skill-tokens-record.test.ts` + auto-discovering `tests/template-deploy-sync.test.ts` enforce it |
| Report Generation At Finalize | pre-archive write swept into archive; deterministic/template-driven/AI-free; empty usage still yields report | Step 5c (`src/finalize/finalizer.ts:207-233`) sits after the real merge and before `archive`; generator (`src/finalize/tokens-report-generator.ts`) is clock-free with caller-injected `generatedAt`; determinism byte-identity tested |
| Report Content | full sections; GAPS exact-match; no-gaps wording | All seven sections in order in `src/templates/artifacts/tokens.md`; GAPS is exact string match per ADR-2 (`computeGaps`, lines 88-93), fine-grained `T1` counts in totals but does not clear the `tasks` gap — tested; split figures sum to total by construction (every record goes to exactly one of the two accumulators, `renderSplit` lines 63-74) — tested |
| Config Toggle | disabled skips cleanly; omitted key defaults enabled; strict rejection | `TokensConfigSchema` (`src/schemas/project-config.ts:51-53`) mirrors `UatConfigSchema`; `tokens: TokensConfigSchema.default({})` wired; all three scenarios tested |
| No Stray TOKENS.md | gate failure, dry-run, incomplete artifacts, merge conflict | Structurally unreachable: all four early returns precede Step 5c and each carries `tokensPath: null` (finalizer.ts:94,113,139,156,173); dry-run returns at Step 5 before generation; each path has a dedicated no-stray finalizer test |
| Failure Degradation | assembly error degrades to warning; both output modes report it | Independent try/catch per step; Step 5c failure sets `tokensError`, best-effort `rm` of partial file, finalize proceeds; independence verified BOTH directions (UAT fails -> tokens still generated, and vice versa) in `tests/finalizer.test.ts` |
| Tokens Path In Output | JSON additive `tokensPath`; human line; disabled -> null + no line; error shapes untouched | `src/cli/commands/finalize.ts:148-149,176-177`; `tests/cli-finalize.test.ts` asserts exact key-set equality on `incomplete_artifacts` and `gates_failed` payloads (byte-for-byte shape), success payload carries `tokensPath` string, disabled -> `null` |
| Progress Avg By Tier | tier averages (20000/50000 datum reproduced exactly); no-data null vs 0; pre-feature archives skipped | `getAvgTokensPerChangeByTier` (`src/util/ceremony-metrics.ts:212-272`): absent field AND empty array both excluded (ADR-3), unknown tiers ignored, all four keys always emitted, per-tier `null` passed through verbatim in JSON; the spec's exact 10000+30000->20000 / 50000 datum is reproduced in `tests/progress-ceremony-metrics.test.ts` |

Also verified: `formatThousandsK` exists (local to `progress.ts:269`); `copy-templates` already covers `src/templates/artifacts/` so `tokens.md` ships with zero build changes; `TemplateEngine.substitute` is single-pass `String.replace` with a callback, so injected table content can neither re-trigger substitution nor suffer `$`-pattern corruption; an unloadable config correctly degrades 5b and 5c independently (each re-runs `load()` under its own try/catch).

## Issues Found

### Critical (must fix)

None.

### Major (should fix)

None.

### Minor

1. **Untested spec datum: zero-active-changes error path.** Spec scenario "Ambiguous or missing change fails typed with exit 4" covers GIVEN *zero* active changes OR two; `tests/tokens-command.test.ts` tests the two-change and nonexistent-`--change` cases but never the zero-change case (`'No active changes.'`, `src/cli/commands/tokens.ts:41`). The code path is correct by inspection (clone of model-escalation), but the scenario datum is unverified. Fix: add one test with no changes created asserting exit 4 and message `No active changes.`

2. **`Number(options.tokens)` is permissive** (`src/cli/commands/tokens.ts:52`): `--tokens 1e3` -> 1000 and `--tokens 0x20` -> 32 pass validation. Zod correctly rejects `NaN`, `Infinity`, floats, zero, and negatives, so no partial-state risk exists — but non-decimal notations are silently accepted. Suggestion: pre-check `/^\d+$/.test(options.tokens)` for a crisper contract (matches the trigger pre-check pattern in `model-escalation.ts:36-43`).

3. **Markdown table cells are not pipe-escaped** (`src/finalize/tokens-report-generator.ts:41-47,55-59`): a `task` or `agent` value containing `|` would corrupt the per-artifact/rollup table rendering (output stays deterministic, only cosmetically broken). Practically unreachable via the skill contract; suggestion only — escape `|` as `\|` in cell values.

4. **Human tiers-with-data under 500 tokens render as `0k`** (`progress.ts:236,269-270` — `Math.round(mean/1000)`). The spec's no-data-never-rendered-as-`0` constraint applies only to *no-data* tiers (which correctly render `no data`), so this complies, but a tier whose real mean is e.g. 400 displays `0k`, which a reader could confuse with no data. Cosmetic; consistent with the existing `formatThousandsK` convention.

5. **Human confirmation line of `tokens record` untested** ("exits zero with a confirmation" datum in the first CLI scenario). All success-path tests use `--json`. The line exists (`tokens.ts:66-68`); one non-JSON assertion would close the datum.

## Verdict

PASS_WITH_WARNINGS — no correctness defects found; every spec Given/When/Then scenario has matching implemented behavior; 5 minor findings (2 small test-coverage gaps against explicit spec datums, 3 hardening/cosmetic suggestions).

---

# Security Review: token-usage-tracking-finalize-report-report-data-only-no

VERDICT: PASS_WITH_WARNINGS

Scope reviewed: `git diff main...HEAD -- src tests .claude/hooks` — guard-hook allowlist
(both copies), `src/cli/commands/tokens.ts`, `src/finalize/tokens-report-generator.ts`,
`src/finalize/finalizer.ts`, `src/templates/template-engine.ts` (substitution behavior),
`src/templates/artifacts/tokens.md`, schema changes, skill template wording, and tests.

## Findings

### Critical

None.

### Major

None.

### Minor

1. **Guard allowlist is broader than the feature needs** —
   `.claude/hooks/metta-guard-bash.mjs:24` and `src/templates/hooks/metta-guard-bash.mjs:24`.
   `'tokens'` is added to `ALLOWED_SUBCOMMANDS` (single-word allow), which allowlists
   `metta tokens <anything>` — not just `tokens record`. Today the CLI registers only
   `record` (`src/cli/commands/tokens.ts:23`), so any other third word fails in Commander
   and there is no privilege gain now; but any future `tokens` subcommand (e.g. a
   hypothetical `tokens clear`) would be silently pre-authorized without guard re-review.
   The hook already has the precise mechanism for this: `ALLOWED_TWO_WORD`.
   *Fix:* move the entry to `ALLOWED_TWO_WORD` as `['tokens', new Set(['record'])]` in
   both copies, so unknown `tokens` subcommands stay fail-closed. (Note: this follows the
   existing `iteration` / `model-escalation` precedent, so it is a hardening item, not a
   regression introduced by this change.)

2. **No markdown escaping of untrusted record strings in the report** —
   `src/finalize/tokens-report-generator.ts:42-49` (`renderTable`), `:58`
   (`[r.task, r.agent, ...]`), `:94` (backtick-wrapped gap keys). `task` and `agent` are
   free-form strings (Zod only enforces `min(1)`) injected verbatim into markdown table
   cells; a value containing `|`, a newline, or a backtick breaks the table / code-span
   structure and can forge report content (including text later read by AI agents —
   a prompt-injection carrier into archived artifacts). The writer of these records is
   the local orchestrator, which already has repo write access, so this is not a hard
   trust-boundary break — but the report should be structurally robust.
   *Fix:* escape `|` (`\|`), strip `\r\n` from `task`/`agent` before rendering, and
   escape backticks in `renderGaps`. `model` is safe (enum-constrained,
   `src/schemas/project-config.ts:83`).

3. **Skill wording interpolates subagent-reported text into a shell command** —
   `src/templates/skills/metta-execute/SKILL.md:50`, `metta-plan/SKILL.md:24`,
   `metta-verify/SKILL.md:26`, `metta-next/SKILL.md:30`. The instruction tells the
   orchestrator to build `metta tokens record ... --tokens <count>` from "the token count
   from its completion report" — i.e. lower-trust subagent output flows into a Bash
   command line. A prompt-injected completion report (e.g. `1000; curl evil`) pasted
   naively would run injected shell; the guard hook only polices `metta` invocations, so
   chained non-metta commands pass it. Server-side Zod validation caps damage to the
   record itself but runs after the shell has already executed.
   *Fix:* add one clause to the instruction: `--tokens` must be a bare integer and
   `--task`/`--agent` must be the ids the orchestrator itself assigned (quoted), never
   text copied verbatim from the subagent's prose.

4. **`--change` / `changeName` path handling is traversal-capable (pre-existing pattern)** —
   `src/cli/commands/tokens.ts:46,56` pass `options.change` unsanitized into
   `ArtifactStore.getChange/updateChange`, which `join('changes', name, '.metta.yaml')`
   with no segment validation (`src/artifacts/artifact-store.ts:86-97`); similarly the
   degraded-path cleanup `rm(join(this.specDir, 'changes', changeName, 'TOKENS.md'), { force: true })`
   in `src/finalize/finalizer.ts` (Step 5c catch). A `--change ../../x` value can read or
   write a `.metta.yaml` outside `spec/changes/`. This mirrors every existing `--change`
   command and the CLI runs with the invoking user's own privileges, so exploitability is
   nil for the local threat model — logged for completeness.
   *Fix (optional, repo-wide):* reject change names containing `/`, `\`, or `..` at the
   ArtifactStore boundary.

5. **Unbounded `token_usage` array growth** — `src/cli/commands/tokens.ts:56-58` appends
   with no cap; the guard allowlists the command, so an orchestrator loop can grow a
   change's `.metta.yaml` without bound (self-inflicted disk/parse cost, and metric
   pollution in `metta progress` / TOKENS.md). Accepted by the "report-data-only" design;
   consider a sanity cap (e.g. warn past a few thousand records).

## Explicitly checked and clear

- **Recursive placeholder substitution: not possible.** `TemplateEngine.substitute`
  (`src/templates/template-engine.ts:39-43`) is a single-pass `String.replace` with a
  function callback — substituted values are inserted verbatim and never re-scanned, and
  `$`-patterns in values are not special when a callback is used. A `task` named
  `{change_name}` renders literally.
- **First-word tokenizer bypass:** `tokenize()` correctly follows `&&`/`;`/`||`/`|`
  chains and consumes env-var prefixes; `metta tokens record ... ; metta finalize` still
  classifies the second invocation separately (blocked/Tier-2). No new bypass introduced.
- **Report-data-only claim holds:** `token_usage` is read only by
  `generateTokensReport` (finalize) and `getAvgTokensPerChangeByTier`
  (`src/util/ceremony-metrics.ts`, progress display). Nothing routes or gates on it.
- **Input validation:** `TokenUsageRecordSchema` is `.strict()`, `tokens` is
  `int().positive()` (NaN from `Number('')` rejected), `model` enum-bound, `timestamp`
  server-generated (`src/cli/commands/tokens.ts:49-55`); `ArtifactStore.updateChange`
  re-validates full metadata on write, and YAML output goes through the yaml serializer
  (no YAML injection via task/agent strings).
- **Finalize degradation:** tokens-report failure is warn-and-continue with best-effort
  cleanup of a partial `TOKENS.md`; no truncated artifact swept into the archive.
- **Secrets:** no credentials, tokens (in the auth sense), or keys in any new code; the
  session-credential model in the guard hook is unchanged.

## Summary

0 Critical, 0 Major, 5 Minor. The `tokens` allowlist entry does not widen orchestrator
capability today beyond append-only instrumentation, but should be scoped to the
two-word form to keep future `tokens` subcommands fail-closed.

---

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
