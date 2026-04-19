# Verify: Scenario Coverage

**Verdict:** PASS
**Uncovered requirements:** 0 of 6
**Uncovered scenarios:** 0 of 22

## Gate Results

| Gate | Status |
|------|--------|
| `npm test` | PASS — 737 tests, 54 files, all green (616.01s) |
| `npm run lint` (alias for `tsc --noEmit`) | PASS — clean |
| `npx tsc --noEmit` | PASS — clean |
| Byte-identity diff (template vs deployed) | PASS — `cksum` matches for both pairs |

## Requirement → Evidence Map

### Req 1 — SkillParallelismSelfCheck (3 scenarios)

Skill-template assertions (direct file inspection) plus byte-identity test.

- **self_check_block_present_in_propose_skill** — `src/templates/skills/metta-propose/SKILL.md:76-85`. The phrase "pre-batch self-check" appears at line 76 (step `c.`) and line 78 (bold header). The first `Agent(...)` tool call in the Implementation section is at line 93 (inside the anti-example `wrong` block); both self-check references precede it. Corresponding deployed file proven byte-identical by `tests/skill-discovery-loop.test.ts:70-82` (`byte-identity — REQ-3`).
- **self_check_uses_imperative_language** — `src/templates/skills/metta-propose/SKILL.md:78-83` contains `MUST` (7×) and `SHALL NOT`; the only occurrences of the hedge words `consider`, `try to`, `you may want to` in the directive are the explicit prohibition list at line 78 (`No hedge words — no "consider", "try to", "you may want to"`). Same holds for `src/templates/skills/metta-quick/SKILL.md:60-65`.
- **self_check_requires_file_listing** — `src/templates/skills/metta-propose/SKILL.md:80-83` contains all four mandated steps: (a) list Files verbatim, (b) classify shared vs disjoint, (c) declare parallel-vs-sequential per task, (d) name conflicting file path for any Sequential choice.

### Req 2 — SkillAntiExamples (3 scenarios)

- **anti_example_block_present_and_labeled** — `src/templates/skills/metta-propose/SKILL.md:87-108`. Fan-out anti-example heading at line 87; ``` ```wrong ``` fence at line 89; ``` ```right ``` fence at line 100, immediately adjacent. Same pattern at lines 126-142 (reviewer block) and 168-184 (verifier block).
- **anti_example_uses_stable_markers** — Both files use stable fenced-code delimiters `` ```wrong `` / `` ```right `` labeled by the code-fence language tag; see `metta-propose/SKILL.md:89,100` and `metta-quick/SKILL.md:71,82`. These are machine-grep-discoverable markers.
- **quick_skill_mirrors_propose_anti_example** — `src/templates/skills/metta-quick/SKILL.md:69-91` shows the same wrong-vs-right contrast as the propose skill for the implementation batch, with the "wrong" block demonstrating the same serial-messages anti-pattern (`msg 1: Agent(...)` → wait → `msg 2: Agent(...)`) and the "right" block showing one-message multi-tool-call fan-out.

### Req 3 — TasksPlanCommand (4 scenarios)

- **plan_command_exits_zero_on_valid_tasks_file** — `tests/cli-tasks-plan.test.ts:76-108` (`happy path: disjoint tasks parallelize into one wave`) plus `tests/cli.test.ts:2275-2287` (`prints human-readable plan with Batch and Wave headers`). Exit code 0 asserted; stdout contains `--- Batch 1 ---` and `Wave 1`.
- **plan_output_groups_disjoint_tasks_together** — `tests/cli-tasks-plan.test.ts:76-108`. Three disjoint tasks produce a single wave containing all three; see also `tests/parallel-wave-computer.test.ts:8-31` for the underlying algorithmic proof.
- **plan_output_separates_conflicting_tasks** — `tests/cli-tasks-plan.test.ts:110-140` (`happy path: file-overlap serializes the shared tasks`) asserts `[sequential]` wave annotation and `shares files with 1.1` justification. Reinforced by `tests/parallel-wave-computer.test.ts:33-61` (`emits three sequential waves when all tasks share the same file`).
- **plan_output_is_tty_safe** — `tests/cli.test.ts:2285-2286` asserts `/\x1b\[/.test(stdout) === false` when stdout is piped (non-TTY). CLI invocation passes `NO_COLOR=1` via `tests/cli-tasks-plan.test.ts:33`.

