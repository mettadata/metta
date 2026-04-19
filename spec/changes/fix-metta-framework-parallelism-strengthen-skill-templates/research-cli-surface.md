# Research: CLI Surface Design for `metta tasks plan`

**Change:** fix-metta-framework-parallelism-strengthen-skill-templates
**Date:** 2026-04-19
**Scope:** Command location, human output format, JSON schema, and error handling for `metta tasks plan --change <name>`

---

## 1. Command Location and Commander Structure

### Option A: New `src/cli/commands/tasks.ts` (dedicated command group)

Register a top-level `tasks` command group with `plan` as a subcommand, following the identical pattern used by `gate.ts` and `backlog.ts`. The function exported is `registerTasksCommand(program: Command): void`. Inside, a parent `tasks` command is created with `.command('tasks')`, and `plan` is chained off it with `.command('plan')`.

`src/cli/index.ts` gains one import and one registration call, inserted alphabetically (after `registerStatusCommand`, before `registerUpdateCommand`).

```typescript
// src/cli/commands/tasks.ts
export function registerTasksCommand(program: Command): void {
  const tasks = program
    .command('tasks')
    .description('Task planning utilities')

  tasks
    .command('plan')
    .description('Compute parallel wave plan from tasks.md')
    .option('--change <name>', 'Change name (required)')
    .action(async (options) => {
      const json = program.opts().json
      // ...
    })
}
```

**Pros:**
- Matches `gate.ts` / `backlog.ts` / `gaps.ts` patterns exactly — one file per command group, subcommands chained off the group parent.
- The namespace `tasks` is unoccupied: no existing `tasks.ts` in `src/cli/commands/`.
- Makes space for future subcommands (`metta tasks list`, `metta tasks validate`) without touching the command surface again.
- Spec requires `metta tasks plan` — this is the literal invocation, and a `tasks` group is the canonical Commander way to spell it.

**Cons:**
- Adds one more file and one more registration call to `src/cli/index.ts` (minor, consistent with all other commands).

### Option B: Inline subcommand in `src/cli/commands/plan.ts`

Add a `plan tasks` subcommand or a `--tasks` flag inside the existing `plan.ts`. The existing `plan` command handles artifact workflow planning (it reads `ChangeMetadata.artifacts`); this would be a second, unrelated concern in the same file.

**Pros:** No new file needed.

**Cons:**
- The existing `metta plan` command has a completely different purpose (it surfaces artifact workflow state, not task wave computation). Mixing the two violates the single-responsibility principle.
- The spec specifies `metta tasks plan`, not `metta plan tasks` or `metta plan --tasks`. There is no ambiguity in the required invocation.
- `--change <name>` is already used in `plan.ts` as an alias for a positional argument; there would be a flag collision and semantic confusion.

### Option C: New `--tasks` flag on an existing command

Add `--tasks` to `metta status` or `metta plan`. Rejected: the invocation `metta tasks plan --change <name>` is explicitly stated in the spec (`TasksPlanCommand` requirement). Neither flag grafting nor positional tricks can match that surface without Commander `tasks` group registration.

### Recommendation: Option A

Create `src/cli/commands/tasks.ts` with `registerTasksCommand`. This is the only approach that matches the literal spec invocation and is consistent with every existing multi-subcommand group (`gate`, `backlog`, `gaps`, `specs`, `changes`) in the codebase. Register it in `src/cli/index.ts` between `registerStatusCommand` and `registerUpdateCommand`.

---

## 2. Human Output Format

### Context

The spec (`TasksPlanCommand` requirement) mandates:
- Wave labels: "Wave 1", "Wave 2", etc.
- Each task ID appears under exactly one wave.
- No ANSI escape codes when stdout is not a TTY.
- The output is intended to be consumed by an AI orchestrator reading it out of a terminal or piping it into a prompt.

TTY detection is via `process.stdout.isTTY`. The `color()` helper in `helpers.ts` always emits ANSI codes; the command must suppress it when not a TTY. The simplest approach: define a local `fmt(text: string, code: number): string` that calls `color()` only when `process.stdout.isTTY`.

### Option A: Indented wave-per-section with task IDs as a bulleted list

```
Change: my-change

Batch 1
  Wave A  [parallel]
    1.1  Implement config loader
    1.2  Add unit tests

  Wave B  [sequential]
    1.3  Register command in index.ts

Batch 2
  Wave A  [parallel]
    2.1  Update integration tests
    2.2  Update docs
```

