# Research: `--stop-after-plan` boolean alias (Option 2)

## Approach

Add a single boolean CLI flag `--stop-after-plan` to `metta propose`. The flag has no value; when present, the CLI resolves it to "stop after the last planning artifact in the resolved workflow's planning phase". For the standard workflow, that's `tasks`. For the full workflow, that's whatever the last pre-implementation artifact id is in its `buildOrder` (e.g. `architecture` or `ux-spec` depending on graph topology). The boolean is stored as `stop_after_plan: true` on the change record OR transparently resolved at flag-parse time to the equivalent `stop_after: <id>` value.

The `/metta-propose` skill orchestrator behaves the same way as it would in Option 1 once the boolean is resolved — it inspects the resulting boundary marker after each `metta complete` call and exits when reached.

## Where it touches the code

- `src/cli/commands/propose.ts:14-19` — add `.option('--stop-after-plan', '...')` alongside existing options. After `workflowEngine.loadWorkflow`, compute the "last planning artifact" by walking `graph.buildOrder` and finding the last id whose corresponding artifact is NOT in the execution phase. Store either as `stop_after_plan: true` (preserving the user's intent literally) or pre-resolve to `stop_after: <id>`.
- `src/artifacts/artifact-store.ts` — same plumbing as Option 1, plus an additional optional boolean field if we keep the boolean form.
- `src/schemas/change-metadata.ts` — add either `stop_after_plan: z.boolean().optional()` (boolean form) or just `stop_after: z.string().optional()` (pre-resolved form).
- `.claude/skills/metta-propose/SKILL.md` — argument parsing extracts `--stop-after-plan`, passes through. Post-`metta complete` check needs to know whether to compare against a resolved id or to call back into the workflow graph each time.
- New helper in `WorkflowEngine` (or a small standalone util) — `lastPlanningArtifact(graph: WorkflowGraph): string | null` that walks `buildOrder` and returns the id immediately before the first execution-phase artifact. Needs a way to mark artifacts as "planning" vs "execution"; today the workflow YAMLs differ via the `type` field (`intent`, `spec`, `research`, `design`, `tasks`, `execution`, `verification`). That heuristic can be hardcoded ("execution-phase types are `execution` and `verification`") but is workflow-internal coupling.

## Pros

- **One-token UX.** Users who always stop at the planning/execution boundary type `--stop-after-plan` instead of `--stop-after tasks`. Minor convenience win.
- **Workflow-portable.** `--stop-after-plan` correctly resolves to `tasks` for standard, `domain-research`-or-deeper for full, etc. — the user does not need to know the artifact ids.
- **Hides the artifact name space from new users.** People who do not yet know what `tasks` is can still get the review-before-implement gate.

## Cons

- **Hidden mapping.** `--stop-after-plan` does not name a boundary; it names a category. Users debugging an unexpected exit must consult docs (or the workflow file) to learn what "plan" maps to in their workflow.
- **Workflow-internal coupling.** Determining "last planning artifact" requires classifying each artifact as planning vs execution. Today the only signal is the `type` field on the workflow YAML and the convention that `implementation` and `verification` are the execution phase. If a future workflow adds a new phase (e.g. `pre-implementation-checks`), this resolver becomes wrong silently.
- **Less expressive than Option 1.** Cannot say "stop after spec" or "stop after design" — only "stop after the planning tail".
- **Two flags or one?** Either we ship `--stop-after-plan` AS a sugar over `--stop-after <id>` (which means we are shipping Option 1 first and adding Option 2 on top), or we ship it standalone and later realize we need the `<id>` form anyway. Either way, we end up with both surfaces eventually.
- **Schema drift risk.** If we persist `stop_after_plan: true` (boolean form) instead of pre-resolving to `stop_after: <id>`, then the change record is workflow-version-coupled — re-running an old change against a new workflow could resolve "plan" differently. Mitigation: pre-resolve at flag-parse time and write the resolved id only.
- **Less testable.** "Stop after the planning tail" is a property that depends on the workflow graph, not a string equality. Tests need fixtures for at least standard and full workflows to assert the boundary lands on the right artifact in each.

## Complexity

Slightly higher than Option 1 because of the workflow-tail resolver. The resolver itself is small (10–20 lines), but classifying artifacts into planning vs execution adds a typing concern and a new edge case for every future workflow.

## Fit with existing code

Mediocre. The flag plumbing is fine, but the resolver does not have a natural home — `WorkflowEngine` does not currently classify phases, and adding that classification crosses into workflow-schema territory.

## Risks

- **Resolver wrong on a new workflow.** If a custom workflow drops `tasks` from its `buildOrder` or restructures the planning tail, `--stop-after-plan` resolves to a surprise id silently. Mitigation: validate that the resolved id is a member of `buildOrder` and not in the execution phase; emit a clear error if no planning tail exists.
- **Composability with `--stop-after`.** If we ship both flags, what happens when the user passes both? Need a precedence rule (probably error: "pass either `--stop-after` or `--stop-after-plan`, not both") and tests for it.
- **Documentation burden doubles.** Two flags to document, two flags users can confuse.

## Recommendation strength

Weak. Option 2 is a sugar wrapper that should be evaluated AFTER Option 1 is in production based on real user feedback. Shipping it first or alone trades a small UX win for a workflow-coupling problem and weaker testability. The right sequencing is Option 1 now, Option 2 as a possible follow-up.
