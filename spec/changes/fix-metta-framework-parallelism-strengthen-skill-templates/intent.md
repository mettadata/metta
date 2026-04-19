# fix-metta-framework-parallelism-strengthen-skill-templates

## Problem

Metta changes are taking significantly longer than they should because orchestrators -- both AI-driven sessions running `/metta-propose` and developers running `/metta-quick` on multi-task changes -- default to executing task batches sequentially rather than in parallel. The most recent observed change (a ~90-minute change involving two batches totalling 9 tasks) ran Batch 1's 5 fully independent tasks one after the other, adding roughly 15 minutes of dead time, then over-serialized Batch 2's 4 tasks despite only one shared test file creating a real dependency, adding another ~10 minutes. The combined sequential overhead was approximately 25 minutes on a change that should have finished in 65 minutes.

The root cause is not a missing rule but missing enforcement structure. The current `/metta-propose` and `/metta-quick` SKILL.md templates tell orchestrators to "spawn in parallel" but they do not require orchestrators to make an explicit, auditable parallelism decision before each batch. Under load or caution, orchestrators regress to serial execution because the path of least resistance -- one tool call at a time -- is never challenged by the template. There is also no tooling to compute which tasks within a batch can actually run in parallel (based on file-overlap analysis), so orchestrators cannot act on a concrete plan even when they intend to parallelize.

Two audiences are affected. Developers using `/metta-quick` on any change with more than one task see inflated wall-clock times on otherwise-fast fixes. AI orchestrators driving `/metta-propose` on larger changes compound this across every batch, every reviewer fan-out (3 reviewers), and every verifier fan-out (3 verifiers), each of which is currently listed as "parallel" in the template but executed serially in practice.

## Proposal

### Item 1 -- Strengthen skill-template parallelism discipline

Rewrite the "Implementation" section of both `/metta-propose/SKILL.md` and `/metta-quick/SKILL.md` to make a parallelism self-check a mandatory gate before each batch, not a suggestion at the end of a list.

The new structure requires the orchestrator to:

1. Enumerate every task in the upcoming batch.
2. Inspect each task's declared `Files` field.
3. Produce an explicit written plan: "Tasks X, Y, Z share no files -- spawn in parallel. Task W touches the same file as X -- run after X completes."
4. Only after writing that plan, issue the tool calls.

The rewritten section will include anti-examples (clearly labelled "wrong") showing the serial pattern -- one `spawn` call, wait, next `spawn` call -- alongside correct examples showing the single-message multi-tool-call pattern that achieves true parallelism. The anti-example/correct-example pairing applies equally to the 3-reviewer fan-out and the 3-verifier fan-out, both of which must become explicit parallel launches.

The new default stance is: parallel unless a file-overlap conflict is documented. Sequential execution requires the orchestrator to write the specific conflicting file path as justification before proceeding serially. This makes the wrong choice visible and auditable in the session transcript.

The same edits are applied to the installed copies. Both `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` remain byte-identical (the installed copy is generated from the template at `metta init` time). The same applies to the `metta-quick` pair.

### Item 2 -- New CLI helper: `metta tasks plan --change <name>`

Add a `plan` subcommand under a new `tasks` command group. Invoked as:

```
metta tasks plan --change <change-name>
```

The command:

1. Reads `spec/changes/<name>/tasks.md`.
2. Parses every batch and extracts each task's `Files` field (a list of file paths declared in the task entry).
3. For each batch, runs a file-overlap graph: tasks are nodes; a shared file creates an edge indicating a sequential dependency. Tasks with no shared edges can be launched in the same parallel wave. When multiple overlap edges exist, the algorithm produces waves in topological order -- the first wave is the maximal independent set, subsequent waves are the tasks that unblock after each wave completes.
4. Outputs a human-readable action plan and, with `--json`, a machine-readable equivalent the orchestrator can paste directly into its reasoning step:

```
Batch 1: spawn 5 executors in parallel (Tasks 1.1, 1.2, 1.3, 1.4, 1.5 -- no file overlap)
Batch 2: Wave A parallel (2.1, 2.3, 2.4 -- disjoint), then Wave B sequential (2.2 depends on 2.1 via src/planning/parallel-wave-computer.ts)
Batch 3: all sequential -- tasks share src/cli/commands/complete.ts
```

The overlap algorithm is extracted into a standalone pure module (`src/planning/parallel-wave-computer.ts`) that accepts a list of `{ id: string; files: string[] }` records and returns `Wave[]` where each wave is a list of task IDs safe to run in parallel. This module has no I/O dependencies and is fully unit-testable.

The command is registered in the CLI entry point alongside existing command groups and ships with a test file covering: all-independent tasks (one wave), all-conflicting tasks (all sequential), mixed batches (multi-wave output), and empty batch (no output, no error).

## Impact

Files created or modified by this change:

- `src/templates/skills/metta-propose/SKILL.md` -- rewritten Implementation section with mandatory self-check, anti-examples, and parallel-by-default stance
- `.claude/skills/metta-propose/SKILL.md` -- byte-identical to the template above (installed copy)
- `src/templates/skills/metta-quick/SKILL.md` -- same rewrite scoped to quick-mode structure
- `.claude/skills/metta-quick/SKILL.md` -- byte-identical to the template above
- `src/cli/commands/tasks.ts` -- new `tasks` command group with `plan` subcommand; reads tasks.md, invokes the wave computer, formats output
- `src/planning/parallel-wave-computer.ts` -- new pure module; file-overlap graph builder and wave extractor
- `tests/tasks-plan.test.ts` -- unit tests for the `plan` subcommand covering all-parallel, all-serial, mixed, and empty cases; also directly tests `parallel-wave-computer.ts`

No changes to existing command files beyond registering the new `tasks` command group in the CLI entry point.

## Out of Scope

- No changes to `metta execute` or any runtime subagent spawning logic. This change operates entirely in the instruction layer (skill templates) and developer tooling (CLI helper). The instruction-mode contract -- where the AI tool executes work and metta manages state -- is preserved.
- No overhaul of `/metta-auto` parallelism. The auto lifecycle skill is a separate surface and not addressed here.
- No changes to the `metta-fix-issues --all` batcher. That command already performs file-overlap batching across issues; its logic is left untouched.
- No changes to the `adaptive-workflow-tier-selection` capability or the change of the same name that shipped in the previous cycle.
- No new parallelism enforcement at the process or OS level (thread pools, worker threads, etc.). All parallelism is achieved through multi-tool-call batching in the orchestrator's instruction layer.
- No changes to how `tasks.md` is authored. The `Files` field must already be present in task entries for the wave computer to produce useful output; this change does not add validation that enforces the field's presence.