**Pros:** Hierarchical — batch and wave are visually distinct levels. Easy to scan.
**Cons:** The batch labels ("Wave A", "Wave B") reset per-batch, which can confuse when copying across batches. AI orchestrators reading prose prefer globally unique labels.

### Option B: Globally-numbered waves with batch prefix

```
Change: my-change

--- Batch 1 ---

Wave 1  [parallel — 2 tasks]
  Task 1.1
  Task 1.2

Wave 2  [sequential — 1 task]
  Task 1.3

--- Batch 2 ---

Wave 3  [parallel — 2 tasks]
  Task 2.1
  Task 2.2
```

**Pros:**
- Wave numbers are globally unique across the entire output — an orchestrator can refer to "Wave 3" without a batch qualifier.
- Plain indentation, no special characters other than dashes — copy-paste safe, renders correctly in both terminal and Markdown-formatted chat.
- The `---` batch separator is a recognizable horizontal rule that parses reliably in regex.
- Matches the internal JSON structure (`batches[].waves[].tasks`) in a readable way.
- The `[parallel]` / `[sequential]` annotation tells an orchestrator exactly how to spawn the listed tasks.

**Cons:** Wave numbers are not reset per batch, so the numbers climb. For a change with many batches and many waves, Wave 37 can appear for Batch 5. This is actually a feature for AI use: the number is globally unambiguous.

### Option C: Markdown table

```
| Batch | Wave | Mode       | Tasks        |
|-------|------|------------|--------------|
| 1     | 1    | parallel   | 1.1, 1.2     |
| 1     | 2    | sequential | 1.3          |
| 2     | 3    | parallel   | 2.1, 2.2     |
```

**Pros:** Compact, easy to parse with column-aligned scanning.
**Cons:** Task IDs with long names truncate or blow up the column width. Task descriptions are lost. An AI orchestrator cannot copy a single wave row and use it directly as a task list without further parsing.

### Recommendation: Option B (globally-numbered waves)

The separator-per-batch with globally-unique wave numbers gives an AI orchestrator the clearest signal: read the `[parallel]` or `[sequential]` annotation, then spawn all listed task IDs in one message or one-at-a-time accordingly. The format is plain text that survives pipe, markdown fences, and clipboard paste without transformation.

**Concrete example output for a two-batch, three-wave scenario:**

```
Change: my-change

--- Batch 1 (no dependencies) ---

Wave 1  [parallel — 3 tasks]
  Task 1.1
  Task 1.2
  Task 1.3

--- Batch 2 (depends on Batch 1) ---

Wave 2  [sequential — 1 task]
  Task 2.1

Wave 3  [parallel — 2 tasks]
  Task 2.2
  Task 2.3
```

When `process.stdout.isTTY` is true, `Batch 1` header and `Wave N` labels may be colored (ANSI codes). When stdout is not a TTY, all output is plain ASCII — no escapes.

---

## 3. JSON Schema

### Concrete shape (spec-mandated top level)

The spec (`TasksPlanJsonOutput` requirement) specifies:

```json
{
  "change": "<name>",
  "batches": [
    {
      "batch": 1,
      "waves": [
        {
          "wave": "Wave 1",
          "mode": "parallel",
          "tasks": ["1.1", "1.2"]
        }
      ]
    }
  ]
}
```

### Full schema with all error and success shapes

**Success (exit 0):**
```json
{
  "change": "my-change",
  "batches": [
    {
      "batch": 1,
      "label": "Batch 1 (no dependencies)",
      "waves": [
        {
          "wave": "Wave 1",
          "mode": "parallel",
          "tasks": ["1.1", "1.2", "1.3"]
        }
      ]
    },
    {
      "batch": 2,
      "label": "Batch 2 (depends on Batch 1)",
      "waves": [
        {
          "wave": "Wave 2",
          "mode": "sequential",
          "tasks": ["2.1"]
        },
        {
          "wave": "Wave 3",
          "mode": "parallel",
          "tasks": ["2.2", "2.3"]
        }
      ]
    }
  ]
}
```

**Error (exit 4):**
```json
{
  "error": {
    "code": 4,
    "type": "tasks_plan_error",
    "message": "tasks.md not found: spec/changes/my-change/tasks.md"
  }
}
```

### Schema field notes

