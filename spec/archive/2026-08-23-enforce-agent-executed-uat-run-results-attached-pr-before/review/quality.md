# Quality Review: enforce-agent-executed-uat-run-results-attached-pr-before

Verdict: PASS

## Summary

Clean change. Naming follows existing precedent on both sides of the boundary, the six-pair gate blocks are byte-identical where they are supposed to be (verified by hash, not just by reading), per-skill surrounding prose is correct and step-number-accurate, tests are behavioral assertions with proper isolation, and all four relevant test suites pass (119/119). No dead code introduced; no source/test ratio regression.

## What was checked (with evidence)

### Naming consistency — no issues
- JSON field `uatEnforceOnShip` (src/finalize/finalizer.ts:80, src/cli/commands/finalize.ts:167) is camelCase, matching the existing payload fields `uatPath`, `uatWarning`, `tokensPath` in the same object.
- Config key `enforce_on_ship` (src/schemas/project-config.ts:47) is snake_case, matching the established config-schema convention (`generate_on`, `create_pr`, `merge_strategy`, `snapshot_retention`, `ship_on_success`, `version_file` — all snake_case in the same file).
- Test filename `tests/skill-uat-ship-gate.test.ts` is kebab-case and mirrors the existing `tests/skill-propose-ship-gate.test.ts` naming.

### Duplication / gate-block byte-identity — no drift
- The canonical block (from `### UAT gate (before hand-back)` through the closing fence of the `## UAT results` template) hashes to `b5a74dedba088c6c21e1b18b19800810` in all 12 files (6 skills x 2 trees). Byte-identical as designed.
- Full-file diff between `src/templates/skills/<s>/SKILL.md` and `.claude/skills/<s>/SKILL.md` is empty for all six skills.
- Per-skill surrounding prose verified against each skill's actual step numbering — no accidental drift:
  - metta-ship: "governs steps 6–9" — steps 6 (checks watch), 7 (merge), 8 (cleanup), 9 (dist rebuild) match.
  - metta-quick: "steps 13–15 do not run" — 13 (checks), 14 (merge), 15 (cleanup) match; 11–12 (push, PR create) correctly still run per U5.
  - metta-auto: "governs steps 12–13 and the step 14 cleanup" — 12 (checks), 13 (merge), 14 (cleanup) match.
  - fix-issues/fix-gap: step-11 removal-guard sentences mirror each other correctly (issue vs gap wording only).
- All six skills carry `Agent` in `allowed-tools`; only metta-ship needed the addition and only it was diffed. Correct minimal edit.

### Test quality — good
- Real behavioral assertions throughout, no snapshots. Ordering tests use `indexOf` comparisons with per-file offender labels; the aggregate test collects misses into an offender list (matches the shell-write-path-discipline pattern the design cites).
- `UAT_GATE_SENTENCE` constant is asserted exactly-once per file, guarding against duplication during future block edits.
- Temp-dir isolation preserved in cli-install/cli-finalize/config-loader/finalizer tests (existing `tempDir` fixtures). `skill-uat-ship-gate.test.ts` intentionally reads repo files — same model as `template-deploy-sync.test.ts` and `agents-byte-identity.test.ts`; appropriate for content-pinning tests.
- Config-loader coverage is thorough: default when key omitted, when block omitted, when file missing; explicit false; non-boolean rejected without coercion; unknown-key rejection retained.
- Finalizer coverage hits all payload paths: success default, explicit false, enabled-false-still-reports, dry-run, and all three abort paths.
- cli-install re-install test cleverly pins `wx` semantics (byte-untouched pre-existing config).
- Ran `tests/skill-uat-ship-gate.test.ts`, `tests/skill-propose-ship-gate.test.ts`, `tests/template-deploy-sync.test.ts`, `tests/config-loader.test.ts`: 119/119 pass.
- Test-to-source ratio maintained: no new source files; the one new test file covers the skill-template surface.

### Dead code — none found
All added code paths are reachable and asserted: the human-mode `UAT enforcement: off` line (finalize.ts:196) is covered by cli-finalize.test.ts; every `uatEnforceOnShip: true` abort-path literal in finalizer.ts is covered by finalizer.test.ts.

### Changelog — acceptable
Entry follows the established format of the prior entry (dated `###` heading with embedded H1 summary). Content is accurate: names all six skills, states the behavior change (open/unmerged/flagged instead of auto-merge), the issue/gap-file retention, the opt-out key, the install scaffold, and the new JSON field.

### Conventions
- Zod validation: new key added to `UatConfigSchema` with `.strict()` retained.
- Doc comment on `FinalizeResult.uatEnforceOnShip` (finalizer.ts:74-79) is dense but precise — documents abort/dry-run hardcoding, fail-toward-enforce absence semantics, and consumer contract.
- install.ts `configContent` string literal predates this change; the change adds 3 lines in the same style rather than introducing a new inline template. Does not make the pre-existing pattern worse.

## Issues Found

### Critical (must fix)
None.

### Warnings (should fix)
None.

### Suggestions (nice to have)
- tests/skill-uat-ship-gate.test.ts:753 — Only the opening sentence is byte-pinned; the U0–U6 bullets and results template are byte-identical across the six skills today (verified by hash) but only pair-identity (template vs deployed) is test-enforced, not cross-skill identity of the full block. A future edit to one skill's U-bullets would pass all tests while silently diverging from the other five. This matches the design's stated scope ("pinning one byte-identical canonical sentence"), so it is a deliberate tradeoff — noting it for a possible follow-up hash-based cross-skill check.
- tests/skill-uat-ship-gate.test.ts:793-807 — The frontmatter `Agent` check covers only metta-ship, though all six skills' gates depend on the Agent tool. The other five already listed `Agent` before this change; extending the frontmatter check to all six would guard against future regression for ~5 lines.
- docs/changelog.md:26-28 — Entry ends with a doubled blank line (three consecutive blank lines before the previous entry). Trivial formatting.
- src/templates/skills/metta-quick/SKILL.md:231 (and .claude copy) — "then stop — steps 13–15 do not run" leaves step 16 (Report to user) formally unaddressed; the gate sentence's "report it" covers intent, but naming step 16 as still-running would remove any ambiguity. Cosmetic.

## Verdict

PASS
