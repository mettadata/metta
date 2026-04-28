# Tasks for fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Batch 1 (no dependencies — independent files, runs in parallel)

- [ ] **Task 1.1: Add `stop_after` optional field to `ChangeMetadataSchema`**
  - **Files**: `src/schemas/change-metadata.ts`
  - **Action**: Add `stop_after: z.string().optional()` to `ChangeMetadataSchema` immediately after the existing `verify_iterations` field, preserving the `.strict()` chain at the end. No other changes to the file. Do not add validation against any workflow's `buildOrder` — that lives in the CLI command.
  - **Verify**: Run `npx tsc --noEmit` from the repo root and confirm zero new errors. Run `npx vitest run tests/schemas.test.ts` and confirm all existing cases still pass.
  - **Done**: `ChangeMetadataSchema` accepts records with `stop_after: 'tasks'`, accepts records without `stop_after`, and rejects `stop_after: 42`. The change does not introduce any other schema modifications.

- [ ] **Task 1.2: Add schema test cases for `stop_after`**
  - **Files**: `tests/schemas.test.ts`
  - **Action**: Add three new `it(...)` cases under the existing `ChangeMetadataSchema` describe block (or create one if absent):
    1. `'accepts stop_after as a string'` — parse `{ workflow: 'standard', created: <iso>, status: 'active', current_artifact: 'tasks', base_versions: {}, artifacts: { intent: 'complete' }, stop_after: 'tasks' }` and assert `result.stop_after === 'tasks'`.
    2. `'omits stop_after when absent'` — parse the same record without the field and assert `result.stop_after === undefined`.
    3. `'rejects non-string stop_after'` — call `ChangeMetadataSchema.safeParse({ ..., stop_after: 42 })` and assert `result.success === false`.
  - **Verify**: `npx vitest run tests/schemas.test.ts` passes including the three new cases.
  - **Done**: Three test cases added; all schema tests pass.

## Batch 2 (depends on Batch 1)

- [ ] **Task 2.1: Extend `ArtifactStore.createChange` to accept and persist `stopAfter`**
  - **Depends on**: Task 1.1
  - **Files**: `src/artifacts/artifact-store.ts`
  - **Action**: Add a final optional parameter `stopAfter?: string` to `createChange`. When the argument is supplied, set `metadata.stop_after = stopAfter` BEFORE the `state.write` call. When the argument is undefined, do NOT set the field on `metadata` (preserve current YAML output exactly). Do not modify `getChange`, `updateChange`, `markArtifact`, or any other method.
  - **Verify**: `npx tsc --noEmit` passes. `npx vitest run tests/artifact-store.test.ts` passes (existing cases unchanged). Visually inspect the diff: only `createChange` is modified; the new parameter is at the end of the parameter list to preserve positional compatibility.
  - **Done**: Calling `createChange('desc', 'standard', ['intent'], {}, false, false, 'intent')` writes a `.metta.yaml` containing `stop_after: intent`. Calling without the new argument writes a `.metta.yaml` with no `stop_after` field.