- `batches[].batch`: integer, 1-indexed, matches the `## Batch N` header in `tasks.md`.
- `batches[].label`: string, the full header text (e.g., `"Batch 1 (no dependencies)"`). Optional enrichment; allows orchestrators to reproduce the human output without re-reading the file.
- `batches[].waves[].wave`: string, globally-unique label `"Wave N"` where N is a monotonically increasing integer across all batches — not reset per batch.
- `batches[].waves[].mode`: `"parallel"` when more than one task is in the wave; `"sequential"` when exactly one task is in the wave.
- `batches[].waves[].tasks`: array of task ID strings in document order within the wave.
- Error envelope matches the project-wide pattern (`{ error: { code, type, message } }`) as used in `status.ts`, `gate.ts`, `backlog.ts`, and `handleError()` in `helpers.ts`.

### TypeScript interface

```typescript
interface TasksPlanWave {
  wave: string        // "Wave 1", "Wave 2", ...
  mode: 'parallel' | 'sequential'
  tasks: string[]     // task IDs, e.g. ["1.1", "1.2"]
}

interface TasksPlanBatch {
  batch: number       // 1-indexed
  label: string       // full ## header text
  waves: TasksPlanWave[]
}

interface TasksPlanResult {
  change: string
  batches: TasksPlanBatch[]
}
```

---

## 4. Error Handling and Exit Codes

### Error conditions and exit codes

| Condition | Exit Code | Stderr message | JSON `error.type` |
|---|---|---|---|
| `--change` not provided and not inferable | 4 | `No change name specified. Use --change <name>.` | `tasks_plan_error` |
| `spec/changes/<name>/tasks.md` does not exist | 4 | `tasks.md not found: spec/changes/<name>/tasks.md` | `tasks_plan_error` |
| `tasks.md` exists but no `## Batch` headers found | 4 | `tasks.md has no batch sections: spec/changes/<name>/tasks.md` | `tasks_plan_error` |
| A task block has no `Files` field | 0 (warn) | (none — task treated as having empty file list; can run parallel) | n/a — not an error |
| `Depends on` references a task ID that does not exist in the file | 4 | `tasks.md: task <id> declares Depends on '<ref>' which is not defined` | `tasks_plan_error` |
| `Depends on` graph contains a cycle | 4 | `tasks.md: dependency cycle detected involving task(s): <ids>` | `tasks_plan_error` |
| Uncaught internal error | 4 | `tasks plan failed: <message>` | `tasks_plan_error` |

### Rationale for exit code choices

- **Exit code 4** is the project-wide convention for user-facing errors (missing resources, validation failures). It is used identically in `status.ts`, `gate.ts`, `plan.ts`, and codified in `handleError()` in `helpers.ts`. The spec (`TasksPlanAbsentTasksFile` requirement) explicitly mandates exit code 4 for the missing-file case.
- **Exit code 0 for missing `Files` field:** The spec does not treat a missing `Files` field as an error. The algorithm treats such a task as having an empty file set — it conflicts with nothing and goes into the first available wave. A warning to stderr (non-TTY-safe plain text) is appropriate but not a process failure.
- **Exit code 1** is reserved for gate failures (`gate.ts` uses it). The `tasks plan` command is not a gate and must not use exit code 1.

### Error message requirements (from spec)

The `TasksPlanAbsentTasksFile` requirement states the error message must "identify the full expected file path so the developer knows exactly which file to create." The message format `tasks.md not found: spec/changes/<name>/tasks.md` satisfies this: it is relative to the project root, actionable, and does not include a stack trace.

### No-uncaught-exception guarantee

The entire action body must be wrapped in a `try/catch`. On catch:
- If `--json`: emit `outputJson({ error: { code: 4, type: 'tasks_plan_error', message } })` to stdout.
- In both modes: call `process.exit(4)`.
- Never let an uncaught `Error` surface as a stack trace to stdout or stderr.

---

## Summary

**Chosen location:** `src/cli/commands/tasks.ts`, exporting `registerTasksCommand(program: Command): void`. Registered in `src/cli/index.ts` between `registerStatusCommand` and `registerUpdateCommand`. No changes to `plan.ts`.

**JSON schema (one line):** `{ "change": string, "batches": [{ "batch": number, "label": string, "waves": [{ "wave": string, "mode": "parallel"|"sequential", "tasks": string[] }] }] }`
