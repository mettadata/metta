# Design: fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Approach

Add a single CLI option `--stop-after <artifact>` to `metta propose`, persist its value as an optional `stop_after` field on the change record's `.metta.yaml` (validated through `ChangeMetadataSchema`), and teach the `/metta-propose` skill orchestrator to inspect that field after every `metta complete <artifact>` call. When the just-completed artifact equals the persisted `stop_after`, the orchestrator skips the implementation, review, verification, and finalize/merge phases and prints a deterministic handoff line naming the resume command.

The change is intentionally minimal:
- One new option on one CLI command.
- One optional field on one schema.
- One optional argument on `ArtifactStore.createChange`.
- Two short edits to the propose skill (argument parse in Step 1; post-`metta complete` boundary check in Step 3).
- New tests at the schema, store, CLI, and integration levels.

No new modules, no new exports, no architectural surface added. Behavior with the flag absent is bit-for-bit identical to today's behavior.

## Components

### 1. `src/cli/commands/propose.ts` — CLI option + validation

- Add `.option('--stop-after <artifact>', 'Stop after the named planning artifact (e.g. spec, design, tasks)')` immediately after the existing `--auto` line.
- After `workflowEngine.loadWorkflow` returns the graph, but BEFORE `artifactStore.createChange` is called:
  - Read `options.stopAfter` (commander.js camelCases the flag).
  - If undefined → no validation, pass through.
  - If defined → validate against `graph.buildOrder`:
    - If `stopAfter` is not a member of `graph.buildOrder`, throw a clear error listing the valid values (excluding execution-phase ids).
    - If `stopAfter === 'implementation'` or `stopAfter === 'verification'`, throw a clear error explaining execution-phase ids are not valid stop points.
    - Otherwise pass through to `createChange`.
- Add `stop_after` to the `--json` output object when `stopAfter` is defined.

Validation must happen BEFORE `createChange` is called so a rejected flag does not leave a half-initialized change directory or a dangling git branch.

### 2. `src/schemas/change-metadata.ts` — optional schema field

- Extend `ChangeMetadataSchema` with `stop_after: z.string().optional()` placed alongside the other optional fields (`workflow_locked`, `auto_accept_recommendation`, etc.). The schema does NOT validate membership in any workflow's `buildOrder` — that is the CLI command's responsibility, where the workflow graph is in scope.

### 3. `src/artifacts/artifact-store.ts` — propagate `stopAfter` to the change record

- Extend `ArtifactStore.createChange` signature with a final optional argument `stopAfter?: string`.
- When `stopAfter !== undefined`, set `metadata.stop_after = stopAfter` before the `state.write` call so the schema-validated write captures it.
- When `stopAfter === undefined`, do NOT set the field on the metadata object — preserves the current YAML output exactly.

Existing call sites (`src/cli/commands/propose.ts`, `src/cli/commands/quick.ts`, any other callers) keep working because the new argument is optional and at the end of the parameter list.

### 4. `.claude/skills/metta-propose/SKILL.md` — argument parse + boundary check

Two edits:

#### Edit A — Step 1 argument parsing

In the `--workflow` and `--auto` parse-and-strip block, add a parallel parse for `--stop-after <value>`:
- If `$ARGUMENTS` contains `--stop-after` followed by a value, extract both tokens and remove them from `$ARGUMENTS`.
- The remaining text is the description.
- When the flag is present, append `--stop-after <value>` to the `metta propose` invocation.

#### Edit B — Step 3 post-`metta complete` boundary check

After every `METTA_SKILL=1 metta complete <artifact> --json --change <name>` call in the per-artifact planning loop, the orchestrator inspects the JSON response and the change record:
- If the JSON response's `next_command` would advance to a non-planning artifact (i.e. the next stage has type `execution` or `verification`), AND the change record's `stop_after` equals the just-completed artifact, OR
- More simply: if `stop_after` equals the artifact id just passed to `metta complete`, the boundary has been reached.

When the boundary is reached, the orchestrator:
1. Does NOT spawn implementation, review, or verification subagents.
2. Does NOT call `metta finalize` or `git merge`.
3. Prints exactly one handoff line of the form: ``Stopped after `<artifact>`. Run `<resume-command>` to <next-action>.``
4. Returns to the user.