- [ ] **Task 2.2: Add `ArtifactStore.createChange` test cases for `stopAfter`**
  - **Depends on**: Task 1.1
  - **Files**: `tests/artifact-store.test.ts`
  - **Action**: Add two new `it(...)` cases under the existing `describe('createChange', ...)` block:
    1. `'persists stop_after when supplied'` — call `createChange(..., undefined, undefined, 'tasks')` (or whatever positional path is needed after Task 2.1's signature lands), then `getChange(name)` and assert the parsed record's `stop_after === 'tasks'`. Read the raw `.metta.yaml` from disk and assert it contains the string `stop_after: tasks`.
    2. `'omits stop_after when not supplied'` — call `createChange` without the new argument, then `getChange` and assert `stop_after === undefined`. Read the raw YAML and assert it does NOT contain the string `stop_after:`.
  - **Verify**: `npx vitest run tests/artifact-store.test.ts` passes including the two new cases.
  - **Done**: Two test cases added; all `artifact-store` tests pass.

## Batch 3 (depends on Batch 2)

- [ ] **Task 3.1: Add `--stop-after <artifact>` option to `metta propose` and validate against the workflow's `buildOrder`**
  - **Depends on**: Task 2.1
  - **Files**: `src/cli/commands/propose.ts`
  - **Action**: Add `.option('--stop-after <artifact>', 'Stop after the named planning artifact (intent, stories, spec, research, design, tasks)')` immediately after the existing `--auto` option. After `workflowEngine.loadWorkflow` returns the graph (line 33), and BEFORE the call to `artifactStore.createChange` (line 37):
    1. If `options.stopAfter !== undefined`, validate the value:
       - If `options.stopAfter === 'implementation' || options.stopAfter === 'verification'`, throw an Error with message ``--stop-after value '<value>' is an execution-phase artifact and is not a valid stop point. Valid values are: <comma-separated planning ids>.``
       - Else if `!graph.buildOrder.includes(options.stopAfter)`, throw an Error with message ``--stop-after value '<value>' is not a valid artifact id for workflow '<workflowName>'. Valid values are: <comma-separated planning ids>.``
    2. Compute the planning ids list as `graph.buildOrder.filter(id => id !== 'implementation' && id !== 'verification')` and embed it in both error messages.
    3. Pass `options.stopAfter` as the new last argument to `artifactStore.createChange`.
    4. Add `stop_after: options.stopAfter ?? null` to the JSON output object.
  - **Verify**: `npx tsc --noEmit` passes. Manual smoke test in a temp directory: `node dist/cli.js propose "test" --stop-after spex` exits 4 with the listed error and creates no change directory; `node dist/cli.js propose "test" --stop-after tasks --json` exits 0 with `"stop_after": "tasks"` in the output.
  - **Done**: The CLI accepts valid planning-phase ids, rejects unknown ids and execution-phase ids with code 4, persists the value to the change record's `.metta.yaml`, and surfaces it in `--json` output. No state is written when validation fails.

- [ ] **Task 3.2: Add end-to-end CLI test for `--stop-after`**
  - **Depends on**: Task 2.1
  - **Files**: `tests/cli-propose-stop-after.test.ts` (new file)
  - **Action**: Create a new vitest test file modeled on `tests/cli.test.ts`. Use a `mkdtemp` temp directory, copy or symlink `.metta` config minimally (or use the existing CLI helper that does this — check `tests/cli.test.ts` for the pattern), and run the propose command via `execFile` against `dist/cli.js`. Add cases:
    1. `'persists stop_after when --stop-after is a valid planning artifact id'` — run `metta propose "test desc" --stop-after tasks --json`; assert exit code 0, JSON output includes `stop_after: 'tasks'`, and the resulting `.metta.yaml` contains `stop_after: tasks`.
    2. `'rejects unknown --stop-after value with helpful error'` — run `metta propose "test desc" --stop-after spex --json`; assert exit code 4, error message cites `spex` and lists valid ids, and no change directory is created.
    3. `'rejects execution-phase --stop-after values'` — run `metta propose "test desc" --stop-after implementation --json`; assert exit code 4 and the error message specifically mentions execution-phase. No change directory is created.
    4. `'omits stop_after from JSON when flag is not supplied'` — run `metta propose "test desc" --json`; assert exit code 0 and the JSON's `stop_after` is either absent or null.
    5. `'composes with --workflow and --auto'` — run `metta propose "test desc" --workflow standard --stop-after spec --auto --json`; assert exit code 0, `stop_after === 'spec'`, `auto_accept_recommendation === true` on the change record.
  - **Verify**: `npm run build` to compile, then `npx vitest run tests/cli-propose-stop-after.test.ts` and confirm all 5 cases pass.
  - **Done**: New test file exists with all 5 cases passing; no flake on repeated runs (run twice locally).

## Batch 4 (depends on Batch 3)

- [ ] **Task 4.1: Update `.claude/skills/metta-propose/SKILL.md` Step 1 argument parsing and Step 3 boundary check**
  - **Depends on**: Task 3.1
  - **Files**: `.claude/skills/metta-propose/SKILL.md`, `src/templates/skills/metta-propose.md`
  - **Action**: In Step 1's argument-parsing block (which already handles `--workflow` and `--auto`), add a parallel parse for `--stop-after <value>`:
    - Detect the token `--stop-after` followed by a non-flag value; extract both and remove from `$ARGUMENTS`. Set `STOP_AFTER` to the value (or empty string if absent).
    - When `STOP_AFTER` is non-empty, append `--stop-after <value>` to the `metta propose` invocation; otherwise omit.
    - The remaining text is the description.
    Then add a new sub-step in Step 3 (per-artifact planning loop) immediately after `METTA_SKILL=1 metta complete <artifact> --json --change <name>`:
    - The orchestrator MUST read `STOP_AFTER` (already known from Step 1) AND/OR re-read the change record's `stop_after` field via `metta status --json --change <name>` for robustness.
    - When the just-completed artifact equals `STOP_AFTER`, the orchestrator MUST:
      a. Skip the rest of Step 3, all of Step 4 (research synthesis), all of Step 5 (implementation), all of Step 6 (review), all of Step 7 (verification), all of Step 8 (finalize/merge).
      b. Print exactly one handoff line of the form: ``Stopped after `<artifact>`. Run `<resume-command>` to <next-action>.``
      c. Return to the user.
    - Resume-command mapping (encode as a small lookup table inline in the skill):
      - `tasks` → `/metta-execute` ("begin implementation")
      - `intent`, `stories`, `spec`, `research`, `design` → `/metta-plan` ("continue planning")
    - Update the source-of-truth template at `src/templates/skills/metta-propose.md` to match the change in `.claude/skills/metta-propose/SKILL.md` exactly. The two files MUST be byte-identical for the propose skill section after this change. (Check for the existing `agents-byte-identity.test.ts` pattern; if a similar test exists for skills, update fixtures accordingly.)
  - **Verify**: Read the diff of both files side-by-side and confirm they are byte-identical for the propose section. Run `npx vitest run tests/skill-discovery-loop.test.ts tests/skill-iteration-record.test.ts tests/skill-structure-metta-init.test.ts` — none should regress. If a skill-byte-identity test exists, run it.
  - **Done**: Both skill files updated and identical; the orchestrator parses `--stop-after`, passes it through to the CLI, and exits cleanly with the deterministic handoff line when the boundary is reached.

- [ ] **Task 4.2: Add a regression test that `metta status --json` surfaces `stop_after`**
  - **Depends on**: Task 2.1
  - **Files**: `tests/cli.test.ts` (extension)
  - **Action**: Add a new `it(...)` case under whichever existing describe block covers `metta status` JSON output (or create a focused describe if none exists). Steps:
    1. Create a temp `specDir` and instantiate `ArtifactStore`.
    2. Call `createChange('test desc', 'standard', ['intent', 'spec', 'tasks', 'implementation', 'verification'], {}, false, false, 'tasks')`.
    3. Run the `metta status --json --change <name>` CLI command (via `execFile` against `dist/cli.js`) pointed at the temp dir.
    4. Parse the JSON output and assert `output.stop_after === 'tasks'`.
    5. As a negative case, do the same without `stopAfter` and assert the JSON's `stop_after` is `undefined` or `null`.
  - **Verify**: `npm run build && npx vitest run tests/cli.test.ts` passes including the new case.
  - **Done**: Regression test asserts that `stop_after` flows through to `metta status --json` and that absence is correctly represented.

## Batch 5 (depends on Batch 4 — final integration)

- [ ] **Task 5.1: Build, full-test sweep, lint, typecheck**
  - **Depends on**: Tasks 1.x, 2.x, 3.x, 4.x
  - **Files**: (no source edits — verification only)
  - **Action**: Run the full local CI sequence in order: `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npm test`. Fix any new warnings or errors that surface.
  - **Verify**: All four commands exit 0. Full vitest run reports 0 failed tests.
  - **Done**: Repository is in a green state; all gates would pass in `metta finalize`.
