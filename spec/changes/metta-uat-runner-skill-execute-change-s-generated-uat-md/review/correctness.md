PASS_WITH_WARNINGS

# Correctness Review: metta-uat-runner-skill-execute-change-s-generated-uat-md

Scope reviewed: full diff vs main (8 files), spec.md (10 requirements, 24 scenarios), design.md ADRs 1-5, byte-identity verified by direct cmp, affected test files executed (69/69 pass across tests/cli-skills.test.ts, tests/uat-template-contract.test.ts, tests/template-deploy-sync.test.ts).

## Requirement-by-requirement verification

- **UAT Runner Skill** — SATISFIED. `cmp` confirms `src/templates/skills/metta-uat/SKILL.md` == `.claude/skills/metta-uat/SKILL.md` byte-for-byte. Frontmatter is `name`/`description`/`argument-hint`/`allowed-tools` only — no `context: fork`, no `hooks:`, matching design ADR-2. Diff contains no CLI registration, no guard-hook edit, no Tier-2 subcommand instruction (only `metta status --json`, allow-listed at `.claude/hooks/metta-guard-bash.mjs:20`). `tests/template-deploy-sync.test.ts` auto-discovers the pair (verified: 46 tests pass, unmodified).
- **UAT Document Location Rules** — SATISFIED (one warning, W1 below). Order matches spec: named arg checks `spec/changes/<name>/UAT.md` then archive; named archive wins over a different active change; no-arg prefers active changes, falls back to newest archive (descending lexicographic sort of `<YYYY-MM-DD>-<slug>` names is chronological; tie-break deterministic); nothing-found path fails listing both searched locations and spawns nothing.
- **UAT Runner Agent** — SATISFIED. `cmp` confirms template/deployed identity. Frontmatter: `name`, `description`, `tools: [Read, Bash, Edit]`, `color: green`, no `model` field (test asserts `not.toMatch(/^model:/m)`; the body's mid-line `model: <self-reported...>` does not false-positive it). `loadAgentDefinition` (`src/agents/agent-registry.ts:66-90`) resolves `metta-<shortName>.md` by filename and its `^tools:\s*\[(.*)\]` regex parses the flow-style list — no registry change needed. Persona line precedes the first heading, so `extractPersona` returns non-empty. Injection-defense clause present with the exact "ignore your instructions" example treated as data. Honest fallback clause (Edit first, heredoc to exact path, refusal noted in run record) present.
- **UAT Step Execution Semantics** — SATISFIED. Do-via-Run-hint, match→flip, contradict→unchecked+recorded discrepancy, environment-impossible→skip-with-note distinct from fail, never alter Setup/Do/Observe/Machine-verified, never fabricate. The Edit-uniqueness rule (step-heading-anchored old-string, replace-all forbidden) correctly addresses the dozens-of-occurrences hazard.
- **Header wording scenario** — SATISFIED. `src/templates/artifacts/uat.md:8-14` now sanctions runner checkbox flips "to reflect a genuinely observed outcome" while forbidding fabrication ("Never fabricate a pass... never check a box for behavior that was not actually observed"). `tests/uat-template-contract.test.ts:25-27` asserts the actual new text (three substrings all literally present). The living `finalize-ship` spec (spec/specs/finalize-ship/spec.md:337) only requires failure-reporting instructions in the header — still satisfied; no living spec mandates the removed "Do not edit" sentence.
- **UAT Run Record** — SATISFIED. Appended `## UAT run — <date>` section carries runner identity, per-step table with pass/fail/skip words (never checkbox syntax — keeps the reset regex safe), and `### Failures` expected-vs-observed entries. Results go to `UAT.md` only; append-only history stated in both agent and skill (skill step 4 refuses to commit any modification to prior sections).
- **Idempotent Re-Runs** — SATISFIED. Mutation algorithm resets before execution (step 3 before step 4), bounded to the acceptance region (before first `^## UAT run — ` line) and line-anchored (lines exactly `- [x] Pass`). Verified against generator output: `renderGroups` (src/finalize/uat-generator.ts:441) emits `- [ ] Pass` alone on a line with no indentation, and `flattenField` (423-425) prevents step text from producing whole checkbox lines — so mid-line quoted checkbox text (e.g. the archive example the design cites) and run-history table cells are provably untouched. `### Generation notes` is H3, stays inside the acceptance region, and contains no exact checkbox lines — no boundary hazard.
- **Failure-To-Issue Loop** — SATISFIED. Skill step 6 owns `/metta-issue` per failed step from the main session; skips explicitly excluded. Agent: "No skill invocations" plus the state-mutating-metta prohibition list (includes `issue`). Return contract explicitly sized so the orchestrator can author issues without re-reading the document.
- **Commit Ownership** — SATISFIED. Skill step 5 commits with conventional `docs(<change-name>): UAT run record`; agent rule "No git commands, ever. The orchestrator commits after you return" satisfies the "Agent contract forbids git" scenario verbatim.
- **Model Routing Deferral** — SATISFIED. Skill step 3: "model parameter omitted in every case"; no tier logic anywhere; diff touches neither `src/context/model-resolver.ts` nor any instructions artifact.
- **Archived UAT Run Recording** — SATISFIED. `document_kind: archived` in the spawn contract, guard-edit refusal named as the expected archived-path trigger, heredoc rewrite mandated to reproduce every byte outside sanctioned regions, skill's post-run `git diff` sanity check refuses to commit unsanctioned changes, runner writes to `UAT.md` only (no other archive file). `docs/workflows/state.md:225` touch-up matches the design wording exactly. Superseded-header note handles pre-change archives carrying the old sentence (R10).

## Internal consistency

- Spawn contract (skill step 3: `uat_path`, `document_kind`, `change_name`, `run_date`, injection framing, return-contract restatement) matches design API table; the return-contract restatement in the skill is word-for-word identical to the agent's Return Contract section (3 numbered items). No drift found.
- Boundary regex `^## UAT run — ` (em dash) is consistent across agent mutation algorithm, agent run-record heading format, and skill diff-check grep.

## Issues Found

### Critical
None.

### Warnings
- **W1** — `src/templates/skills/metta-uat/SKILL.md:12` (and deployed copy) — Named-argument archive glob `spec/archive/*-<name>/UAT.md` is ambiguous: for change name `foo` it also matches an unrelated archived slug ending in `-foo` (e.g. `2026-01-01-bar-foo`). The stated preference for "an exact `-<name>` directory-suffix match" does not disambiguate, because both candidates ARE exact `-<name>` suffix matches. A date-anchored pattern (`spec/archive/????-??-??-<name>/UAT.md`, i.e. everything after the 11-char date prefix equals `<name>`) would make resolution exact per the spec's "the archive entry matching that name". Low practical likelihood (requires a slug that is a dash-suffix of another slug), and an LLM orchestrator will usually infer intent, but the instruction as written permits a wrong pick. Same line: abandoned archives (`<date>-<name>-abandoned/`) are silently excluded from named lookup — almost certainly correct (abandoned changes never reach UAT generation) but undocumented.

### Notes
- **N1** — `src/templates/agents/metta-uat-runner.md:31-37` — The agent body never names the spawn-prompt fields (`uat_path`, `document_kind`, `change_name`, `run_date`); in particular the run-record heading date is described only as "matching the header's `Generated` format" rather than "the `run_date` you were given". The skill's prompt carries the values, so behavior is correct, but the coupling is implicit.
- **N2** — `src/templates/skills/metta-uat/SKILL.md:31` — "confirm via Grep that exactly one new `## UAT run — ` heading was added": on a same-day re-run the document legitimately contains two identical `## UAT run — <date>` headings (accepted risk R7), so a document-level heading count cannot verify "one new". Only the diff-based reading (one added `+## UAT run — ` line in `git diff`) is correct; the sentence should ideally say to grep the diff.
- **N3** — `src/templates/agents/metta-uat-runner.md:21` — Heredoc fallback uses delimiter `EOF`; a document containing a line that is exactly `EOF` would truncate the rewrite. No generated UAT content can currently produce such a line, and the skill's diff check would catch the corruption before commit, but choosing a collision-resistant delimiter would remove the theoretical hazard.
- **N4** — `src/templates/skills/metta-uat/SKILL.md:14` (step 2) — `git status --porcelain -- <path>` also reports untracked files, so a freshly generated but not-yet-committed live `UAT.md` blocks the run with warn-and-stop. Conservative and safe (the diff sanity check genuinely needs a clean baseline), just noting the behavior.
- **N5** — `tests/cli-skills.test.ts:225` — `expect(template).not.toMatch(/hooks:/)` scans the whole file, not just frontmatter; a future body sentence containing the literal "hooks:" would false-fail. Currently fine.

## Edge cases checked

- Same-day re-runs: duplicate headings disambiguated by document order + full ISO-8601 `Completed` bullet (design R7, accepted). OK.
- `### Generation notes` present: H3, inside acceptance region, run record still appends at EOF after it; reset regex cannot touch its bullet lines. OK.
- Checkbox syntax quoted mid-line in step text: reset is whole-line-exact and region-bounded; generator's `flattenField` guarantees no whole-line collision. OK.
- Multiple active changes with UAT.md, no argument: fail with candidate list, never guess (design R5; spec is silent, strict behavior is compatible). OK.
- Prior-run preservation across heredoc full-rewrite: mandated byte reproduction + orchestrator diff gate + no-commit-on-unsanctioned-diff. OK.
- Runner asked by step text to run a state-mutating metta command: skip-with-note per R2/R3 trust-hole mitigation. OK.

## Verdict
PASS_WITH_WARNINGS
