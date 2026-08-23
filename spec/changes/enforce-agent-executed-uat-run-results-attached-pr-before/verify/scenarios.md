# Scenario Verification — enforce-agent-executed-uat-run-results-attached-pr-before

Result: PASS

All 24 scenarios across 8 requirements have verification evidence: a passing test, a grep-assert
assertion, or (for skill-behavior scenarios that only manifest at runtime) the mandating skill text
present in both template and deployed copies. Targeted test run:
`npx vitest run tests/skill-uat-ship-gate.test.ts tests/config-loader.test.ts tests/cli-install.test.ts tests/finalizer.test.ts tests/cli-finalize.test.ts tests/skill-propose-ship-gate.test.ts`
→ **6 files, 156 tests, all passed** (2026-08-23).

Template/deployed byte-identity was independently confirmed via `diff` for all six ship-path pairs
(metta-ship, metta-propose, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap): all
byte-identical. Line citations below reference the deployed copy; the template copy is identical.

Evidence-kind legend: **T** = passing test, **G** = grep-assert test assertion, **S** = mandating
skill text in both copies (runtime-only behavior).

## Requirement: UAT Gate Before PR Hand-Back

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Ship skill spawns the runner against the archived UAT before hand-back | `tests/skill-uat-ship-gate.test.ts:31` "contains the byte-identical UAT gate sentence exactly once" + `:39` "places the UAT gate before PR creation" across all 12 files (gate sentence at e.g. `.claude/skills/metta-ship/SKILL.md:23` before `gh pr create` at `:31`); Agent-tool spawn detail in U2 (`metta-ship/SKILL.md:27`); no `/metta-uat` slash-invoke — grep count 0 in all six deployed skills | G + S | PASS |
| Never hand back an unexecuted UAT | Gate sentence is mandatory ("mandatory unless the effective uat.enforce_on_ship is false") and pinned once per file by `tests/skill-uat-ship-gate.test.ts:31–37`; aggregate check `:74–86` fails naming any file missing it | G + S | PASS |
| metta-ship can spawn subagents | `tests/skill-uat-ship-gate.test.ts:58–72` "frontmatter allowed-tools includes Agent" for both metta-ship copies; frontmatter `allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]` at `.claude/skills/metta-ship/SKILL.md:4`; byte-identity confirmed by diff | G | PASS |

## Requirement: Inline UAT Orchestration Contract In Ship Skills

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Valid run diff is committed on the change branch | U1 git-clean snapshot + U3 diff shape check + U4 "Commit (orchestrator-only; the runner never runs git)" with `commit -m "docs(<change-name>): UAT run record"` — `.claude/skills/metta-ship/SKILL.md:26–29` and mirrored U1–U4 blocks in all five other skills (e.g. `metta-quick/SKILL.md:204–209`) | S | PASS |
| Unexpected diff shape is not blindly committed | U3 in every skill: "Any violation: do NOT commit, report the unsanctioned diff, leave the tree intact, and stop — this is a blocking anomaly" (`.claude/skills/metta-ship/SKILL.md:28`) | S | PASS |
| No second runner path exists | All six skills route through `subagent_type: metta-uat-runner` (U2) only; runner agent pair untouched by this change — `git log main..HEAD -- src/templates/agents/metta-uat-runner.md .claude/agents/metta-uat-runner.md` is empty, `git diff main...HEAD --stat` on those paths is empty, and the pair is byte-identical | S + git history | PASS |

## Requirement: UAT Run Summary In PR Body Or Comment

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| PR body carries the run summary at creation | U6 in every skill: "PR not yet created: include the `## UAT results` section in the body given to `gh pr create --title ...`" (`.claude/skills/metta-ship/SKILL.md:31`; `metta-quick:210`, `metta-auto:86`, `metta-fix-issues:96`, `metta-fix-gap:96`, `metta-propose:293`) with the summary template carrying pass/fail/skip counts, failed-step expected/observed table, and skipped-reason table | S | PASS |
| Existing PR receives the summary as a comment | U6: "PR already exists: post the section via `gh pr comment <pr-number> --body ...`"; also U0 reuse path attaches via `gh pr comment` (`.claude/skills/metta-ship/SKILL.md:25,31`) | S | PASS |
| Run record merges to main with the change | U4 commits the record on the change branch before the push step ("the record rides the upcoming push", `.claude/skills/metta-ship/SKILL.md:29`), so the merge carries it to main | S | PASS |

