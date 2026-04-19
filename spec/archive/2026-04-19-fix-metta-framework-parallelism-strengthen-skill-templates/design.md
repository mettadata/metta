# Design: fix-metta-framework-parallelism-strengthen-skill-templates

## Approach

This change addresses orchestrator parallelism regression through two coordinated parts. First, both `/metta-propose/SKILL.md` and `/metta-quick/SKILL.md` are rewritten in their Implementation, Review, and Verify sections using rule inversion and a worked anti-example: the default stance becomes parallel and sequential execution requires the orchestrator to name the specific conflicting file path as written justification — raising the cognitive cost of the wrong choice relative to the right one. The anti-example uses stable fenced-code-block markers labeled "wrong" and "right" so future contributors can identify and preserve the block. Each SKILL.md file has a byte-identical mirror (`src/templates/skills/<skill>/SKILL.md` and `.claude/skills/<skill>/SKILL.md`); both copies are updated in the same task to preserve the invariant enforced by `tests/skill-discovery-loop.test.ts`. Second, a new `metta tasks plan --change <name>` CLI subcommand reads `spec/changes/<name>/tasks.md`, runs a pure wave algorithm (`components-then-toposort`: union-find on file-overlap to form sequential clusters, then Kahn's topological sort on the cluster DAG to honor `Depends on` directives), and prints a copy-paste-ready plan so orchestrators have a concrete, pre-computed analysis rather than performing the overlap reasoning themselves. Exit code 4 is returned for missing tasks.md, malformed dependencies, or dependency cycles; missing `Files` fields are soft-warned and treated as file-disjoint.

## Components

- **`src/planning/parallel-wave-computer.ts`** (NEW)
  - Responsibility: pure `computeWaves(graph: TaskGraph): WavePlan` function; union-find on file path overlap to form sequential clusters; Kahn's toposort on cluster DAG honoring `Depends on` directives; emits each cluster at its computed topological level as a `Wave` with `mode: 'parallel' | 'sequential'`
  - No I/O dependencies; fully unit-testable in isolation
  - Missing `Files` fields are treated as disjoint (soft-warn, no hard fail)
  - Dependency cycles produce a thrown error that the CLI layer maps to exit code 4

- **`src/planning/tasks-md-parser.ts`** (NEW)
  - Responsibility: parse `tasks.md` markdown into structured `TaskGraph` using `remark-parse` + `unified` (consistent with existing `spec-parser.ts` patterns)
  - Extracts batch headers, task IDs, `Files` lists, and `Depends on` lists
  - Soft-fails on missing `Files` (returns empty array, emits warning); soft-fails on malformed `Depends on` (skips edge, emits warning); hard-fails only on missing file or unrecoverable parse error

- **`src/planning/index.ts`** (NEW)
  - Responsibility: barrel export for the `planning` module; exports `parseTasksMd`, `computeWaves`, `TaskGraph`, `Wave`, `WavePlan`, and related types

- **`src/cli/commands/tasks.ts`** (NEW)
  - Responsibility: Commander registration for the `tasks` parent command group with a `plan` subcommand; accepts `--change <name>` and `--json` flags; resolves `spec/changes/<name>/tasks.md`, calls parser, calls wave computer, delegates to renderer, handles exit codes
  - Follows the multi-subcommand pattern established by `gate.ts`, `backlog.ts`, and `gaps.ts`
  - Registered between `registerStatusCommand` and `registerUpdateCommand` in `src/cli/index.ts`

- **`src/cli/commands/tasks-renderer.ts`** (NEW)
  - Responsibility: pure formatters `renderHumanPlan(plan: WavePlan): string` and `renderJsonPlan(plan: WavePlan): string`; human output uses `--- Batch N ---` headers and `Wave N [parallel|sequential]: Task X, Task Y` lines with no ANSI escape codes; JSON output serializes to the schema defined in `research.md`
  - No I/O; accepts a `WavePlan` and returns a string

- **`src/cli/index.ts`** (MODIFIED)
  - Responsibility: register the new `tasks` command group by calling `registerTasksCommand` between `registerStatusCommand` and `registerUpdateCommand`

- **`src/templates/skills/metta-propose/SKILL.md`** + **`.claude/skills/metta-propose/SKILL.md`** (MODIFIED)
  - Responsibility: rewrite step 4 (Implementation) with mandatory pre-batch self-check using RFC 2119 imperative language (MUST/SHALL), rule-inversion default (parallel unless named file conflict), and adjacent wrong/right anti-example block; apply same treatment to step 5 (Review) and step 6 (Verify) fan-outs; both copies updated in the same task to maintain byte identity

- **`src/templates/skills/metta-quick/SKILL.md`** + **`.claude/skills/metta-quick/SKILL.md`** (MODIFIED)
  - Responsibility: same pre-batch self-check, rule-inversion, and anti-example treatment applied to step 5 (Implementation), step 7 (Review), and step 8 (Verify); both copies updated in sync

## Data Model

```typescript
type TaskId = string; // e.g. "1.1"

interface Task {
  id: TaskId;
  files: string[];      // declared Files field; empty if absent (soft-warn)
  dependsOn: TaskId[];  // declared Depends on field; empty if absent
}

interface Batch {
  batch: number;
  label: string;
  tasks: Task[];
}

interface TaskGraph {
  batches: Batch[];
}

// Output types produced by parallel-wave-computer.ts
interface Wave {
  wave: string;                     // e.g. "Wave 1"
  mode: 'parallel' | 'sequential';
  tasks: TaskId[];
}

interface BatchPlan {
  batch: number;
  label: string;
  waves: Wave[];
}

interface WavePlan {
  change: string;
  batches: BatchPlan[];
}
```

`TaskGraph` is the parser's output contract; `WavePlan` is the wave computer's output contract. Both are pure value objects with no methods. Zod schemas are defined for `Task`, `Batch`, and `TaskGraph` to validate parser output before it reaches the wave computer, consistent with the project convention of validating all state reads.

## API Design

**Parser** (`src/planning/tasks-md-parser.ts`):
```typescript
function parseTasksMd(markdown: string): TaskGraph
```
Throws a typed `ParseError` on unrecoverable failures. Returns a valid `TaskGraph` (possibly with empty `files` arrays) on partial input.

**Wave computer** (`src/planning/parallel-wave-computer.ts`):
```typescript
function computeWaves(graph: TaskGraph): WavePlan
```
Pure function; no I/O. Throws a typed `CycleError` containing the involved task IDs if a dependency cycle is detected. Returns a `WavePlan` with globally-numbered waves across all batches.

**Human renderer** (`src/cli/commands/tasks-renderer.ts`):
```typescript
function renderHumanPlan(plan: WavePlan): string
function renderJsonPlan(plan: WavePlan): string
```
Both are pure string transformations. `renderHumanPlan` produces no ANSI codes; output is TTY-safe for copy-paste into chat prompts.

**CLI surface**:
- `metta tasks plan --change <name>` — human-readable output, exit 0 on success
- `metta tasks plan --change <name> --json` — JSON output matching the schema in `research.md`, exit 0 on success
- Exit code 4 for: missing `tasks.md`, dependency cycle, or malformed input; error message to stderr names the full expected file path or the involved task IDs; in `--json` mode the error is wrapped in the `{ error: { code, type, message } }` envelope from `helpers.ts`

**Registration** (`src/cli/index.ts`):
```typescript
registerTasksCommand(program);
```
Called between `registerStatusCommand(program)` and `registerUpdateCommand(program)`.

## Dependencies

- **Internal — `remark-parse` + `unified`**: used by `tasks-md-parser.ts` for consistency with `spec-parser.ts`; no new dependency introduction
- **Internal — `src/cli/helpers.ts`**: `handleError()` and the `{ error: { code, type, message } }` JSON error envelope reused in `tasks.ts` for `--json` error output
- **External**: none new; all required packages are already present in `package.json`

No vendor lock-in is introduced. The wave algorithm is a ~120-line pure TypeScript function with no runtime library dependency.

## Risks & Mitigations

- **R1: Orchestrators ignore strengthened skill wording** — prose rules cannot be mechanically enforced; an orchestrator under token or time pressure may still regress to serial execution. Mitigation: rule inversion raises the cost of serial choice by requiring a named file path as justification; the anti-example targets LLM pattern-avoidance directly (per research finding); `metta tasks plan` removes the cognitive cost of the overlap analysis so the orchestrator has no computation excuse to skip the parallel path.

- **R2: tasks.md format drift across changes** — the parser must tolerate missing or malformed fields without crashing. Mitigation: missing `Files` field is treated as an empty list and emits a soft warning; malformed `Depends on` entries skip the edge and emit a soft warning; hard-fail (exit 4) only for missing `tasks.md` or a detected dependency cycle; this over-serializes rather than races on ambiguous input.

- **R3: Byte-identity divergence between `src/templates/` and `.claude/` SKILL.md copies** — `tests/skill-discovery-loop.test.ts` enforces byte identity; a drift would cause CI failure. Mitigation: every task that edits a SKILL.md explicitly edits both copies in the same tool call batch; the task Verify step greps both paths; the existing test continues to serve as the mechanical backstop.

- **R4: `metta tasks plan` output format drifts from orchestrator expectations** — if the human or JSON format changes post-ship, orchestrators pasting the plan into prompts will receive unexpected structure. Mitigation: the human format is fixed exactly as specified in `research.md` (`--- Batch N ---` / `Wave N [parallel|sequential]: ...`); the JSON schema is validated by the renderer's own unit tests; format changes are a breaking-change requiring a new spec requirement.

- **R5: Wave algorithm produces incorrect groupings on `Depends on` + file-overlap combinations** — the components-then-toposort approach must correctly handle cases where tasks share files AND have explicit dependency directives. Mitigation: unit tests cover all-independent, all-conflicting, mixed, and depends-on-with-disjoint-files cases (per spec scenarios `all_independent_tasks_produce_one_wave`, `all_conflicting_tasks_produce_sequential_waves`, `mixed_batch_produces_correct_wave_grouping`, `depends_on_directive_respected`); the algorithm is pure so tests run in isolation without filesystem or process setup.
