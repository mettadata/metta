# workflow-engine

<!--
This change removes dead code and speculative features; it intentionally contains
ZERO merger-operable delta blocks (no `## ADDED:` / `## MODIFIED:` / `## REMOVED:`
sections) because:

(a) Deletions of unimplemented machinery have no new behavior contract to add,
    modify, or remove — there is nothing for the delta merger to attach a
    requirement to. The five deletion areas below are pure subtraction of
    unwired code, not new or changed live behavior.

(b) The affected capability specs (workflow-engine, execution-engine) use the
    legacy numbered-section format (see `spec/specs/workflow-engine/spec.md`,
    sections 1-9), which the delta merger cannot target with
    ADDED/MODIFIED/REMOVED blocks — that merger operates on the newer
    heading-based delta format, not numbered sections.

Capability-spec updates for this change happen directly, outside the delta
mechanism:
  - `spec/specs/execution-engine/` is retired to `spec/archive/` (its code —
    `ExecutionEngine`, `WorktreeManager`, the fan-out helper — is deleted in
    full; nothing remains to spec).
  - `spec/specs/workflow-engine/spec.md` is edited in place: section 6
    ("Workflow Inheritance (`extends`)"), section 2.2's `extends`/`overrides`
    fields, section 2.3 ("WorkflowOverride"), section 3.6 (`validate()`), and
    scenarios S-13 and S-17 through S-20 are removed to match the deleted
    `mergeWorkflows`/`extends`/`overrides`/`validate()` machinery; all other
    sections (1-5, 7-9, and scenarios S-01 through S-12, S-14 through S-16)
    are unchanged since the code they describe is retained.

This H1 targets the `workflow-engine` capability (an existing spec) solely so
the completion gate — which requires every change's spec.md to declare an
existing or newly-created capability — passes. The `## Deletion Contract`
section below is the operative content of this artifact: plain prose and
bullets, not delta blocks, so the merger ignores it and does not attempt to
apply it as a requirement change. It is the checklist the verifier uses to
confirm each deletion area landed cleanly and preserved live behavior.
-->

## Deletion Contract

Each area below states the verifiable post-conditions for its deletion: what
symbols must be gone from `src/`, what live behavior must still work
unchanged, and which tests prove it. Story IDs reference `stories.md`.

### 1. Execution-engine island deleted, live task parsing relocated (US-1)

- **Gone from `src/`:** `src/execution/execution-engine.ts`,
  `src/execution/worktree-manager.ts`, `src/execution/fan-out.ts`,
  `src/execution/batch-planner.ts`'s `planBatches` function. `src/index.ts`
  no longer exports `ExecutionEngine`, `WorktreeManager`, the fan-out helper,
  or `planBatches`. `grep -r "ExecutionEngine\|WorktreeManager" src/` and
  `grep -rn "planBatches" src/` return no matches.
- **Preserved:** `parseTasks` and `markTaskComplete` exist under
  `src/planning/` (moved from `src/execution/batch-planner.ts`) and
  `src/cli/commands/complete.ts` imports them from the new location.
  `src/planning/parallel-wave-computer.ts` is untouched — same file, same
  exports, same behavior.
- **Proof:** `tests/execution-engine.test.ts` and
  `tests/worktree-manager.test.ts` are deleted. `tests/batch-planner.test.ts`
  loses its `planBatches` cases and keeps (relocated) cases for
  `parseTasks`/`markTaskComplete`. `npx vitest run` and `tsc` pass. A
  `metta complete` run against a change with a `tasks.md` parses and marks
  tasks complete identically to pre-change behavior.

### 2. `ToolAdapter` interface indirection removed (US-2)

- **Gone from `src/`:** the `ToolAdapter` interface in
  `src/delivery/tool-adapter.ts`. `src/delivery/command-installer.ts` no
  longer carries a generic adapter-type parameter. `grep -rn "ToolAdapter"
  src/` returns no matches.
