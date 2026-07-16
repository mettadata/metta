# Verification: delete-dead-code-identified-2026-07-framework-review-v0-2

Verified against the Deletion Contract in `spec.md` (the operative artifact for this
zero-delta change) by exercising real behavior from `dist/` on branch
`metta/delete-dead-code-identified-2026-07-framework-review-v0-2`. `npm run build` was
run first; all live checks below ran against the freshly built CLI/modules.

## Area 1 — Execution-engine island deleted, task parsing relocated (US-1): PASS

- `grep -rn "ExecutionEngine\|WorktreeManager" src/` → no matches.
  `grep -rn "planBatches" src/` → no matches. `src/execution/` directory absent.
- `tests/execution-engine.test.ts` and `tests/worktree-manager.test.ts` deleted (files
  do not exist). `tests/batch-planner.test.ts` retains `parseTasks`/`markTaskComplete`
  cases (4 references) and has zero `planBatches` references.
- Relocation verified: `src/planning/batch-planner.ts:11` (`parseTasks`) and `:84`
  (`markTaskComplete`); `src/cli/commands/complete.ts:13` imports both from
  `../../planning/index.js` and uses them at lines 529/532. Root barrel re-exports
  planning (`src/index.ts:19`).
- Live exercise via `node -e` against `dist/planning/batch-planner.js`: parsed a
  checklist-format tasks.md into ids `1.1`, `1.2` with `depends_on: ["1.1"]`;
  `markTaskComplete(md, '1.1')` rewrote the line to `- [x] **Task 1.1: First task**`.
  Module exports exactly `parseTasks,markTaskComplete` — no `planBatches`.
- `src/planning/parallel-wave-computer.ts` untouched — last commit `954afd38f`
  (pre-dates this change), same exports.

## Area 2 — ToolAdapter indirection removed (US-2): PASS

- `grep -rn "ToolAdapter" src/` → no matches; `tests/delivery.test.ts` has zero
  `ToolAdapter` references and keeps concrete-function/content-type cases.
- Content types preserved: `SkillContent` (`src/delivery/tool-adapter.ts:1`) and
  `ProjectContext` (`:15`) still defined; `claude-code-adapter.ts` imports them and
  exports concrete functions (`formatSkill`, `formatContext`, ...) directly.
- Live behavioral check: `metta install --git-init` in a throwaway temp project
  (scratchpad, deleted after) exited 0 and installed the full structure — 18 skills
  under `.claude/skills/`, 11 agents under `.claude/agents/`, both guard hooks,
  statusline, `.metta/`, `spec/`, constitution, initial commit. Output structure
  matches pre-change behavior ("Installed: 29 slash commands", etc.).

## Area 3 — Dead schemas removed, strict state schema still validates (US-3): PASS

- `grep -rn "PluginManifest\|AutoStateSchema" src/` → no matches;
  `src/schemas/plugin-manifest.ts` and `src/schemas/auto-state.ts` absent.
- `src/schemas/state-file.ts` — `StateFileSchema` is `schema_version` + optional
  `execution`, `.strict()` (line 7), no `auto` field.
- Verified (not assumed): no `state.yaml` anywhere in repo or fixtures carries an
  `auto` field (`find`/`grep` across repo excluding node_modules/.git → zero hits);
  `tests/schemas.test.ts` has zero plugin-manifest/auto-state references.
- Live check: `metta status --json` against this project parsed and validated its
  change state successfully under the narrowed strict schema (exit 0, full JSON with
  `current_artifact: verification`).

## Area 4 — CLI surface tells the truth (US-4): PASS (contract), one flagged residue

- `metta auto --help`: describes printing guidance for `metta propose` and contains
  the explicit negation "does not run an automated propose→plan→execute→verify→ship
  loop" — no affirmative lifecycle-loop claim.
- `metta auto "test something"` runtime output: states the negation and points to
  `metta propose "test something"` — exit 0.
- `metta auto --resume` and `metta auto --from spec` → `error: unknown option`.
- `metta execute --help`: options are only `--change <name>` and `-h, --help`;
  `metta execute --resume` → `error: unknown option '--resume'`, exit 1 — no fake
  "Resuming from last checkpoint..." output.
- All US-4 acceptance criteria in `stories.md` and all US-4 proof clauses in the
  Deletion Contract are satisfied.
- **Flagged residue (outside the contract):** the fish completion script still
  describes auto as "Full lifecycle loop" (`src/cli/commands/completion.ts:68`),
  while the zsh variant was corrected (`completion.ts:33`). `summary.md`'s deviation
  note — "shell completion's 'Full lifecycle loop' claim fixed" — is therefore only
  true for zsh. This string pre-dates the change and is not a post-condition of the
  Deletion Contract or any US-4 acceptance criterion, so it does not fail the
  contract, but it is exactly the US-4 class of dishonest CLI surface. Recommend a
  one-line follow-up (or logged issue) to fix `completion.ts:68`.

## Area 5 — Workflow-engine speculative machinery deleted (US-5): PASS

- `grep -rn "mergeWorkflows" src/` → no matches. `grep -rn "extends" src/workflow*
  src/schemas/workflow-definition.ts` → only `class WorkflowCycleError extends Error`
  (TypeScript class inheritance, not the workflow feature).
- `WorkflowEngine.prototype` members (inspected live from dist): `loadWorkflow`,
  `loadWorkflowFromDefinition`, `getNext`, `getStatus`, `topologicalSort` — no
  `validate()`.
- Live check: all four shipped workflow YAMLs (`full`, `quick`, `standard`,
  `trivial`) loaded via `WorkflowEngine.loadWorkflow` against
  `src/templates/workflows/` and topologically sorted without error (build orders:
  full=10 artifacts, standard=8, quick/trivial=3).
- Dangling-reference enforcement in exactly one place: a synthetic definition with
  `requires: ['ghost']` was rejected at load time by `topologicalSort`
  ("depends on unknown artifact 'ghost'").
- `tests/workflow-engine.test.ts`: zero inheritance/override/`validate()` references;
  retains topological-sort, `getNext`, `getStatus`, YAML-loading, cycle-detection
  scenarios (11 references).
- `spec/specs/workflow-engine/spec.md`: case-insensitive grep for
  extends/overrides/validate finds only incidental prose ("validate against
  `WorkflowDefinitionSchema` using Zod", "Extends `Error`") — the inheritance
  sections and scenarios S-12/S-13/S-17–S-20 are gone.

## Spec retirement: PASS

- `spec/specs/execution-engine/` absent.
- `spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement/` contains
  `spec.md` and `README.md`.

## Gates

| Gate | Result |
|------|--------|
| `npx vitest run` | 1054 passed / 1054, 80 files, 0 failures (matches summary.md's claim) |
| `npx tsc --noEmit` | clean |
| `npm run lint` (tsc --noEmit) | clean |
| `npm run build` | clean (templates copied) |

## Overall verdict: PASS

All five Deletion Contract areas and the spec retirement are verified with live
evidence; all gates green. One non-blocking discrepancy flagged: `summary.md`
overclaims the shell-completion fix — the fish completion description for `auto`
at `src/cli/commands/completion.ts:68` still reads "Full lifecycle loop" and should
be fixed in a follow-up or logged as an issue.

Fixtures cleaned up (temp install project deleted).
