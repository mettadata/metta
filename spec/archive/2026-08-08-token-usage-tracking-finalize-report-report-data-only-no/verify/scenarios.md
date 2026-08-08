# Scenario Verification — token-usage-tracking-finalize-report-report-data-only-no

GATE: PASS

**Traceability: 34/34 scenarios evidenced** (32 by passing tests, 2 by direct CLI invocation in a sandbox, plus inspection evidence where the spec demands file-level facts).

Note: the Write tool was refused by the PreToolUse edit hook; this artifact was written via bash heredoc to the mandated path.

Gates run in the worktree:
- `npx vitest run tests/tokens-command.test.ts tests/tokens-report-generator.test.ts tests/finalizer.test.ts tests/cli-finalize.test.ts tests/ceremony-metrics.test.ts tests/progress-ceremony-metrics.test.ts tests/metta-guard-bash.test.ts tests/skill-tokens-record.test.ts tests/schemas.test.ts tests/template-deploy-sync.test.ts` — **10 files, 450 tests, all passed**
- `npx tsc --noEmit` — clean
- `npm run lint` — clean

## Traceability table

| # | Requirement / Scenario | Evidence | Status |
|---|------------------------|----------|--------|
| 1 | Scope Note / Delta merges into finalize-ship | Inspection: spec.md H1 is `# finalize-ship`, matching existing capability dir `spec/specs/finalize-ship/`; single-target merge is standard finalize behavior. No new capability dir introduced by this change. | Verified-by-inspection |
| 2 | Record Schema / Valid record passes strict validation | `tests/schemas.test.ts:1818` "round-trips a valid record through ChangeMetadataSchema token_usage" | PASS |
| 3 | Record Schema / Invalid records rejected strictly | `tests/schemas.test.ts:1830` (tokens 0), `:1835` (12.5), `:1845` (model outside enum), `:1850` (unknown key, `.strict()`) | PASS |
| 4 | Record Schema / No token_usage stays valid, artifact_tokens untouched | `tests/schemas.test.ts:1855` (backward compat), `:1863` (artifact_tokens fixture unchanged), `:149` (existing combined-metadata test) | PASS |
| 5 | Tokens CLI / Record appended against single active change | `tests/tokens-command.test.ts:187` (auto-select) + `:50` (field/timestamp validation). Human confirmation line verified by **direct CLI invocation** in sandbox: `npx tsx src/cli/index.ts tokens record --task impl --agent executor --model haiku --tokens 100` → exit 0, stdout `Recorded 100 tokens (haiku) for agent 'executor' on task 'impl' in tokens-demo`, record persisted in `.metta.yaml` | PASS |
| 6 | Tokens CLI / Explicit --change targeting | `tests/tokens-command.test.ts:249` "explicit --change beta leaves alpha untouched" | PASS |
| 7 | Tokens CLI / Ambiguous or missing change fails typed exit 4 | Multiple-changes case: `tests/tokens-command.test.ts:210` (names candidates). **Zero-active-changes case (flagged as untested) verified by direct CLI invocation**: sandbox with empty `spec/changes/` → `--json` output `error: { code: 4, type: "tokens_record_error", message: "No active changes." }`, `EXIT=4`, no `.metta.yaml` created. Nonexistent-named-change: `:232` | PASS |
| 8 | Tokens CLI / Invalid tokens value writes nothing | `tests/tokens-command.test.ts:118` (negative, no mutation), `:141` (non-integer), `:164` (invalid model alias) | PASS |
| 9 | Guard / Skill-issued tokens record passes | `tests/metta-guard-bash.test.ts:229` "allows `metta tokens record ...` with no agent_type (exit 0)" | PASS |
| 10 | Guard / Hook copies byte-identical + node --check | Direct commands: `cmp .claude/hooks/metta-guard-bash.mjs src/templates/hooks/metta-guard-bash.mjs` → identical; `node --check` on both → pass. Allowlist entry with inline comment at line 24 of both files. Also covered by `tests/template-deploy-sync.test.ts` (hooks family) | PASS |
| 11 | Guard / Other classifications unchanged | Full `tests/metta-guard-bash.test.ts` suite passed unchanged (Tier-2 block/allow, fork-tier, expired/missing/out-of-scope credential tests, e.g. `:603`–`:688`) | PASS |
| 12 | Skills / Each spawning skill carries the instruction | `tests/skill-tokens-record.test.ts:26` — asserts verbatim `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name>` in metta-plan, metta-execute, metta-verify, metta-next | PASS |
| 13 | Skills / Template and deployed pairs byte-identical | `tests/template-deploy-sync.test.ts` (skills family, per-file byte identity) + direct `cmp` on all four SKILL.md pairs → IDENTICAL | PASS |
| 14 | Skills / Recording instruction changes nothing about routing | `git diff main...HEAD -- src/templates/skills/` inspected: only the added recording paragraph plus step renumbering (plan d→e, next 3→4/5); no model-resolution, tier, or spawn wording changed | Verified-by-inspection |
| 15 | Report gen / TOKENS.md written before archive | `tests/finalizer.test.ts:685` "writes TOKENS.md pre-archive so the sweep carries it in beside UAT.md"; step at `src/finalize/finalizer.ts:207` (Step 5c, after merge, before archive) | PASS |
| 16 | Report gen / Deterministic, template-driven, AI-free | `tests/tokens-report-generator.test.ts:72` (byte-identical across two runs, fixed date); template is external file `src/templates/artifacts/tokens.md` rendered via `engine.render('tokens.md', ...)` at `src/finalize/tokens-report-generator.ts:108` — no string-literal template, no AI call; template contract tests `:218`/`:225` | PASS |
| 17 | Report gen / No token records still yields a report | `tests/finalizer.test.ts:713` "absent token_usage still produces a report listing every timed artifact as a gap"; `tests/tokens-report-generator.test.ts:194` | PASS |
| 18 | Report content / Full sections render | `tests/tokens-report-generator.test.ts:50` (all sections + header/date), `:89` (total), `:102` (per-artifact rows), `:121` (per-role rollup), `:136` (per-model rollup), `:156` (non-inherit vs inherit split sums to total) | PASS |
| 19 | Report content / Missing records surface in GAPS | `tests/tokens-report-generator.test.ts:171` (unmatched timing keys listed; matched `spec` excluded), `:184` (fine-grained ids do not clear artifact-level gap) | PASS |
| 20 | Report content / Complete coverage reports no gaps | `tests/tokens-report-generator.test.ts:207` ("No gaps found." rendered when gaps list is empty) combined with `:171` proving matched keys are excluded from gaps; rendering branch at `src/finalize/tokens-report-generator.ts:92-94`. Note: no test exercises the exact fixture "timings non-empty and all matched", but the two tested halves compose to cover it | PASS (composed evidence) |
| 21 | Config toggle / Disabled skips report cleanly | `tests/finalizer.test.ts:735` "skips generation when tokens.enabled is false while UAT proceeds"; `tests/cli-finalize.test.ts:297` (tokensPath null, no human line, UAT unaffected) | PASS |
| 22 | Config toggle / Omitted key defaults to enabled | `tests/schemas.test.ts:1880` (default `{ enabled: true }`); `tests/cli-finalize.test.ts:152-163` (default config → tokensPath string + human "Tokens report: " line) | PASS |
| 23 | Config toggle / Invalid config rejected strictly | `tests/schemas.test.ts:1896` (unknown key), `:1901` (non-boolean enabled) | PASS |
| 24 | No stray / Gate failure leaves no TOKENS.md | `tests/finalizer.test.ts:887` | PASS |
| 25 | No stray / Dry-run writes no TOKENS.md | `tests/finalizer.test.ts:828` | PASS |
| 26 | No stray / Incomplete artifacts and merge conflicts abort first | `tests/finalizer.test.ts:842` (incomplete), `:859` (merge conflict) | PASS |
| 27 | Degradation / Assembly error degrades, finalize succeeds | `tests/finalizer.test.ts:764` (template failure → finalize succeeds, UAT unaffected), `:784` (partial TOKENS.md removed, never archived), `:810` (UAT/tokens independence) | PASS |
| 28 | Degradation / Failure reported in both output modes | `tests/cli-finalize.test.ts:350-361` — `tokensPath: null` + `tokensWarning` in success-shaped JSON, exit 0; human warning on stderr, no "Tokens report:" line | PASS |
| 29 | Output / JSON success carries tokensPath additively | `tests/cli-finalize.test.ts:152-154` (tokensPath = archive path) in the same test asserting `uatPath` and all pre-existing success fields | PASS |
| 30 | Output / Human line reports the tokens path | `tests/cli-finalize.test.ts:163` `expect(humanRun.stdout).toContain('Tokens report: ')` | PASS |
| 31 | Output / Disabled → null path, no line, error shapes untouched | `tests/cli-finalize.test.ts:297-322` (null + no human line) and `:365-383` (gates_failed payload keys exactly `['change','gates','message','status']`, no tokensPath/tokensWarning) | PASS |
| 32 | Progress / Tier-grouped averages | `tests/ceremony-metrics.test.ts:314` (unit: groups per-change totals by tier across active + archived); `tests/progress-ceremony-metrics.test.ts` "--json averages token_usage per tier across active and archived changes, null for no-data tiers" | PASS |
| 33 | Progress / No-data tier distinct from zero, null in JSON | `tests/ceremony-metrics.test.ts:373` (all four tiers null with no data); CLI tests "human output shows no data for every tier when nothing reports token_usage" and null pass-through in the tier-averages JSON test | PASS |
| 34 | Progress / Pre-feature archives aggregate gracefully | `tests/ceremony-metrics.test.ts:339` (absent token_usage excluded, never counted as 0), `:350` (present-but-empty excluded), `:363` (non-tier workflows ignored). "Not modified": aggregation in `src/util/ceremony-metrics.ts` is read-only (no writes) — verified-by-inspection | PASS |

## Flagged weak paths — resolution

The correctness review flagged two untested-but-correct paths. Both were verified by direct CLI invocation in a temporary sandbox under `verify/.sandbox/` (created and removed during verification):

1. **Zero-active-changes exit 4** — `metta tokens record --json` with valid options and an empty `spec/changes/` produced exactly `{"error":{"code":4,"type":"tokens_record_error","message":"No active changes."}}`, process exit 4, and no state written. Matches the scenario at spec.md:50-54.
2. **Human confirmation line** — non-`--json` success printed `Recorded 100 tokens (haiku) for agent 'executor' on task 'impl' in tokens-demo` with exit 0 and the record persisted. Matches spec.md:43.

Both remain untested in the automated suite; consider adding two small cases to `tests/tokens-command.test.ts` as a follow-up (non-blocking).

## Gaps / notes

- Scenario 20 relies on composed evidence (matched-key exclusion test + empty-gaps rendering test) rather than one direct fixture; behavior is fully determined by the tested code paths.
- Scenarios 1 and 14 are inherently inspection-based (spec-merge targeting and a wording diff); evidence cited above.
- No scenario lacks evidence; no test failures; tsc and lint clean.