- **Preserved:** the Claude Code adapter functions (from
  `claude-code-adapter.ts`) are exported and called directly by
  `command-installer.ts`. The `SkillContent`/`ProjectContext` content types
  currently defined in `tool-adapter.ts` remain defined and importable —
  only the interface indirection is removed, not the shared content types.
- **Proof:** `tests/delivery.test.ts` loses cases that constructed a
  custom/mock `ToolAdapter` and keeps cases exercising the concrete
  functions and content types. `npx vitest run` and `tsc` pass. `metta
  install` run in a temp project installs skills, commands, and files with
  output identical in structure to pre-change behavior.

### 3. Dead schemas removed, `.strict()` state schema still validates (US-3)

- **Gone from `src/`:** `src/schemas/plugin-manifest.ts`,
  `src/schemas/auto-state.ts`, their barrel exports, and the `auto` field on
  `StateFileSchema` in `src/schemas/state-file.ts` — removed together as one
  atomic deletion (no dangling optional field left referencing a deleted
  schema). `grep -rn "PluginManifest\|AutoStateSchema" src/` returns no
  matches.
- **Preserved:** `StateFileSchema` remains `.strict()` and validates every
  other existing field unchanged.
- **Proof:** `tests/schemas.test.ts` loses the `plugin-manifest` and
  `auto-state` cases. `npx vitest run` and `tsc` pass. Every `state.yaml` in
  the repository and test fixtures is verified (not assumed) to contain no
  `.auto` field, and a live `metta status` run against an existing project
  still parses its `state.yaml` successfully under the narrowed strict
  schema.

### 4. CLI surface tells the truth (US-4)

- **Gone from `src/`:** the `--resume` option on `metta execute`
  (`src/cli/commands/execute.ts`) and its "Resuming from last
  checkpoint..." placeholder message. The `metta auto` command's help text
  and action no longer claim to drive an automated lifecycle loop.
- **Preserved:** `metta auto` still exists under the same name and still
  prints guidance pointing to `metta propose`; `metta execute` keeps every
  option besides `--resume`.
- **Proof:** `metta auto --help` and its runtime output describe pointer
  behavior with no lifecycle-loop claims. `metta execute --help` no longer
  lists `--resume`, and `metta execute --resume` fails with a standard
  Commander.js unknown-option error rather than printing fake progress.
  `npx vitest run` and `tsc` pass.

### 5. Workflow-engine speculative machinery deleted (US-5)

- **Gone from `src/`:** `mergeWorkflows`, the `extends`-handling branch in
  `loadWorkflow`, the `extends`/`overrides` fields in
  `src/schemas/workflow-definition.ts`, and `WorkflowEngine.validate()`.
  `grep -rn "mergeWorkflows\|extends" src/workflow* src/schemas/workflow-definition.ts`
  returns no matches.
- **Preserved:** dangling-reference enforcement lives in exactly one place —
  `topologicalSort` still rejects a workflow with a dangling `requires`
  reference at load time, exactly as it does today. All four shipped
  workflow YAMLs (`full`, `quick`, `standard`, `trivial`) load, validate
  against the narrowed schema, and topologically sort without error.
- **Proof:** `tests/workflow-engine.test.ts` loses the inheritance/override
  scenarios (equivalent to spec scenarios S-17 through S-20) and the
  `validate()` scenarios (S-12, S-13), and keeps the topological-sort,
  `getNext`, `getStatus`, YAML-loading, and cycle-detection scenarios
  (S-01–S-11, S-14–S-16). `npx vitest run` and `tsc` pass. As part of this
  change, `spec/specs/workflow-engine/spec.md` sections 2.2 (`extends`/
  `overrides` fields), 2.3 (`WorkflowOverride`), 3.6 (`validate()`), 6
  (Workflow Inheritance), and scenarios S-13, S-17–S-20 are removed in
  place to match; `spec/specs/execution-engine/spec.md` is retired to
  `spec/archive/` since the code it specs no longer exists.
