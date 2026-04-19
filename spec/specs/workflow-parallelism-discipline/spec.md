# workflow-parallelism-discipline

## Requirement: SkillParallelismSelfCheck

Both `/metta-propose/SKILL.md` and `/metta-quick/SKILL.md` MUST include a mandatory pre-batch self-check step that the orchestrator MUST execute immediately before issuing any batch of Task tool calls. The self-check MUST appear before the first Task-spawning instruction in the Implementation section. The self-check MUST instruct the orchestrator to: (a) list every task in the upcoming batch along with its declared `Files` field, (b) identify which file sets are shared across tasks and which are disjoint, (c) state explicitly which tasks will be spawned in parallel and which will be spawned sequentially, and (d) state the specific conflicting file path as the justification for any sequential choice. The default stance MUST be parallel; sequential execution MUST require written justification. The self-check block MUST use RFC 2119 imperative language (MUST, REQUIRED, or SHALL) and MUST NOT contain hedge words such as "consider", "try to", or "you may want to".
Fulfills: US-1, US-3, US-6

### Scenario: self_check_block_present_in_propose_skill
- GIVEN the file `src/templates/skills/metta-propose/SKILL.md` exists on disk
- WHEN its contents are searched for the phrase "pre-batch self-check" (or an equivalent mandatory-check header)
- THEN the phrase is found and it appears before the first Task-spawning instruction in the file

### Scenario: self_check_uses_imperative_language
- GIVEN the updated `/metta-propose/SKILL.md` and `/metta-quick/SKILL.md` files
- WHEN their self-check blocks are scanned for modal verbs
- THEN at least one of MUST, REQUIRED, or SHALL appears in the self-check directive and hedge words ("consider", "try to", "you may want to") are absent from that directive

### Scenario: self_check_requires_file_listing
- GIVEN the self-check block in `/metta-propose/SKILL.md`
- WHEN its instructions are read
- THEN the block explicitly instructs the orchestrator to list each task's Files field, classify file sets as shared or disjoint, declare the parallel-vs-sequential decision, and name the conflicting file path when choosing sequential


## Requirement: SkillAntiExamples

Both `/metta-propose/SKILL.md` and `/metta-quick/SKILL.md` MUST include a contrasting anti-example block that shows the incorrect serial spawn pattern (one tool call, wait, next tool call) labeled explicitly as "wrong" or "anti-example", immediately adjacent to a correct example labeled "right" or "correct" showing the single-message multi-tool-call pattern that achieves true parallel execution. The anti-example block MUST use stable, recognizable delimiters (fenced code blocks with explicit labels or labeled headings) so that future contributors can identify and preserve it during edits. The anti-example block MUST NOT be placed in a separate section disconnected from the parallelism rule it illustrates.
Fulfills: US-4

### Scenario: anti_example_block_present_and_labeled
- GIVEN the updated `/metta-propose/SKILL.md` file
- WHEN its contents are searched for a block labeled "anti-example" or "wrong"
- THEN at least one such block is found and is immediately adjacent to a block labeled "correct" or "right" demonstrating the parallel multi-tool-call pattern

### Scenario: anti_example_uses_stable_markers
- GIVEN both updated SKILL.md files
- WHEN their anti-example blocks are inspected for delimiters
- THEN each block uses fenced code blocks with explicit "wrong" and "right" labels or labeled headings that a contributor can recognize without reading surrounding prose

### Scenario: quick_skill_mirrors_propose_anti_example
- GIVEN both `/metta-propose/SKILL.md` and `/metta-quick/SKILL.md`
- WHEN their anti-example sections are compared
- THEN both contain a labeled wrong-vs-right contrast demonstrating parallel Task batching and the wrong pattern shown is the same serial one-call-at-a-time pattern


## Requirement: TasksPlanCommand

The metta CLI MUST register a `tasks` command group with a `plan` subcommand, invoked as `metta tasks plan --change <name>`. The command MUST read `spec/changes/<name>/tasks.md`, parse every batch and each task's `Files` field, compute parallel waves via file-overlap analysis using the `ParallelWaveAlgorithm` (see below), and print a human-readable plan to stdout. The output MUST label waves as "Wave 1", "Wave 2", etc. and list each task ID under exactly one wave. The output MUST be plain text with no ANSI escape codes when stdout is not a TTY. The command MUST exit with code 0 on success.
Fulfills: US-2

### Scenario: plan_command_exits_zero_on_valid_tasks_file
- GIVEN a change directory at `spec/changes/my-change/` containing a valid `tasks.md` with four tasks, two of which share a file and two of which are disjoint from all others
- WHEN `metta tasks plan --change my-change` is executed
- THEN the process exits with code 0, stdout contains "Wave 1" and "Wave 2" labels, and each task ID appears under exactly one wave

### Scenario: plan_output_groups_disjoint_tasks_together
- GIVEN a `tasks.md` with three tasks whose file paths are pairwise disjoint
- WHEN `metta tasks plan --change <name>` runs
- THEN all three task IDs appear under the same wave label in the output

### Scenario: plan_output_separates_conflicting_tasks
- GIVEN a `tasks.md` with two tasks that declare the same file path in their Files fields
- WHEN `metta tasks plan --change <name>` runs
- THEN those two task IDs appear under different wave labels

### Scenario: plan_output_is_tty_safe
- GIVEN a valid tasks.md and stdout redirected to a file (not a TTY)
- WHEN `metta tasks plan --change <name>` runs
- THEN the output file contains no ANSI escape sequences and is directly usable as plain text in a chat prompt


