# Tasks: delete-dead-code-identified-2026-07-framework-review-v0-2

<!--
Story -> Task mapping:
US-1 (execution-engine island deleted, task parsing relocated) -> 1.1
US-2 (ToolAdapter interface removed)                            -> 2.1
US-3 (dead schemas removed, .strict() state schema still valid) -> 3.1
US-4 (CLI surface tells the truth)                               -> 3.2
US-5 (workflow-engine speculative machinery deleted)             -> 4.1, 4.2
Full-sweep verification (all stories)                             -> 5.1
-->

## Batch 1: US-1 — execution-engine island deleted, live task parsing relocated

### 1.1 Split batch-planner, delete execution/ island, retire execution-engine spec

- **Files:**
  - Delete: `src/execution/execution-engine.ts`, `src/execution/worktree-manager.ts`, `src/execution/fan-out.ts`, `src/execution/batch-planner.ts`
  - Create: `src/planning/batch-planner.ts` (new file — `parseTasks`, `markTaskComplete`, `TaskDefinition` moved verbatim from the deleted `src/execution/batch-planner.ts`; `planBatches`, `BatchPlan`, `detectOverlaps`, `OverlapReport`, `getCompletedTasks` do NOT travel — they are deleted with the old file, out of scope per `research.md`)
  - Edit: `src/planning/index.ts` (add `export * from './batch-planner.js'`)
  - Edit: `src/cli/commands/complete.ts` (change import from `'../../execution/batch-planner.js'` to `'../../planning/index.js'`, importing `parseTasks`/`markTaskComplete` from there)
  - Edit: `src/index.ts` (remove lines exporting `./execution/batch-planner.js`, `./execution/execution-engine.js`, `./execution/worktree-manager.js`, `./execution/fan-out.js`)
  - Delete: `tests/execution-engine.test.ts`, `tests/worktree-manager.test.ts`
  - Edit: `tests/batch-planner.test.ts` — remove the `describe('planBatches', ...)` block; keep `describe('parseTasks', ...)` and `markTaskComplete` cases, update their import path to `../src/planning/batch-planner.js` (or `../src/planning/index.js`)
  - Move: `git mv spec/specs/execution-engine spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement`
  - Create: `spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement/README.md` (one paragraph stating the retirement reason — code deleted in this change — and linking this change's slug)
- **Action:** Immediately before deleting, re-run `grep -rn "ExecutionEngine\|WorktreeManager" src/ tests/` and `grep -rn "planBatches" src/ tests/` to re-verify zero non-test importers beyond what `research.md` already found (tree may have drifted since research ran). Then delete the four `src/execution/` files and their two dedicated test files. Create `src/planning/batch-planner.ts` by relocating `TaskDefinition`, `parseTasks`, and `markTaskComplete` verbatim (same signatures, same behavior — no refactor). Update `src/planning/index.ts`'s barrel, `src/cli/commands/complete.ts`'s import, and `src/index.ts`'s barrel per the design's exact line removals. Trim `tests/batch-planner.test.ts` to drop the `planBatches` describe block and repoint its remaining import. Retire the execution-engine spec folder via `git mv` to the new dated archive folder (not the existing `2026-07-16-spec-store-reset/` bundle — different rationale, per `design.md`) and author its one-paragraph README.
- **Verify:**
  - `grep -r "ExecutionEngine\|WorktreeManager" src/` — expect no output
  - `grep -rn "planBatches" src/` — expect no output
  - `test -f src/planning/batch-planner.ts && test ! -e src/execution` — expect success
  - `test -d spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement && test ! -e spec/specs/execution-engine` — expect success
  - `npx vitest run`
  - `npx tsc --noEmit`
- **Done:** `src/execution/` no longer exists; `parseTasks`/`markTaskComplete`/`TaskDefinition` live in `src/planning/batch-planner.ts` and are reachable via `src/planning/index.ts`; `src/cli/commands/complete.ts` imports from the new location; `src/index.ts` no longer barrels the deleted execution files; `spec/specs/execution-engine/` is retired to `spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement/` with its README; `npx vitest run` and `npx tsc --noEmit` pass.

---

## Batch 2: US-2 — ToolAdapter interface indirection removed

### 2.1 Remove ToolAdapter interface, de-genericize command-installer

- **Files:**
  - Edit: `src/delivery/tool-adapter.ts` (delete the `ToolAdapter` interface only; keep `SkillContent`, `CommandContent`, `ProjectContext`, `QuestionCapability` unmodified)
  - Edit: `src/delivery/claude-code-adapter.ts` (export its functions directly rather than as an object conforming to `ToolAdapter`)
  - Edit: `src/delivery/command-installer.ts` (drop the generic adapter-type parameter; call the Claude Code adapter functions directly by name instead of through an injected adapter object)
  - Edit: `tests/delivery.test.ts` (re-read in full first; remove any case constructing a custom/mock `ToolAdapter` object if present — research found the file's current imports already pull only the two content types, so this may require no case removal, only confirmation)
- **Action:** Re-run `grep -rn "ToolAdapter" src/` to re-verify zero non-test importers beyond `claude-code-adapter.ts` and `command-installer.ts` (the two named in research). Delete the `ToolAdapter` interface from `tool-adapter.ts`, leaving the four content/capability types intact and exported. Update `claude-code-adapter.ts` to export `formatSkill`/`formatCommand`/`formatContext`/`questionCapability` (and any other adapter functions) as standalone exports. Update `command-installer.ts` to import and call those functions directly, removing the generic `<T extends ToolAdapter>`-style parameter and any adapter-injection plumbing. Re-read `tests/delivery.test.ts` in full and trim only if it constructs a mock adapter object; otherwise leave it unchanged as confirmed by research.
- **Verify:**
  - `grep -rn "ToolAdapter" src/` — expect no output
  - `npx vitest run`
  - `npx tsc --noEmit`
- **Done:** `ToolAdapter` interface no longer exists anywhere in `src/`; `SkillContent`, `CommandContent`, `ProjectContext`, `QuestionCapability` remain defined and exported from `tool-adapter.ts`; `command-installer.ts` calls the Claude Code adapter functions directly with no generic adapter-type parameter; `npx vitest run` and `npx tsc --noEmit` pass.

---

## Batch 3: US-3 + US-4 — dead schemas removed, CLI surface tells the truth

### 3.1 Delete dead schemas and StateFileSchema.auto field

- **Files:**
  - Delete: `src/schemas/plugin-manifest.ts`, `src/schemas/auto-state.ts`
  - Edit: `src/schemas/state-file.ts` (remove `auto: AutoStateSchema.optional()` field and its `AutoStateSchema` import; schema stays `.strict()`)
  - Edit: `src/schemas/index.ts` (remove `export * from './auto-state.js'` and `export * from './plugin-manifest.js'`)
  - Edit: `tests/schemas.test.ts` (remove the `PluginManifestSchema` describe block and the `AutoStateSchema` describe block, plus their top-of-file imports)
- **Action:** Before deleting, re-run the repo-wide fixture check from `research.md`: `find . -not -path "*/node_modules/*" -not -path "*/.git/*" -iname "state.yaml"` and also check `tests/fixtures/` for any `state.yaml`-shaped fixture carrying an `auto` key — confirm the result is still empty (mandatory pre-deletion re-verification per `design.md`'s Risk (b), since research explicitly does not guarantee the tree is unchanged). Also re-run `grep -rn "PluginManifest\|AutoStateSchema" src/` to reconfirm zero non-test importers. Then delete `plugin-manifest.ts` and `auto-state.ts` as one atomic deletion together with the `auto` field removal from `state-file.ts` (no commit should leave a dangling reference), update the schema barrel, and trim `tests/schemas.test.ts`.
- **Verify:**
  - `find . -not -path "*/node_modules/*" -not -path "*/.git/*" -iname "state.yaml"` — record result before deleting; must be empty (or every match confirmed to lack an `.auto` key) before proceeding
  - `grep -rn "PluginManifest\|AutoStateSchema" src/` — expect no output
  - `npx vitest run`
  - `npx tsc --noEmit`
- **Done:** `src/schemas/plugin-manifest.ts` and `src/schemas/auto-state.ts` no longer exist; `StateFileSchema` has no `auto` field and remains `.strict()`; the schema barrel no longer exports either deleted module; `npx vitest run` and `npx tsc --noEmit` pass.

### 3.2 CLI surface tells the truth — remove --resume, rewrite metta auto

- **Files:**
  - Edit: `src/cli/commands/execute.ts` (remove `--resume` option, its `resume` field in JSON output, and the `"Resuming from last checkpoint..."` console line)
  - Edit: `src/cli/commands/auto.ts` (remove `--resume` and `--from <phase>` options; rewrite help description and action-body output per `design.md`'s API Design section, verbatim)
  - Edit: any existing CLI tests referencing `metta execute --resume` or `metta auto --resume`/`--from` output, if found during a fresh `grep -rn "resume\|--from" tests/cli-*.test.ts`
- **Action:** In `execute.ts`, delete the `--resume` Commander option, the `resume: options.resume ?? false` field from the JSON output object, and the conditional `console.log('  Resuming from last checkpoint...')` line; leave `--change <name>` and all other options untouched. In `auto.ts`, delete the `--resume` and `--from <phase>` options entirely and rewrite the command description and non-JSON action output to match `design.md`'s API Design block verbatim: usage text states the command prints guidance for `metta propose` and does not run an automated propose→plan→execute→verify→ship loop, points to the individual lifecycle skills or `/metta-auto` for the full loop, and the `--workflow <name>` / `--max-cycles <n>` options retain their existing descriptions (`--max-cycles` documented as unused by this command, retained for output compatibility). Remove any "Phase 0: Discovery" / "Resuming auto mode..." strings from the action body. Re-run `grep -n "options.from\|options.resume" src/cli/commands/auto.ts` and `grep -n "options.resume" src/cli/commands/execute.ts` to confirm no dangling references remain. Search `tests/` for any test asserting on the removed options or old help text and update accordingly.
- **Verify:**
  - `npx tsx src/cli/index.ts execute --help 2>&1 | grep -q -- '--resume' && echo FAIL || echo OK` (or equivalent built-CLI invocation matching this repo's build/run convention — expect OK, i.e. no `--resume` in output)
  - `npx tsx src/cli/index.ts auto --help 2>&1 | grep -qi 'automated.*loop\|Phase 0' && echo FAIL || echo OK` (expect OK, i.e. no lifecycle-loop claim in output)
  - `grep -n "options.resume" src/cli/commands/execute.ts` — expect no output
  - `grep -n "options.from\|options.resume" src/cli/commands/auto.ts` — expect no output
  - `npx vitest run`
  - `npx tsc --noEmit`
- **Done:** `metta execute --help` no longer lists `--resume` and `metta execute --resume` fails with Commander's standard unknown-option error; `metta auto --help` and its runtime output describe pointer-to-`metta propose` behavior with no lifecycle-loop or resume claims, matching `design.md`'s API Design text; `npx vitest run` and `npx tsc --noEmit` pass.

---

## Batch 4: US-5 — workflow-engine speculative machinery deleted

### 4.1 Delete mergeWorkflows/extends/overrides/validate() from workflow engine

- **Files:**
  - Edit: `src/workflow/workflow-engine.ts` (delete `mergeWorkflows`, the `extends`-handling branch in `loadWorkflow`, and `WorkflowEngine.validate()`)
  - Edit: `src/schemas/workflow-definition.ts` (remove `extends`/`overrides` fields from `WorkflowDefinitionSchema`)
  - Edit: `tests/workflow-engine.test.ts` (remove the `validate()` scenarios and the `extends`/`overrides` inheritance scenarios — equivalent to spec scenarios S-12/S-13 and S-17–S-20; keep topological-sort, `getNext`, `getStatus`, YAML-loading, and cycle-detection cases — S-01–S-11, S-14–S-16)
- **Action:** Re-run `grep -rn "extends\|overrides" src/templates/workflows/*.yaml` and `grep -rn "\.validate(" tests/` to reconfirm zero shipped-workflow usage and zero `src/` callers of `validate()`, per research. Delete `mergeWorkflows`, the `extends`-handling branch inside `loadWorkflow`, and the `validate()` method from `WorkflowEngine`, leaving `topologicalSort`'s dangling-reference rejection as the sole enforcement point. Remove the `extends`/`overrides` fields from `WorkflowDefinitionSchema`. Trim `tests/workflow-engine.test.ts` to drop the now-invalid scenarios while keeping every scenario for behavior that still exists.
- **Verify:**
  - `grep -rn "mergeWorkflows\|extends" src/workflow* src/schemas/workflow-definition.ts` — expect no output
  - `npx vitest run`
  - `npx tsc --noEmit`
  - For each of `src/templates/workflows/full.yaml`, `quick.yaml`, `standard.yaml`, `trivial.yaml`: confirm it loads, validates, and topologically sorts without error (exercised via the relevant `tests/workflow-engine.test.ts` YAML-loading cases already run above)
- **Done:** `mergeWorkflows`, the `extends`-handling branch, `WorkflowEngine.validate()`, and the `extends`/`overrides` schema fields no longer exist anywhere in `src/`; dangling-reference enforcement lives solely in `topologicalSort`; all four shipped workflow YAMLs still load and topo-sort successfully; `npx vitest run` and `npx tsc --noEmit` pass.

### 4.2 Edit workflow-engine spec.md in place and hand-authored docs

- **Files:**
  - Edit: `spec/specs/workflow-engine/spec.md` (remove section 2.2's `extends`/`overrides` fields, section 2.3 `WorkflowOverride`, section 3.6 `validate()`, section 6 Workflow Inheritance, and scenarios S-13, S-17–S-20; leave sections 1, 2 minus 2.2/2.3, 4, 5, 7–9 and scenarios S-01–S-12 minus S-13, S-14–S-16 unchanged)
  - Edit: `docs/workflows/workflows.md` (remove or correct the `extends`/`overrides` authoring guidance, including the field-reference entries)
  - Edit: `docs/internals/extending.md` (remove or correct the `extends`/`overrides[]` schema description)
  - Edit: `docs/internals/data-model.md` (remove the `extends` field table entry)
  - Edit: `docs/internals/architecture.md` (correct the line describing `loadWorkflow` as resolving `extends`)
- **Action:** Edit `spec/specs/workflow-engine/spec.md` directly (not via delta merge, per `spec.md`'s H1 note) to remove exactly the sections and scenarios named in the design manifest, leaving every other section and scenario byte-identical. Then update the four hand-authored docs pages identified in research/design as describing `extends`/`overrides` as a user-facing authoring feature — remove the feature description and field references entirely (do not leave a "removed feature" stub unless that reads naturally in context); these four pages are not covered by `DocGenerator` regeneration, so they require this manual edit now, not at finalize.
- **Verify:**
  - `grep -n "extends\|overrides\|WorkflowOverride\|validate()" spec/specs/workflow-engine/spec.md` — manually confirm any remaining hits are unrelated prose, not the removed sections/scenarios (e.g. no "## 6. Workflow Inheritance" heading, no "### 2.3 WorkflowOverride" heading, no "### 3.6" `validate()` heading, no S-13/S-17/S-18/S-19/S-20 scenario IDs)
  - `grep -rn "extends\|overrides" docs/workflows/workflows.md docs/internals/extending.md docs/internals/data-model.md docs/internals/architecture.md` — manually confirm no remaining references describe `extends`/`overrides` as a working feature
  - `npx vitest run`
- **Done:** `spec/specs/workflow-engine/spec.md` no longer documents `extends`/`overrides`/`WorkflowOverride`/`validate()`/the removed scenarios while every other section is unchanged; `docs/workflows/workflows.md`, `docs/internals/extending.md`, `docs/internals/data-model.md`, and `docs/internals/architecture.md` no longer describe `extends`/`overrides` as a live authoring capability; `npx vitest run` passes.

---

## Batch 5: Full sweep verification

### 5.1 Full suite, build, and line-count delta report

- **Files:** None (verification only; no source edits)
- **Action:** Run the complete verification suite across the whole tree to confirm all five deletion areas landed cleanly together with no cross-batch regression, then produce a line-count delta report comparing the current tree against the branch base commit.
- **Verify:**
  - `npx vitest run`
  - `npx tsc --noEmit`
  - `npm run build` (or this repo's equivalent build command, if `build` differs — confirm via `package.json` `scripts` before running)
  - `git diff --stat $(git merge-base HEAD main)..HEAD` — capture and report the line-count delta (files changed, insertions, deletions) as evidence of the deletion's scope
- **Done:** `npx vitest run`, `npx tsc --noEmit`, and the build all pass on the fully-merged batch set; the `git diff --stat` line-count delta report is captured and shows a net reduction in lines consistent with the five-item deletion manifest.
