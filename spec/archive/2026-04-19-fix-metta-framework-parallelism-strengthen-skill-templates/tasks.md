# Tasks for fix-metta-framework-parallelism-strengthen-skill-templates

## Batch 1 (no dependencies — fully parallel)

- [ ] **Task 1.1: parallel-wave-computer module + tests**
  - **Files**:
    - `src/planning/parallel-wave-computer.ts`
    - `tests/parallel-wave-computer.test.ts`
  - **Action**: Create `src/planning/parallel-wave-computer.ts` exporting the pure `computeWaves(graph: TaskGraph): WavePlan` function. Implement union-find on file-path overlap to form connected-component clusters; run Kahn's topological sort on the cluster DAG honoring `Depends on` directives; emit each cluster at its computed topological level as a `Wave` with `mode: 'parallel' | 'sequential'`. Missing `Files` fields are treated as disjoint (soft-warn, no hard fail). Dependency cycles throw a typed `CycleError` with the involved task IDs. Also define the `TaskGraph`, `Task`, `Batch`, `Wave`, `BatchPlan`, `WavePlan`, `CycleError`, and Zod schemas for `Task`, `Batch`, and `TaskGraph`. Write `tests/parallel-wave-computer.test.ts` covering: all-independent tasks produce one wave, all-conflicting tasks produce sequential waves, mixed batch produces correct wave grouping, depends-on directive respected despite disjoint files, cycle detection throws `CycleError`, missing Files field emits warning and does not crash.
  - **Verify**: `npx vitest run tests/parallel-wave-computer.test.ts && npx tsc --noEmit`
  - **Done**: All unit tests pass, no TypeScript errors.

- [ ] **Task 1.2: tasks-md-parser module + tests**
  - **Files**:
    - `src/planning/tasks-md-parser.ts`
    - `tests/tasks-md-parser.test.ts`
  - **Action**: Create `src/planning/tasks-md-parser.ts` exporting `parseTasksMd(markdown: string): TaskGraph`. Use `remark-parse` + `unified` (consistent with existing `spec-parser.ts`) to extract batch headers (h2 lines containing "Batch"), task IDs from bold task headings, `Files` bullet lists, and `Depends on` bullet values. Missing `Files` returns an empty array and emits a soft warning. Malformed `Depends on` entries skip the edge and emit a soft warning. Hard-fail only on unrecoverable parse errors (throw typed `ParseError`). Write `tests/tasks-md-parser.test.ts` covering: valid tasks.md produces correct `TaskGraph`, missing Files field yields empty array with warning, malformed Depends on skips edge, multiple batches parsed correctly, empty file throws `ParseError`.
  - **Verify**: `npx vitest run tests/tasks-md-parser.test.ts && npx tsc --noEmit`
  - **Done**: All unit tests pass, no TypeScript errors.

- [ ] **Task 1.3: planning barrel export**
  - **Files**:
    - `src/planning/index.ts`
  - **Action**: Create `src/planning/index.ts` exporting `parseTasksMd`, `computeWaves`, and all public types (`TaskGraph`, `Task`, `Batch`, `Wave`, `BatchPlan`, `WavePlan`, `ParseError`, `CycleError`) from their respective modules using `.js` extensions as required by Node16 ESM conventions.
  - **Verify**: `npx tsc --noEmit`
  - **Done**: File compiles cleanly and exports resolve correctly.

---

## Batch 2 (depends on Batch 1 — tasks 2.1 and 2.2 touch different files, run in parallel)

- [ ] **Task 2.1: tasks CLI command + renderer + unit tests**
  - **Files**:
    - `src/cli/commands/tasks.ts`
    - `src/cli/commands/tasks-renderer.ts`
    - `tests/cli.test.ts`
  - **Action**: Create `src/cli/commands/tasks-renderer.ts` with pure functions `renderHumanPlan(plan: WavePlan): string` (uses `--- Batch N ---` headers and `Wave N [parallel|sequential]: Task X, Task Y` lines, no ANSI codes) and `renderJsonPlan(plan: WavePlan): string` (serializes to the JSON schema: `{ change, batches: [{ batch, label, waves: [{ wave, mode, tasks }] }] }`). Create `src/cli/commands/tasks.ts` registering a `tasks` parent command group with a `plan` subcommand accepting `--change <name>` (required) and `--json` flags; resolves `spec/changes/<name>/tasks.md` relative to the project root; calls `parseTasksMd`, then `computeWaves`, then the appropriate renderer; exits code 4 for missing `tasks.md`, dependency cycle, or malformed input (error to stderr; in `--json` mode wrap in the `{ error: { code, type, message } }` envelope from `helpers.ts`). Follow the multi-subcommand pattern of `gate.ts` / `backlog.ts` / `gaps.ts`. Export `registerTasksCommand`. Add unit tests for renderer functions and error-path handling to `tests/cli.test.ts`.
  - **Verify**: `npx vitest run tests/cli.test.ts && npx tsc --noEmit`
  - **Done**: Renderer and command compile cleanly; unit tests covering human output format, JSON output format, and error paths all pass.