Resume-command mapping:
- `stop_after = tasks` → `/metta-execute` (next action: "begin implementation")
- `stop_after ∈ {intent, stories, spec, research, design}` → `/metta-plan` (next action: "continue planning") with `/metta-status` mentioned as an inspection alternative

### 5. `src/cli/commands/status.ts` — surface `stop_after` in JSON

`toChangeJson` already spreads `...metadata`, so `stop_after` is present in JSON automatically once the schema gains the field. Verify the behavior with a regression test; no code change is strictly needed in `status.ts`, but the test must assert that `metta status --json` returns `stop_after` when the change record carries it.

### 6. Tests

- `tests/schemas.test.ts` — three new cases:
  1. `ChangeMetadataSchema.parse(...)` accepts a record with `stop_after: 'tasks'`.
  2. `ChangeMetadataSchema.parse(...)` accepts a record with no `stop_after` field (result.stop_after is undefined).
  3. `ChangeMetadataSchema.parse(...)` rejects a record with `stop_after: 42` (non-string).
- `tests/artifact-store.test.ts` — two new cases:
  1. `createChange(..., 'tasks')` writes `stop_after: tasks` to `.metta.yaml`.
  2. `createChange(...)` with no `stopAfter` argument omits the field from `.metta.yaml`.
- `tests/cli-propose-stop-after.test.ts` (new file) — end-to-end CLI tests:
  1. `metta propose "<desc>" --stop-after tasks --json` exits 0 and JSON contains `"stop_after": "tasks"`.
  2. `metta propose "<desc>" --stop-after spex --json` exits 4 with an error citing the unknown id.
  3. `metta propose "<desc>" --stop-after implementation --json` exits 4 with an error explaining execution-phase ids are forbidden.
  4. `metta propose "<desc>" --stop-after spec --workflow standard --auto --json` exits 0, persists `stop_after: spec` AND `auto_accept_recommendation: true`.
- `tests/cli.test.ts` (extension) — add a status-side regression: after creating a change with `stop_after` populated, `metta status --json` returns it.

## Data Model

### `ChangeMetadataSchema` (extended)

```ts
export const ChangeMetadataSchema = z.object({
  workflow: z.string(),
  created: z.string().datetime(),
  status: ChangeStatusSchema,
  current_artifact: z.string(),
  base_versions: z.record(z.string(), z.string()),
  artifacts: z.record(z.string(), ArtifactStatusSchema),
  complexity_score: ComplexityScoreSchema.optional(),
  actual_complexity_score: ComplexityScoreSchema.optional(),
  auto_accept_recommendation: z.boolean().optional(),
  workflow_locked: z.boolean().optional(),
  artifact_timings: z.record(z.string(), ArtifactTimingSchema).optional(),
  artifact_tokens: z.record(z.string(), ArtifactTokensSchema).optional(),
  review_iterations: z.number().int().nonnegative().optional(),
  verify_iterations: z.number().int().nonnegative().optional(),
  stop_after: z.string().optional(),    // <-- new
}).strict()
```

### `.metta.yaml` example with `stop_after`

```yaml
workflow: standard
created: 2026-04-28T12:30:00.386Z
status: active
current_artifact: tasks
base_versions: {}
stop_after: tasks                     # <-- new
artifacts:
  intent: complete
  stories: complete
  spec: complete
  research: complete
  design: complete
  tasks: complete
  implementation: pending
  verification: pending
```

### `ArtifactStore.createChange` signature (extended)

```ts
async createChange(
  description: string,
  workflow: string,
  artifactIds: string[],
  baseVersions: Record<string, string> = {},
  autoAccept?: boolean,
  workflowLocked?: boolean,
  stopAfter?: string,              // <-- new
): Promise<{ name: string; path: string }>
```

## API Design

### CLI

```
metta propose <description> [options]

Options:
  --workflow <name>          Workflow to use (default: "standard")
  --from-gap <gap>           Create from a gap
  --from-idea <idea>         Create from an idea
  --from-issue <issue>       Create from an issue
  --discovery <mode>         Discovery mode (default: "interactive")
  --auto                     Auto-accept adaptive routing recommendations
  --stop-after <artifact>    Stop after the named planning artifact      (NEW)
                             (e.g. intent, stories, spec, research, design, tasks)
                             Execution-phase ids (implementation, verification)
                             are not valid.
```

