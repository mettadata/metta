# fix-three-issues-1-elevate-research-synthesis-numbered-step

## Problem

Three independent defects degrade the metta workflow for orchestrators and developers:

**Issue 1 (major) — research synthesis is silently skipped.** When `metta-propose` (and the three sibling skills that fork parallel researchers) spawn multiple `metta-researcher` agents, each agent currently writes its output to an uncontrolled path — often `/tmp/research-*.md` — and the orchestrator frequently proceeds to `metta complete research` without ever writing the canonical `spec/changes/<name>/research.md`. The synthesis step is buried as sub-bullet 3d in the skill template, making it easy to miss. The gate catches the missing file after the fact, but the pattern forces a frustrating retry loop that wastes wall-clock time. Affected skills: `metta-propose`, `metta-fix-issues`, `metta-auto`, `metta-fix-gap`.

**Issue 2 (minor) — task checkboxes are never ticked.** `markTaskComplete` exists in `src/execution/batch-planner.ts` but is never invoked from the `metta complete implementation` code path in `src/cli/commands/complete.ts`. Archived `tasks.md` files consistently show `- [ ]` boxes even for changes that completed successfully, making the task list useless as an audit trail.

**Issue 3 (minor) — statusline omits workflow tier.** The statusline script `src/templates/statusline/statusline.mjs` emits `[metta: <artifact>]` but does not surface which workflow tier is running (quick / standard / full). The `metta status --json` response already includes a `workflow` field, so the data is available but unused. Developers running parallel changes or switching between quick and standard runs have no visual signal of which tier is active.

Affected users: all AI orchestrators using any of the four parallel-researcher skills; all developers reading `tasks.md` post-completion; all developers using the custom Claude statusline.

## Proposal

- **Fix 1 — Elevate research synthesis to a numbered step in all four skill templates.**
  In `src/templates/skills/metta-propose/SKILL.md`, `src/templates/skills/metta-fix-issues/SKILL.md`, `src/templates/skills/metta-auto/SKILL.md`, and `src/templates/skills/metta-fix-gap/SKILL.md`:
  1. Change each parallel researcher's per-approach output path from an uncontrolled path (e.g. `/tmp/research-*.md`) to the explicit, in-tree path `spec/changes/<name>/research-<slug>.md` (where `<slug>` is a short identifier for the approach, e.g. `websockets`, `sse`, `polling`).
  2. Add a new numbered step — immediately after the parallel researcher fan-out and before the `metta complete research` call — with an imperative title such as "Synthesize research" and the body: "Read all `spec/changes/<name>/research-<slug>.md` files; write `spec/changes/<name>/research.md` with a summary of each approach and a final recommendation; commit the file."
  This makes the synthesis obligation unambiguous and impossible to overlook.

- **Fix 2 — Call `markTaskComplete` for every task when completing implementation.**
  In `src/cli/commands/complete.ts`, in the `artifactId === 'implementation'` branch (around line 341), after the scoring block: read `spec/changes/<changeName>/tasks.md` if it exists, call `markTaskComplete` (imported from `src/execution/batch-planner.ts`) for every task ID found in the file, write the updated content back to disk, and include the file in the auto-commit block at the bottom of the action handler so the ticked checkboxes are persisted to git.

- **Fix 3 — Include workflow tier in the statusline format.**
  In `src/templates/statusline/statusline.mjs`: extend `formatStatusLine` to accept a `workflow` parameter and produce `[metta:<workflow>:<artifact>]` (e.g. `[metta:quick:implementation]`) when `workflow` is present and the artifact is neither `idle` nor `unknown`. In the `main` function, read `parsed.workflow` from the `metta status --json` response and pass it through. Update `tests/statusline-format.test.ts` to cover the three-part format for active artifacts and confirm that `idle` and `unknown` states omit the workflow segment.

## Impact

- `src/templates/skills/metta-propose/SKILL.md` — research section rewritten; new numbered synthesis step added.
- `src/templates/skills/metta-fix-issues/SKILL.md` — same research section changes as above.
- `src/templates/skills/metta-auto/SKILL.md` — same research section changes as above.
- `src/templates/skills/metta-fix-gap/SKILL.md` — same research section changes as above.
- `src/cli/commands/complete.ts` — gains a `tasks.md` read/rewrite block in the `implementation` branch; imports `markTaskComplete` from batch-planner.
- `src/templates/statusline/statusline.mjs` — `formatStatusLine` signature gains a `workflow` field; output format changes for active artifacts (three-part label); `main()` reads and forwards `workflow`.
- `tests/statusline-format.test.ts` — existing format tests updated to pass `workflow`; new tests added for three-part label and backward-compatible idle/unknown cases.

No schema changes. No new CLI flags. No changes to gate logic, artifact definitions, or workflow YAML files.

## Out of Scope

- The pre-existing YAML duplicate-keys warning in workflow config files is NOT being fixed here.
- The `full` workflow's missing artifact template files (`domain-research`, `architecture`, `ux-spec`) are NOT being added in this change; that gap is tracked separately.
- `markTaskComplete` is NOT being extended to support partial completion (ticking individual tasks mid-implementation); all tasks are marked complete at once when `metta complete implementation` is called.
- The statusline is NOT being changed to show multiple concurrent changes; it continues to display a single active artifact.
- No changes are made to the `metta-executor` agent template or the executor's prohibition on touching `tasks.md` — the marking is done by the CLI command, not the executor.
- Research artifact naming conventions for the `full` workflow's extra planning stages (`domain-research`, etc.) are out of scope.
- No changes to `src/execution/batch-planner.ts` itself — `markTaskComplete` is already correct and only needs to be called.
