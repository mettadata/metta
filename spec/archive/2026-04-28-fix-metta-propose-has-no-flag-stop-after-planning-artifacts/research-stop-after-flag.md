# Research: `--stop-after <artifact>` flag (Option 1)

## Approach

Add a single CLI option `--stop-after <artifact>` to `metta propose` that names a planning-phase artifact id from the resolved workflow's `buildOrder`. The CLI validates the value, persists it on the change record (`stop_after: <id>` in `.metta.yaml`), and the `/metta-propose` skill orchestrator inspects the value after each `metta complete <artifact>` call. When the just-completed artifact equals the persisted `stop_after`, the orchestrator skips Steps 5–8 (implementation, review, verification, finalize/merge) and prints a deterministic handoff line.

## Where it touches the code

- `src/cli/commands/propose.ts:14-19` — add `.option('--stop-after <artifact>', '...')` alongside the existing options. Validate against `graph.buildOrder` after `workflowEngine.loadWorkflow`. Pass through to `artifactStore.createChange`.
- `src/artifacts/artifact-store.ts:20-67` — extend `createChange` signature to accept `stopAfter?: string`. Set `metadata.stop_after = stopAfter` before `state.write`.
- `src/schemas/change-metadata.ts:47-62` — add `stop_after: z.string().optional()` to `ChangeMetadataSchema`.
- `.claude/skills/metta-propose/SKILL.md:14-32` — extend Step 1 argument parsing to also strip `--stop-after <value>` and pass through.
- `.claude/skills/metta-propose/SKILL.md:66-117` — after each `metta complete <artifact>` call in Step 3, inspect change's `stop_after`. If it equals the just-completed artifact, exit with the handoff line.
- `tests/artifact-store.test.ts` — add tests for `stopAfter` persistence and absence.
- `tests/schemas.test.ts` — add tests for the new optional field accepting valid strings and rejecting non-strings.
- A new `tests/cli-propose-stop-after.test.ts` — end-to-end test that propose with `--stop-after spec` writes `stop_after: spec` to `.metta.yaml`.

## Pros

- **Expressive.** The user names the exact boundary they want. Useful when reviewing specs only, or specs + tasks, or only intent before discovery deepens.
- **Deterministic.** No magic mapping from workflow → planning-tail. The flag value IS the boundary.
- **Composes orthogonally.** Works alongside `--workflow`, `--auto`, `--from-issue`, `--discovery` without interaction bugs.
- **Testable.** The boundary is a string equality check after `metta complete`. Skill behavior is matchable on the exact handoff line.
- **Future-extensible.** A later sugar `--stop-after-plan` boolean (Option 2) can resolve to "the last planning artifact in `buildOrder`" and call through to this same `stop_after` field.
- **Aligns with the existing flag taxonomy.** `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, `--auto` are all single-purpose flags that compose. `--stop-after` slots in cleanly.

## Cons

- **Workflow-aware validation.** The validation lives in the CLI command (where `graph.buildOrder` is loaded) and not in the schema (which only knows the field is a string). This adds a small amount of cross-layer coupling: the CLI command must run validation; if a future tool writes `.metta.yaml` directly with `stop_after: <bogus-id>`, the schema accepts it. Mitigation: when the skill reads the value, it can sanity-check membership in `buildOrder` and warn on mismatch.
- **Slightly more typing.** `--stop-after tasks` is six characters longer than `--stop-after-plan`. For users who only ever stop after the last planning artifact, that's a small UX loss compared to Option 2.
- **Knowledge of artifact ids required.** The user must know the workflow's artifact ids. Mitigation: the validation error lists them when the flag value is wrong, and `--help` documents the option.

## Complexity

Low. The CLI option, validation, schema extension, and `createChange` plumbing are mechanical. The skill update is two short edits (argument parsing in Step 1, post-`metta complete` check in Step 3). End-to-end test is a single fixture run. Estimated 6–10 small commits across the change set.

## Fit with existing code

Excellent. Every piece of plumbing already exists:
- The CLI command pattern (Commander.js `.option(...)`, `program.opts().json`, `outputJson`) is identical to existing flags.
- `artifactStore.createChange` already accepts optional booleans (`autoAccept`, `workflowLocked`); adding `stopAfter` follows the same pattern.
- `ChangeMetadataSchema` already has optional fields (`workflow_locked`, `auto_accept_recommendation`); adding one more is trivial.
- The skill already parses flags from `$ARGUMENTS` (see `--workflow` and `--auto` handling in `.claude/skills/metta-propose/SKILL.md:14-32`).

## Risks

- **Invalid value bypasses validation.** If a future caller of `ArtifactStore.createChange` passes an invalid `stopAfter`, the schema accepts it. Mitigation: validate at the CLI layer where the workflow graph is in scope. The schema cannot validate against `buildOrder` because workflows are external files. Acceptable trade-off — same as how `workflow: string` is not validated against the available workflow list at the schema layer either.
- **Skill must read the change record after each `metta complete`.** That's an extra YAML read per planning artifact. Mitigation: the skill already reads the change's status. Cost is negligible.
- **`--from-issue` + `--stop-after`.** Need an end-to-end test that combining them works as expected (fixture: open issue, propose with `--from-issue X --stop-after tasks`).

## Recommendation strength

Strong recommendation to adopt. This is the path the issue's "Candidate Solutions" Option 1 spelled out. It's the smallest, cleanest, most expressive change. Option 2 can be layered on top later if real users ask for it.