### Skill argument

```
/metta-propose <description> [--workflow <name>] [--auto] [--stop-after <artifact>]
```

### `metta status --json` output (extended)

```json
{
  "change": "fix-metta-propose-has-no-flag-stop-after-planning-artifacts",
  "workflow": "standard",
  "status": "active",
  "current_artifact": "tasks",
  "stop_after": "tasks",
  "...": "..."
}
```

### Handoff line format

```
Stopped after `<artifact>`. Run `<resume-command>` to <next-action>.
```

Concrete cases:
- `Stopped after `tasks`. Run `/metta-execute` to begin implementation.`
- `Stopped after `spec`. Run `/metta-plan` to continue planning.`
- `Stopped after `intent`. Run `/metta-plan` to continue planning.`

## Dependencies

### Internal

- `src/schemas/change-metadata.ts` — schema extension; consumed by `ArtifactStore`, `metta status`, and any future tool that reads change records.
- `src/artifacts/artifact-store.ts` — extended signature of `createChange`. Existing callers continue to work because the new argument is optional and trailing.
- `src/cli/commands/propose.ts` — adds the option, validation, and pass-through.
- `src/workflow/` (`WorkflowEngine.loadWorkflow`) — already returns `graph.buildOrder`; no change needed.
- `.claude/skills/metta-propose/SKILL.md` — argument-parse and post-`metta complete` boundary edits. Source of truth for the skill is also at `src/templates/skills/metta-propose.md` (template); both must be updated to match.

### External

None. No new dependencies added. No version bumps required.

## Risks & Mitigations

### Risk 1 — Schema cannot validate `stop_after` against any workflow's `buildOrder`

The schema accepts `stop_after: 'bogus-id'` because workflow files are external and not in scope at schema-parse time. A future tool or test fixture could write a bogus value directly to `.metta.yaml`.

**Mitigation:** The CLI command performs the validation before any write. The skill orchestrator can additionally sanity-check membership when reading the value (warn but do not fail — keeps the orchestrator robust to drift). This matches the existing pattern for `workflow: z.string()`, which also is not validated against the available workflow list at schema time.

### Risk 2 — Skill must read the change record after each `metta complete` call

That's an extra YAML read per planning artifact (5–6 per change for the standard workflow). Negligible cost on local disk; the orchestrator already reads change state for status updates.

**Mitigation:** Cache the `stop_after` value in the orchestrator's local context after it is read once at the start of Step 3. Subsequent boundary checks are O(1) string comparisons.

### Risk 3 — `--stop-after` interaction with `--from-issue`, `--from-gap`, `--from-idea`

These flags create the change with extra context attached. The new `stop_after` value must persist alongside that context.

**Mitigation:** The `--stop-after` validation runs in the same code path as the existing flags' handling; nothing about `createChange` cares why the change was created. Add an explicit end-to-end test (`tests/cli-propose-stop-after.test.ts` case 4) that combines `--from-issue` with `--stop-after tasks` to lock in the composition.

### Risk 4 — Skill handoff line drifts and tests can no longer match

If the skill's handoff line is rewritten in a future change, integration tests asserting the exact substring would break.

**Mitigation:** Define the format in spec.md as a normative requirement (already done in the spec — the "Handoff message MUST be deterministic and matchable" requirement). Future edits to the format must update the spec and tests in lock-step.

### Risk 5 — Demo projects reference the propose skill but do not need stop-after

The demo `.claude/agents/metta-proposer.md` files in `demos/todo` and `demos/trello-clone` mirror the production skill but may diverge.

**Mitigation:** This change does not modify the agent-template files, only the skill orchestrator's SKILL.md. The agents are unaffected because they execute the work; the orchestrator decides when to stop. No demo updates required.

### Risk 6 — `metta quick` and `metta auto` do not gain `--stop-after`

Out of scope for this change (called out explicitly in `intent.md`). A future user might assume `--stop-after` works on `metta quick` because both share a CLI command pattern.

**Mitigation:** `metta quick` does not run a multi-artifact planning loop, so a stop-after boundary has no meaning there. If someone passes `--stop-after` to `metta quick` (which has no such option), commander.js rejects it as an unknown flag. Acceptable — the error is loud.
