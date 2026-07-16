# delete-dead-code-identified-2026-07-framework-review-v0-2 — User Stories

## US-1: Execution-engine island is gone, live task parsing preserved

**As a** metta maintainer reading the codebase to understand what actually runs
**I want to** have the dead `src/execution/` engine island (`ExecutionEngine`, `WorktreeManager`, the fan-out helper, and `planBatches`) deleted, with the still-live `parseTasks`/`markTaskComplete` functions relocated to `src/planning/`
**So that** I no longer pay a comprehension tax on ~1,200 lines of aspirational scaffolding that looks load-bearing but is wired to nothing, while `metta complete` keeps working exactly as before
**Priority:** P1
**Independent Test Criteria:** `grep -r "ExecutionEngine\|WorktreeManager" src/` returns nothing, `npx vitest run` and `tsc` pass, and `metta complete`'s task-parsing path still works via the relocated `src/planning/` functions.

**Acceptance Criteria:**
- **Given** the change is merged **When** a contributor greps `src/` for `ExecutionEngine`, `WorktreeManager`, the fan-out helper, or `planBatches` **Then** no matches are found and `src/index.ts` no longer exports those symbols
- **Given** `parseTasks` and `markTaskComplete` have moved to `src/planning/` **When** `src/cli/commands/complete.ts` runs against a change with a `tasks.md` **Then** tasks are parsed and marked complete identically to pre-change behavior
- **Given** `src/planning/parallel-wave-computer.ts` is confirmed live **When** the deletion lands **Then** that module and its behavior are untouched
- **Given** the deleted test files (`tests/execution-engine.test.ts`, `tests/worktree-manager.test.ts`) and pruned `tests/batch-planner.test.ts` cases **When** `npx vitest run` and `tsc` execute **Then** both pass green

---

## US-2: Tool delivery calls Claude Code functions directly

**As a** metta contributor working on skill/command installation
**I want to** have the single-implementation `ToolAdapter` interface removed so `command-installer.ts` calls the Claude Code adapter functions directly
**So that** the delivery path has no speculative indirection, and changes to installation are obviously safe to reason about
**Priority:** P1
**Independent Test Criteria:** `grep -rn "ToolAdapter" src/` returns nothing, `npx vitest run` passes, and `metta install` run in a temp project still installs skills with byte-identical output structure.

**Acceptance Criteria:**
- **Given** the `ToolAdapter` interface is deleted from `tool-adapter.ts` **When** a contributor inspects `src/delivery/` **Then** the Claude Code functions are exported directly and `command-installer.ts` has no generic adapter-type parameter
- **Given** the `SkillContent`/`ProjectContext` content types are still needed by live callers and `tests/delivery.test.ts` **When** the interface is removed **Then** those content types are preserved and importable
- **Given** a fresh temp directory **When** `metta install` runs **Then** the installed skills, commands, and files are unchanged from pre-change output
- **Given** the pruned `tests/delivery.test.ts` **When** `npx vitest run` and `tsc` execute **Then** both pass green

---

## US-3: Dead schemas removed, state files still validate

**As a** metta maintainer relying on Zod schemas as the source of truth for state shape
**I want to** have `plugin-manifest.ts` and `auto-state.ts` deleted, including the `auto` field on `StateFileSchema`, in one atomic deletion
**So that** the schema layer only describes state that is actually written and read, and no dangling optional field survives without a producer or consumer
**Priority:** P2
**Independent Test Criteria:** `grep -rn "PluginManifest\|AutoStateSchema" src/` returns nothing, `npx vitest run` passes, and an existing project's `state.yaml` files still parse under the updated strict `StateFileSchema` via a live `metta status` run.

**Acceptance Criteria:**
- **Given** `src/schemas/plugin-manifest.ts` and `src/schemas/auto-state.ts` are deleted **When** a contributor greps `src/` for their symbols **Then** no matches remain and the schema barrel no longer exports them
- **Given** `StateFileSchema` is `.strict()` and drops the `auto` field **When** every existing `state.yaml` in the repository and test fixtures is validated **Then** validation succeeds because no file ever contained `.auto` (verified, not assumed)
- **Given** the pruned `tests/schemas.test.ts` **When** `npx vitest run` and `tsc` execute **Then** both pass green

---

## US-4: CLI surface tells the truth

**As a** developer or AI orchestrator reading `--help` output to decide what command to run
**I want to** have `metta auto` describe itself as a pointer to `metta propose` and `metta execute` drop the decorative `--resume` option
**So that** I am never misled into believing metta drives an automated lifecycle loop or supports checkpoint resume when neither behavior exists
**Priority:** P2
**Independent Test Criteria:** `metta auto --help` and its runtime output describe pointer behavior with no lifecycle-loop claims, `metta execute --help` no longer lists `--resume`, and `npx vitest run` passes.

**Acceptance Criteria:**
- **Given** the rewritten `metta auto` command **When** a user runs `metta auto` or `metta auto --help` **Then** the output accurately states that it points to `metta propose` and makes no claim of running an automated loop
- **Given** the `--resume` option is removed **When** a user runs `metta execute --help` **Then** `--resume` does not appear, and `metta execute --resume` fails with a standard unknown-option error instead of printing a fake "Resuming from last checkpoint..." message
- **Given** `metta auto` is corrected in framing only **When** the change lands **Then** the command still exists under the same name with all other `metta execute` options intact
- **Given** the CLI changes **When** `npx vitest run` and `tsc` execute **Then** both pass green

---

## US-5: Workflow engine carries no speculative machinery

**As a** metta contributor maintaining the workflow engine
**I want to** have `mergeWorkflows`, the `extends`-handling branch, the `extends`/`overrides` schema fields, and the redundant `WorkflowEngine.validate()` deleted
**So that** the engine's surface matches what shipped workflows actually use, with dangling-reference enforcement living in exactly one place (`topologicalSort`)
**Priority:** P1
**Independent Test Criteria:** `grep -rn "mergeWorkflows\|extends" src/workflow* src/schemas/workflow-definition.ts` returns nothing, `npx vitest run` passes, and all shipped workflow YAMLs (`full`, `quick`, `standard`, `trivial`) still load and topologically sort without error.

**Acceptance Criteria:**
- **Given** `mergeWorkflows` and the `extends` branch of `loadWorkflow` are deleted **When** a contributor greps the workflow engine and `workflow-definition.ts` **Then** no `extends`/`overrides` handling or fields remain
- **Given** `WorkflowEngine.validate()` is deleted **When** a workflow with a dangling step reference is loaded **Then** `topologicalSort` still rejects it on load, preserving the enforcement `validate()` duplicated
- **Given** the shipped workflow YAML templates **When** each of `full.yaml`, `quick.yaml`, `standard.yaml`, and `trivial.yaml` is loaded through the engine **Then** every workflow parses, validates against the narrowed schema, and topo-sorts successfully
- **Given** the pruned `tests/workflow-engine.test.ts` **When** `npx vitest run` and `tsc` execute **Then** both pass green
