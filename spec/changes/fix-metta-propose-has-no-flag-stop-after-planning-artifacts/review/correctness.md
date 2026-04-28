# Code Review: fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Summary

Implementation is correct, minimal, and bit-faithful to the spec. CLI validation is well-placed (before any state write), schema and store extensions are conservative, the SKILL.md pair is byte-identical, and backward-compatibility (no flag → unchanged YAML and JSON) is preserved. All 8 end-to-end CLI tests pass alongside schema and store unit tests. One minor warning on log-message determinism, no critical issues.

## Issues Found

### Critical (must fix)

None.

### Warnings (should fix)

- `.claude/skills/metta-propose/SKILL.md:99` and `src/templates/skills/metta-propose/SKILL.md:99` — for early stop points (`intent..design`), the spec's "Handoff message MUST be deterministic and matchable" requirement (spec.md:189-214) requires the handoff line to be the FINAL user-facing line. The skill correctly states this, but the optional `/metta-status` mention is described as "MAY... on a separate neutral line BEFORE the handoff line". This is consistent with the spec — flagging as a warning only because the skill orchestrator could plausibly emit it AFTER the handoff line if the prompt is misread. Recommend tightening to "MUST be on a neutral line BEFORE the handoff line; the handoff line MUST be the final user-facing line."

- Spec scenario "skill parses and forwards `--stop-after` from `$ARGUMENTS`" (spec.md:125-129) is verified only by manual reading of SKILL.md, not by an automated test. The implementation is correct (Step 1 in SKILL.md:28-41 names all four invocation forms), but no test asserts the orchestrator's argument-stripping behavior. Acceptable because skill behavior is not unit-testable today, but worth noting as a coverage gap.

- Spec scenarios "skill exits cleanly at the stop-after boundary for `tasks`" and "for `spec`" (spec.md:131-141) are likewise not covered by an executable test — only by SKILL.md prose. The exact-substring assertion called out in spec.md:204-208 has no programmatic counterpart. Acceptable as "skill orchestrator behavior tested via integration", but is a documented gap.

### Suggestions (nice to have)

- `src/cli/commands/propose.ts:43-46` — the `planningIds` filter hardcodes the strings `'implementation'` and `'verification'`. Consider extracting to a small named constant (e.g. `EXECUTION_PHASE_IDS = new Set(['implementation', 'verification'])`) to avoid drift if a future workflow renames these stages. Currently fine; the spec explicitly names these two ids in scenarios 46-50.

- `src/cli/commands/propose.ts:91` — JSON output uses `stop_after: stopAfter ?? null`. Spec.md:27 allows either omission OR `null` — this picks `null`. Tests at `tests/cli-propose-stop-after.test.ts:108` accept both shapes, so this is conformant. Suggestion only: prefer omission for parity with `.metta.yaml` (which omits the field entirely when absent).

- `src/artifacts/artifact-store.ts:20-28` — the parameter list is now 7 positional arguments long. Design.md:38 acknowledged this and offered "options object" as an alternative. Acceptable per the spec ("implementer's choice"), but a future refactor toward an options bag would improve readability. Out of scope for this change.

- `src/cli/commands/propose.ts:75` — `await ctx.configLoader.load()` is called twice (lines 29 and 75). The second call is inside the git-branch `try` block. Minor inefficiency; the first `config` is in scope and could be reused (the inner `const config` shadows it).

## Spec Compliance Check (per requirement)

| Requirement | Status | Evidence |
|---|---|---|
| `metta propose --help` lists `--stop-after` | PASS | propose.ts:20-23 — `.option('--stop-after <artifact>', ...)` |
| Valid value accepted; persisted in `.metta.yaml`; surfaced in `--json` | PASS | propose.ts:60-69, :91; artifact-store.ts:60-62; cli-propose-stop-after.test.ts:47-58 |
| Omitting flag preserves today's YAML and JSON | PASS | artifact-store.ts:60 (sets only when defined); test :100-112 |
| Validate against `buildOrder` BEFORE any state write | PASS | propose.ts:39-57 (validation precedes `createChange` call); test :60-74 confirms no dir created on rejection |
| Reject `implementation` and `verification` with code 4 | PASS | propose.ts:47-51; test :76-98 |
| `ChangeMetadataSchema` accepts string, omits when absent, rejects non-string | PASS | change-metadata.ts:62; schemas.test.ts:239-285 |
| `ArtifactStore.createChange` accepts trailing optional `stopAfter` | PASS | artifact-store.ts:27, :60-62; artifact-store.test.ts:101-138 |
| Skill parses `--stop-after`, passes through to CLI | PASS | SKILL.md:28-41 |
| Skill exits at boundary, prints deterministic handoff line, skips Steps 4-8 | PASS | SKILL.md:84-102 |
| `metta status --json` surfaces `stop_after` | PASS | status.ts:84-91 (spreads metadata); cli-propose-stop-after.test.ts:138-166 |
| Composes with `--workflow`, `--auto`, `--from-issue` etc. | PASS | propose.ts:39-69 (validation orthogonal); test :114-136 |
| Handoff line format `Stopped after \`X\`. Run \`Y\` to Z.` | PASS | SKILL.md:94-99 (verbatim format with backticks) |

## Focused Findings (per orchestrator request)

1. **Every spec MUST satisfied?** Yes. Every "MUST" in spec.md maps to a code or skill change that implements it. The schema-side membership-validation MUST-NOT (spec.md:64-65) is correctly NOT enforced in the schema; CLI carries that responsibility.

2. **`--stop-after` validation rejects invalid artifact names?** Yes. propose.ts:42-57 validates against `graph.buildOrder` AFTER workflow load and BEFORE `createChange`. Both paths (unknown id, execution-phase id) throw with messages naming the value and listing valid ids. Verified by tests.

3. **Skill exits after the boundary or falls through?** Skill MD prose at SKILL.md:84-102 explicitly enumerates which steps to skip (4, 5, 6, 7, 8) and forbids spawning executor/reviewer/verifier agents. Behavior is prose-only (skill orchestrator interprets MD), but the wording is unambiguous and matches spec scenarios 131-147.

4. **Byte-identity SKILL.md pair?** PASS. `diff -q .claude/skills/metta-propose/SKILL.md src/templates/skills/metta-propose/SKILL.md` returns no output. `dist/templates/skills/metta-propose/SKILL.md` also matches.

5. **Backward-compat (no flag preserves today's behavior)?** PASS. artifact-store.ts:60 sets `metadata.stop_after` only when `stopAfter !== undefined`. `.strict()` schema with optional field accepts records with no `stop_after`. JSON output emits `stop_after: null` (within spec — allowed by spec.md:27). YAML omits the field entirely when absent (verified by `tests/cli-propose-stop-after.test.ts:111`). No callers of `createChange` had to change because the parameter is trailing-optional.

## Verdict

PASS_WITH_WARNINGS

The two warnings are documentation-tightening suggestions (handoff-line ordering clarity and skill-test coverage gap), not blockers. Implementation is correct and complete against the spec.