## Requirement: UAT Failure Blocks Ready Hand-Back

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Failed step halts the ship path | U5 in every skill: "fail > 0: blocked — still push and create the PR with the failure summary in its body ... then report the failures and stop: no checks watch, no merge, no ready declaration" (`.claude/skills/metta-ship/SKILL.md:30`; `metta-quick:209`) | S | PASS |
| All-pass run proceeds to hand-back | U5: "fail == 0: proceed" with summary attached via U6 (`.claude/skills/metta-ship/SKILL.md:30–31`) | S | PASS |
| Manual-acceptance steps skip without blocking | U5: "Skipped steps (\"needs manual acceptance\") are listed in the summary with reasons and never block. Machine-verified auto-pass is runner behavior" (`.claude/skills/metta-quick/SKILL.md:209` and all peers) | S | PASS |

## Requirement: UAT Gate Before Merge On Run-To-Merge Paths

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Merge waits for UAT results | `tests/skill-uat-ship-gate.test.ts:48–55` "places the UAT gate before the merge step" (gate index < `gh pr merge <pr-number> --merge` index) across all 12 files; e.g. `metta-quick` gate at line 202 vs merge at 236, `metta-auto` 78 vs 112, `metta-fix-issues` 88 vs 121, `metta-fix-gap` 88 vs 121 | G | PASS |
| UAT failure leaves the PR open and unmerged | U5 blocked branch: PR is created/left open with failure summary, "no merge", skill stops (`.claude/skills/metta-quick/SKILL.md:209`) | S | PASS |

## Requirement: UAT Configuration Toggle (MODIFIED)

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Disabled toggle skips generation cleanly | `tests/finalizer.test.ts:670` "skips generation when uat.enabled is false" (uatPath null, no UAT.md in archive, finalize succeeds); CLI level: `tests/cli-finalize.test.ts:182` | T | PASS |
| Omitted uat key defaults to enabled | `tests/config-loader.test.ts:212` "defaults uat to { enabled: true, enforce_on_ship: true } when config omits uat"; `tests/finalizer.test.ts:650` "writes UAT.md pre-archive..." (config omits uat → UAT.md generated); schema default at `src/schemas/project-config.ts:128` (`uat: UatConfigSchema.default({})`) | T | PASS |
| Disabled enforcement skips the ship-path UAT run | Finalizer surfaces the value: `tests/finalizer.test.ts` "reflects an explicit enforce_on_ship: false on the success payload" (line 683 block) and `:694` "reports the configured enforce value even when uat.enabled is false"; skill side: U0 in every skill — "if its `uatEnforceOnShip` is `false`, skip this entire block and proceed exactly as before the gate existed" | T + S | PASS |
| Omitted enforce_on_ship defaults to enforced | `tests/config-loader.test.ts:234` "defaults uat.enforce_on_ship to true when the key is omitted from an explicit uat block" and `:246` (missing file); `tests/cli-finalize.test.ts:123` asserts `uatEnforceOnShip: true` in the JSON payload on default config | T | PASS |
| Fresh install scaffolds explicit enforcement without overwriting existing configs | `tests/cli-install.test.ts:89` "scaffolds an explicit uat block with enforce_on_ship true" (parsed `uat == { enforce_on_ship: true }`, schema-valid) and `:102` "re-install leaves an existing config.yaml byte-untouched — no uat block injected (wx semantics)" | T | PASS |
| Invalid uat config is rejected strictly | `tests/config-loader.test.ts:264` "rejects non-boolean uat.enforce_on_ship without coercion", `:275` "rejects unknown keys inside the uat block", `:287` "rejects non-boolean uat.enabled without coercion"; `UatConfigSchema` is `.strict()` with boolean fields at `src/schemas/project-config.ts:45–48` | T | PASS |

