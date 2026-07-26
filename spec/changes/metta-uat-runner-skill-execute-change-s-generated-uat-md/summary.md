# Summary: metta-uat-runner-skill-execute-change-s-generated-uat-md

## What was built

A UAT runner for metta: the `/metta-uat` skill locates a change's generated `UAT.md` (active change first, then named or newest `spec/archive/*/` entry), spawns the new `metta-uat-runner` agent to execute the acceptance steps honestly, and afterwards commits the updated document and logs each failed step as a metta issue via `/metta-issue` from the main session.

## Files delivered

- `src/templates/skills/metta-uat/SKILL.md` + `.claude/skills/metta-uat/SKILL.md` (byte-identical pair) — hook-less main-session skill; frontmatter `name: metta:uat`, `argument-hint: "[change-name]"`, `allowed-tools: [Read, Grep, Glob, Bash, Agent]`; 7-step orchestrator body (resolve target, snapshot, spawn runner with model omitted, post-run diff sanity gate, commit `docs(<change>): UAT run record`, per-failure `/metta-issue`, report). Only `metta` invocation is the allow-listed `metta status --json`.
- `src/templates/agents/metta-uat-runner.md` + `.claude/agents/metta-uat-runner.md` (byte-identical pair) — meticulous acceptance tester; `tools: [Read, Bash, Edit]`, `color: green`, no `model` field (inherits session model); nine-rule contract (untrusted-data clause, no state-mutating metta subcommands, no git, no skills, Edit-first/heredoc fallback, Edit uniqueness, never fabricate a pass, skip-with-note, superseded-header note); region-bounded + line-anchored mutation algorithm; `## UAT run — <date>` run-record schema; return contract for orchestrator issue logging.
- `src/templates/artifacts/uat.md` — `## Reporting failures` reworded: sanctioned runner checkbox flips and appended run records are permitted; fabricating a pass remains forbidden.
- `docs/workflows/state.md` — archive "preserved verbatim" sentence gains the one sanctioned exception clause for UAT run records.
- `tests/cli-skills.test.ts` — parity describes for both new pairs (byte-identity, frontmatter contracts, hook-less/no-model assertions).
- `tests/uat-template-contract.test.ts` — contract updated to the new spec-mandated header wording (fix-forward: the old test pinned the superseded sentence).

## Key decisions (from research/design)

- Spec delta merges into a NET-NEW `uat-execution` capability (H1 + `<!-- new-capability -->` marker) rather than bloating finalize-ship.
- Skill ships hook-less (precedent `metta-check-constitution`): no fork context, no mint hook, no Tier-2 subcommands, no CLI or guard changes.
- Archive Policy A: archived `UAT.md` may be edited in place, bounded to checkbox flips + appended run records (gates.yaml post-archival write precedent; nothing checksums archives).
- Runner always inherits the session model; tier-routed UAT runs are declared future work.

## Gates

- `npm test`: 94 files, 1612/1612 tests pass (includes auto-discovered byte-identity coverage for both new pairs)
- `npx tsc --noEmit`: clean
- `npm run build`: succeeds; `dist/templates/` ships both new templates and the reworded artifact header

## Deviations

- `tests/uat-template-contract.test.ts` was not in the planned file list; it pinned the old header sentence and was updated to the new spec-mandated contract (minimal assertion swap).
- Batch 1 executors verified pair identity with `cmp` and deferred the shared `template-deploy-sync` suite to Batch 2 to avoid a parallel-write race on the global completeness assertion.

## Verification (final)

| Verifier | Verdict | Detail |
|---|---|---|
| Tests | PASS | 94 files, 1612/1612 tests |
| Typecheck / lint / build | PASS | tsc clean; lint (tsc alias) clean; build ships both new templates to dist/ |
| Spec traceability | PASS | 28 scenarios: 7 VERIFIED mechanically, 21 SPECIFIED with cited contract lines, 0 FAIL |

Review: 2 rounds — round 1 PASS_WITH_WARNINGS x3 (6 warnings fixed in commit 0092215db: date-anchored archive glob, whole-tree sanity check, pathspec-scoped commit, metta allow-list, non-metta command constraints, refresh.ts listing); round 2 PASS/PASS/PASS_WITH_WARNINGS (remaining findings accepted, fail-safe). Full detail in review.md and verify/.