- [ ] **Task 2.2: register tasks command in CLI index**
  - **Files**:
    - `src/cli/index.ts`
  - **Action**: Add `import { registerTasksCommand } from './commands/tasks.js'` and call `registerTasksCommand(program)` between the `registerStatusCommand(program)` call and the `registerUpdateCommand(program)` call in `src/cli/index.ts`.
  - **Verify**: `npx tsc --noEmit && node dist/cli/index.js tasks --help 2>&1 | grep -q 'plan'`
  - **Done**: `metta tasks --help` lists the `plan` subcommand and TypeScript compiles with no errors.

---

## Batch 3 (depends on nothing — tasks 3.1 and 3.2 touch different files, run in parallel)

- [ ] **Task 3.1: strengthen metta-propose SKILL.md (both copies)**
  - **Files**:
    - `src/templates/skills/metta-propose/SKILL.md`
    - `.claude/skills/metta-propose/SKILL.md`
  - **Action**: Rewrite step 4 (Implementation), step 5 (Review), and step 6 (Verify) fan-outs in both copies to include: (a) a mandatory pre-batch self-check block using RFC 2119 language (MUST/SHALL) that instructs the orchestrator to list each task's `Files` field, classify file sets as shared or disjoint, declare parallel-vs-sequential decisions, and name the specific conflicting file path as written justification for any sequential choice; (b) rule-inversion default — parallel unless a named file conflict is stated; (c) an adjacent wrong/right anti-example block using fenced code blocks labeled `wrong` and `right` showing serial one-call-at-a-time vs single-message multi-tool-call parallel pattern. No hedge words ("consider", "try to", "you may want to") in the self-check block. Stable `wrong`/`right` fenced-block markers so future contributors can identify them. Both copies MUST be byte-identical after the edit.
  - **Verify**: `diff src/templates/skills/metta-propose/SKILL.md .claude/skills/metta-propose/SKILL.md && grep -q 'pre-batch self-check' src/templates/skills/metta-propose/SKILL.md && grep -q 'MUST' src/templates/skills/metta-propose/SKILL.md && npx vitest run tests/skill-discovery-loop.test.ts`
  - **Done**: `diff` exits 0, `pre-batch self-check` phrase is present, `MUST` is in the self-check block, and `skill-discovery-loop.test.ts` passes.

- [ ] **Task 3.2: strengthen metta-quick SKILL.md (both copies)**
  - **Files**:
    - `src/templates/skills/metta-quick/SKILL.md`
    - `.claude/skills/metta-quick/SKILL.md`
  - **Action**: Apply the same treatment as Task 3.1 to `metta-quick` SKILL.md: rewrite step 5 (Implementation), step 7 (Review), and step 8 (Verify) with the mandatory pre-batch self-check block (RFC 2119, no hedge words), rule-inversion default (parallel unless named file conflict stated), and adjacent `wrong`/`right` fenced anti-example block. Both copies MUST be byte-identical after the edit.
  - **Verify**: `diff src/templates/skills/metta-quick/SKILL.md .claude/skills/metta-quick/SKILL.md && grep -q 'pre-batch self-check' src/templates/skills/metta-quick/SKILL.md && grep -q 'MUST' src/templates/skills/metta-quick/SKILL.md && npx vitest run tests/skill-discovery-loop.test.ts`
  - **Done**: `diff` exits 0, `pre-batch self-check` phrase is present, `MUST` is in the self-check block, and `skill-discovery-loop.test.ts` passes.

---

## Batch 4 (depends on Batch 2)

- [ ] **Task 4.1: integration test for metta tasks plan**
  - **Files**:
    - `tests/cli-tasks-plan.test.ts`
  - **Action**: Create `tests/cli-tasks-plan.test.ts` as an integration test that invokes `metta tasks plan` via `execFile` (or `execa`) against fixture `tasks.md` files written into a temp directory. Tests MUST cover: (a) four pairwise-disjoint tasks all appear under one wave, exit code 0; (b) two tasks sharing a file appear under different waves; (c) plain-text output contains no ANSI escape sequences; (d) `--json` flag produces parseable JSON with correct `batches`/`waves`/`mode`/`tasks` structure and wave groupings match the human output; (e) missing `tasks.md` exits with code 4 and stderr names the expected file path; (f) dependency cycle in `Depends on` exits with code 4 and identifies involved task IDs. Use the built `dist/cli/index.js` entry point for the CLI invocation.
  - **Verify**: `npx tsc --noEmit && npx vitest run tests/cli-tasks-plan.test.ts`
  - **Done**: All six integration test cases pass, no TypeScript errors.