## Requirement: Ship Skill Toggle Readability Without Guard Violation

Design chose the **finalize-output mechanism**: `uatEnforceOnShip` is surfaced in `metta finalize --json`.

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Skills resolve the toggle without a guard block | All six skills read `uatEnforceOnShip` from the finalize JSON payload they already receive (U0, grep count ≥ 1 in every deployed skill) — no new `metta` invocation, no hand-parsed YAML; value is schema-validated by ConfigLoader (`tests/config-loader.test.ts:212–296`) | S + T | PASS |
| Config-read mechanism outcome | Not selected by design (conditional scenario; GIVEN not met). No guard allowlist change was made — mechanism is finalize-output | N/A | PASS (vacuous) |
| Finalize-output mechanism outcome | `tests/cli-finalize.test.ts:123` "success: JSON payload carries uatPath into the archive **plus all pre-existing fields**" (asserts `uatEnforceOnShip` alongside prior fields, incl. dry-run payload) and `:259` "error payloads unchanged: incomplete artifacts exits 3 with the exact prior shape and no uatPath"; no guard hook change required | T | PASS |

## Requirement: Grep-Assert Coverage Of Ship-Path UAT Gate

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Tests pass on compliant skill files | `tests/skill-uat-ship-gate.test.ts` — 12-file matrix (`SKILL_TREES` x `SHIP_SKILLS`, lines 6–28), pinned sentence constant (line 18), presence + ordering vs `gh pr create --title` and `gh pr merge <pr-number> --merge`, Agent in metta-ship `allowed-tools` (lines 58–72). All 39 tests in the file passed in the run above | T | PASS |
| Dropped or reordered gate fails the suite | Structural: every assertion message interpolates the offending `${label}` (lines 34–36, 43–45, 52–54, 68, 83) and presence/ordering is per-file `indexOf`/`includes`, so removal or reordering in any single file fails at least one named assertion; aggregate test (lines 74–86) lists missing files by label | G (structural) | PASS |

## Requirement: Idempotent UAT Recording Across Propose Stop And Ship

| Scenario | Evidence | Kind | Status |
|---|---|---|---|
| Propose hands back a PR that already carries the run record | `metta-propose` carries the full gate at its PR-open stop: gate sentence at `.claude/skills/metta-propose/SKILL.md:285` before its `gh pr create` (line 293), U4 commits the record on the change branch before push; ordering pinned by `tests/skill-uat-ship-gate.test.ts:39` for the propose pair | G + S | PASS |
| Ship of an unchanged branch does not duplicate the record | U0 reuse short-circuit in every skill: HEAD subject exactly `docs(<change>): UAT run record` → "reuse the existing record as gate evidence" + comment "Reusing run recorded at <short-sha> — branch unchanged since" (`.claude/skills/metta-ship/SKILL.md:25`; grep-confirmed in all six deployed skills). metta-ship's already-finalized path (line 19) routes into the same reuse short-circuit | S | PASS |
| Genuine re-run appends per existing semantics | U0: "Any other subject means a fresh run under the UAT idempotent re-run contract: checkboxes reset, one new dated section appended, prior sections never rewritten"; U3 enforces "exactly one new dated `## UAT run — <date>` section"; runner agent pair (owner of the re-run contract) unmodified by this change (empty `git log main..HEAD` on both copies) | S | PASS |

## Gaps / Notes

- No gaps: every scenario has cited evidence and all 156 tests in the six cited files pass.
- Note (not a gap): scenarios in the S (skill-text) category are runtime skill behaviors that cannot
  be exercised by unit tests; per the verification tasking they are evidenced by the mandating text
  present in template + deployed copies (byte-identity diff-confirmed) and pinned against drift by
  the grep-assert suite.
- Note: the "Config-read mechanism outcome" scenario is vacuously satisfied — the design selected
  the alternative (finalize-output) mechanism the spec explicitly allows, and no write-capable
  command was newly allowlisted in the guard.