## Requirement: TasksPlanJsonOutput

The `metta tasks plan` command MUST support a `--json` flag. When `--json` is passed, the command MUST emit to stdout a valid JSON document with the following top-level shape: `{ "change": "<name>", "batches": [{ "batch": <number>, "waves": [{ "wave": "<label>", "mode": "parallel" | "sequential", "tasks": ["<id>", ...] }] }] }`. The JSON output MUST NOT include ANSI escape codes. The wave groupings in the JSON output MUST be identical to those in the human-readable output for the same input. The command MUST exit with code 0 when `--json` is used and the input is valid.
Fulfills: US-5

### Scenario: json_flag_produces_parseable_output
- GIVEN a valid change with a `tasks.md` containing at least two batches
- WHEN `metta tasks plan --change <name> --json` is executed
- THEN stdout is valid JSON that can be parsed without error and contains a top-level `batches` array

### Scenario: json_wave_groupings_match_human_output
- GIVEN the same `tasks.md` fixture
- WHEN both `metta tasks plan --change <name>` and `metta tasks plan --change <name> --json` are executed
- THEN the set of task IDs in each wave is identical between the two outputs

### Scenario: json_each_wave_contains_required_fields
- GIVEN the parsed JSON from `metta tasks plan --change <name> --json`
- WHEN each element of the `waves` array within a batch is inspected
- THEN every wave element contains a `wave` label field, a `mode` field with value "parallel" or "sequential", and a `tasks` array of task ID strings


## Requirement: ParallelWaveAlgorithm

A pure module `src/planning/parallel-wave-computer.ts` MUST be created. The module MUST export a function that accepts a list of `{ id: string; files: string[] }` records and returns a `Wave[]` structure where each wave lists task IDs that are safe to run in parallel. The algorithm MUST: build a task graph where tasks sharing any file path are connected by an edge; compute connected components of this graph; treat each connected component as a sequential grouping; collect tasks from components that have no edges to each other into the same parallel wave. For components with declared `Depends on` directives, the algorithm MUST respect those directives and place dependent tasks in later waves. The module MUST have no I/O dependencies; it MUST be a pure function over its input.
Fulfills: US-2, US-5

### Scenario: all_independent_tasks_produce_one_wave
- GIVEN a list of four task records with pairwise-disjoint file sets and no Depends-on directives
- WHEN the wave-computer function is called with this list
- THEN it returns a single wave containing all four task IDs

### Scenario: all_conflicting_tasks_produce_sequential_waves
- GIVEN a list of three task records where every pair shares at least one file path
- WHEN the wave-computer function is called
- THEN it returns three waves each containing one task ID (all sequential)

### Scenario: mixed_batch_produces_correct_wave_grouping
- GIVEN a list of five task records where tasks A, B, C have disjoint files and tasks D and E each share a file with A
- WHEN the wave-computer function is called
- THEN wave 1 contains B and C (and possibly others with no conflicts), and D and E appear in later waves after A

### Scenario: depends_on_directive_respected
- GIVEN two task records with completely disjoint file sets but task Y declaring "Depends on: X"
- WHEN the wave-computer function is called
- THEN X appears in an earlier wave than Y despite having no file overlap


## Requirement: TasksPlanAbsentTasksFile

When `metta tasks plan --change <name>` is invoked and `spec/changes/<name>/tasks.md` does not exist, the command MUST exit with code 4 and print a clear error message identifying the missing file path to stderr. The command MUST NOT throw an uncaught exception or crash with a stack trace on this condition.
Fulfills: US-2

### Scenario: missing_tasks_file_exits_with_code_4
- GIVEN a change name that has no `tasks.md` under `spec/changes/<name>/`
- WHEN `metta tasks plan --change <name>` is executed
- THEN the process exits with code 4, stderr contains the expected missing-file path, and no uncaught exception stack trace appears in stdout or stderr

### Scenario: missing_tasks_file_message_is_actionable
- GIVEN the error output from the command when tasks.md is absent
- WHEN the error message is read
- THEN it identifies the full expected file path so the developer knows exactly which file to create


## Requirement: ByteIdenticalSkillMirrors

After all edits in this change, the file `src/templates/skills/metta-propose/SKILL.md` MUST be byte-identical to `.claude/skills/metta-propose/SKILL.md`. Likewise, `src/templates/skills/metta-quick/SKILL.md` MUST be byte-identical to `.claude/skills/metta-quick/SKILL.md`. Both pairs MUST be updated in sync as part of this change. The existing test `tests/skill-discovery-loop.test.ts` enforces this invariant and MUST continue to pass after the edits.
Fulfills: US-1, US-3, US-4

### Scenario: propose_skill_pairs_are_byte_identical
- GIVEN the updated `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md`
- WHEN a byte-level comparison (e.g., `diff` or checksum) is run between the two files
- THEN the comparison reports no differences

### Scenario: quick_skill_pairs_are_byte_identical
- GIVEN the updated `src/templates/skills/metta-quick/SKILL.md` and `.claude/skills/metta-quick/SKILL.md`
- WHEN a byte-level comparison is run between the two files
- THEN the comparison reports no differences

### Scenario: existing_sync_test_still_passes
- GIVEN the updated skill files
- WHEN `vitest run tests/skill-discovery-loop.test.ts` is executed
- THEN all tests in that file pass with exit code 0
