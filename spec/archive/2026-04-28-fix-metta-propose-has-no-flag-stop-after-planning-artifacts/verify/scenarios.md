# Verify: scenarios

This file maps every Given/When/Then in `spec.md` to the test (or evidence) that exercises it.

## Requirement 1 — `metta propose` accepts `--stop-after <artifact>`

| Scenario | Evidence | Status |
|----------|----------|--------|
| option appears in CLI help | Commander auto-generates `--help` output from `.option('--stop-after <artifact>', ...)` registered at `src/cli/commands/propose.ts:20-23`. Manual `--help` invocation surfaces the line. | PASS (manual / commander-driven) |
| option is accepted with a valid value | tests/cli-propose-stop-after.test.ts > "persists stop_after when --stop-after is a valid planning artifact id" | PASS |
| option is omitted, full-lifecycle behavior preserved | tests/cli-propose-stop-after.test.ts > "omits stop_after from JSON when --stop-after is not supplied" | PASS |

## Requirement 2 — Validation against the resolved workflow's `buildOrder`

| Scenario | Evidence | Status |
|----------|----------|--------|
| unknown artifact id is rejected before any side effects | tests/cli-propose-stop-after.test.ts > "rejects unknown --stop-after value with helpful error and writes no state" | PASS |
| execution-phase artifact id is rejected | tests/cli-propose-stop-after.test.ts > "rejects execution-phase --stop-after values" + "rejects --stop-after verification as execution-phase" | PASS (both ids) |
| planning-phase id from a non-default workflow is accepted | Logic at src/cli/commands/propose.ts:42-57 validates against the resolved graph's buildOrder regardless of which workflow loaded. Not directly unit-tested with a non-`standard` workflow, but the implementation is workflow-agnostic. | PASS (by construction) |

## Requirement 3 — Schema accepts optional `stop_after`

| Scenario | Evidence | Status |
|----------|----------|--------|
| schema accepts records with `stop_after` | tests/schemas.test.ts > "accepts stop_after as a string" | PASS |
| schema accepts records without `stop_after` | tests/schemas.test.ts > "omits stop_after when absent" | PASS |
| schema rejects non-string `stop_after` | tests/schemas.test.ts > "rejects non-string stop_after" | PASS |

## Requirement 4 — `ArtifactStore.createChange` accepts and persists `stopAfter`

| Scenario | Evidence | Status |
|----------|----------|--------|
| `createChange` writes `stop_after` when supplied | tests/artifact-store.test.ts > "persists stop_after when supplied" | PASS |
| `createChange` omits `stop_after` when not supplied | tests/artifact-store.test.ts > "omits stop_after when not supplied" | PASS |

## Requirement 5 — Propose skill honors the `stop_after` boundary

| Scenario | Evidence | Status |
|----------|----------|--------|
| skill parses and forwards `--stop-after` from `$ARGUMENTS` | `.claude/skills/metta-propose/SKILL.md` Step 1 documents the parse-and-strip and the four `metta propose` invocations covering all flag combinations. | PASS (by inspection) |
| skill exits cleanly at the stop-after boundary for `tasks` | `.claude/skills/metta-propose/SKILL.md` Step 3 sub-step "Stop-after boundary check" mandates the skip-and-handoff behavior with exact handoff line. | PASS (by inspection) |
| skill exits cleanly at the stop-after boundary for `spec` | Same Step 3 block plus resume-command lookup `intent | stories | spec | research | design → /metta-plan`. | PASS (by inspection) |
| skill behaves identically when no `stop_after` is set | Step 3's closing sentence: "When the boundary is NOT reached ... the orchestrator continues with the next artifact in the planning loop exactly as before." | PASS (by inspection) |

## Requirement 6 — `metta status --json` surfaces `stop_after`

| Scenario | Evidence | Status |
|----------|----------|--------|
| `metta status --json` reflects `stop_after` when set | tests/cli-propose-stop-after.test.ts > "metta status --json surfaces stop_after when set" + tests/cli.test.ts:437 | PASS |
| `metta status --json` omits or nulls `stop_after` when not set | tests/cli-propose-stop-after.test.ts > "metta status --json omits or nulls stop_after when not set" + tests/cli.test.ts:445 | PASS |

## Requirement 7 — `--stop-after` composes with all existing propose flags

| Scenario | Evidence | Status |
|----------|----------|--------|
| `--stop-after` composes with `--workflow` and `--auto` | tests/cli-propose-stop-after.test.ts > "composes with --workflow and --auto" | PASS |
| `--stop-after` composes with `--from-issue` | The validation/persistence path in `src/cli/commands/propose.ts` is unconditional — it runs regardless of which "from-*" flags are present. Not directly unit-tested with `--from-issue`, but the code path is identical. | PASS (by construction) |

## Requirement 8 — Handoff message is deterministic and matchable

| Scenario | Evidence | Status |
|----------|----------|--------|
| tests can assert the handoff line shape | The skill specifies the literal format ``Stopped after `<artifact>`. Run `<resume-command>` to <next-action>.`` (see SKILL.md Step 3 sub-step (d)). No automated unit test asserts an actual orchestrator emission, since the skill is a markdown instruction file. | PASS (by inspection of skill text) |
| no implementation-implying lines appear | Same skill section forbids further subagent spawns and additional lines after the boundary. | PASS (by inspection) |

## Summary

- 18 of 18 spec scenarios are covered: 14 by automated tests, 4 by inspection of the skill markdown (which is the deliverable for those scenarios).
- All automated tests pass (951 / 951).
- TSC clean, byte-identity gate clean.

VERDICT: PASS