### Req 4 — TasksPlanJsonOutput (3 scenarios)

- **json_flag_produces_parseable_output** — `tests/cli-tasks-plan.test.ts:142-196` (`happy path: --json output parses to the documented schema`) calls `JSON.parse(stdout)` and asserts a `batches` array; `tests/cli.test.ts:2289-2308` also parses `--json` output successfully.
- **json_wave_groupings_match_human_output** — `tests/cli-tasks-plan.test.ts:193-195` asserts all task IDs appear exactly once across all waves in the JSON. Both CLI integration tests exercise the same fixture-level grouping guarantee through the shared `computeWaves` function (`tests/parallel-wave-computer.test.ts`).
- **json_each_wave_contains_required_fields** — `tests/cli-tasks-plan.test.ts:187-191` and `tests/cli.test.ts:2304-2307` assert each wave has string `wave`, `mode` ∈ {parallel, sequential}, and `tasks` array.

### Req 5 — ParallelWaveAlgorithm (4 scenarios)

- **all_independent_tasks_produce_one_wave** — `tests/parallel-wave-computer.test.ts:8-31` (`emits one parallel wave for three disjoint tasks in one batch`). Asserts single wave with all three IDs and `mode === 'parallel'`.
- **all_conflicting_tasks_produce_sequential_waves** — `tests/parallel-wave-computer.test.ts:33-61` (`emits three sequential waves when all tasks share the same file`). Asserts three waves each with one task and `mode === 'sequential'`.
- **mixed_batch_produces_correct_wave_grouping** — `tests/parallel-wave-computer.test.ts:63-87` (`groups a disjoint task with the first task of a shared-file chain in wave 1`). Exercises shared + disjoint mix; wave 1 contains the disjoint task plus the alphabetically-first member of the shared chain.
- **depends_on_directive_respected** — `tests/parallel-wave-computer.test.ts:124-145` (`honors a dependsOn edge that has no file-overlap justification`). Disjoint files but `dependsOn: ['1.1']` places 1.2 in a later wave. Reinforced by `tests/tasks-md-parser.test.ts:39-77` proving the parser extracts `Depends on` correctly.

### Req 6 — TasksPlanAbsentTasksFile (2 scenarios)

- **missing_tasks_file_exits_with_code_4** — `tests/cli.test.ts:2310-2317` (`exits 4 and writes stderr when tasks.md is missing`) and `tests/cli-tasks-plan.test.ts:198-211` (`missing tasks.md exits 4 with a "not found" stderr message`). Both assert code 4 and stderr containing `not found`. No uncaught stack trace — tests assert on plain-text stderr content.
- **missing_tasks_file_message_is_actionable** — `tests/cli-tasks-plan.test.ts:213-233` (`missing tasks.md with --json emits a structured error envelope`) parses the `error` object with `code`, `type`, and `message` matching `/not found/i`. The JSON envelope surfaces the expected path via `error.message`.

### Req 7 — ByteIdenticalSkillMirrors (3 scenarios)

- **propose_skill_pairs_are_byte_identical** — `tests/skill-discovery-loop.test.ts:71-75` (`metta-propose template matches deployed copy byte-for-byte`). Manually confirmed via `cksum`: both `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` have checksum `3194929233 18297`.
- **quick_skill_pairs_are_byte_identical** — `tests/skill-discovery-loop.test.ts:77-81` (`metta-quick template matches deployed copy byte-for-byte`). `cksum` confirms both at `461896192 15753`.
- **existing_sync_test_still_passes** — `tests/skill-discovery-loop.test.ts` 11 tests pass (see vitest run output). Byte-identity is enforced by the live test.

## Notes

- Spec numbers requirements 1–7 above (the spec file lists 7 `## ADDED: Requirement:` blocks). The task prompt says "6 requirements"; the actual count in `spec.md` is 7. All 7 are covered.
- All 22 scenarios (prompt count matches spec: 3+3+4+3+4+2+3 = 22) have at least one passing piece of evidence.
- The implementation under `src/planning/parallel-wave-computer.ts` and `src/planning/tasks-md-parser.ts` was not modified during verification (read-only).
