# Design: delete-dead-code-identified-2026-07-framework-review-v0-2

## Approach

This is a subtraction change: no new abstractions, no new components. The design
is a precise manifest — delete, split, or edit — executed as five independently
verifiable batches (one per Deletion Contract area, US-1..US-5), each closing
with `npx vitest run` and `tsc` green before the next starts, per `spec.md`'s
constraint that this lands incrementally, not as one diff. Every deletion below
was zero-non-test-importer-verified in `research.md` against HEAD `1ccfed3d7`
on 2026-07-16; the implementer re-runs the same greps immediately before each
commit, since research explicitly does not guarantee the tree is unchanged at
execution time. Composition-over-inheritance is served directly here: item 2
replaces an interface with zero-payoff single-implementation indirection
(`ToolAdapter`) with plain direct function calls — the simplest form of
composition.

## Components

No components are added. Four existing components shrink or split; one file is
born as a pure relocation target (not a new abstraction).

### Deletion manifest

| Area | File | Action |
|---|---|---|
| US-1 | `src/execution/execution-engine.ts` | delete entirely |
| US-1 | `src/execution/worktree-manager.ts` | delete entirely |
| US-1 | `src/execution/fan-out.ts` | delete entirely |
| US-1 | `src/execution/batch-planner.ts` | delete entirely (whole file removed) |
| US-1 | `src/planning/batch-planner.ts` | **new sibling file** — `parseTasks`, `markTaskComplete`, `TaskDefinition` moved here verbatim (Approach A/B rejected merging into `tasks-md-parser.ts` — see research's `BatchPlan` name-collision finding). `planBatches`, `BatchPlan` (execution-shape), `detectOverlaps`, `OverlapReport`, `getCompletedTasks` do **not** travel — they die with the old file (the latter three are net-new zero-importer findings from research, explicitly out of this change's verified scope; log a follow-up `metta issue` after ship). |
| US-1 | `src/planning/index.ts` | edit — add `export * from './batch-planner.js'` |
| US-1 | `src/cli/commands/complete.ts` | edit — import path `'../../execution/batch-planner.js'` → `'../../planning/index.js'` (or `'../../planning/batch-planner.js'`) |
| US-2 | `src/delivery/tool-adapter.ts` | edit — delete `ToolAdapter` interface; keep `SkillContent`, `CommandContent`, `ProjectContext`, `QuestionCapability` in place, unmodified |
| US-2 | `src/delivery/claude-code-adapter.ts` | edit — export its functions directly (no interface conformance needed) |
| US-2 | `src/delivery/command-installer.ts` | edit — drop generic adapter-type parameter; call Claude Code functions directly |
| US-3 | `src/schemas/plugin-manifest.ts` | delete entirely |
| US-3 | `src/schemas/auto-state.ts` | delete entirely |
| US-3 | `src/schemas/state-file.ts` | edit — remove `auto: AutoStateSchema.optional()` field and its import; schema stays `.strict()` |
| US-4 | `src/cli/commands/execute.ts` | edit — remove `--resume` option, its `resume` field in JSON output, and the "Resuming from last checkpoint..." line |
| US-4 | `src/cli/commands/auto.ts` | edit — remove `--from <phase>` (dead per research target 8: defined, never read, and itself an inert lifecycle-loop claim covered by item 4's own framing goal); rewrite help/action text (see API Design) |
| US-5 | `src/workflow/workflow-engine.ts` | edit — delete `mergeWorkflows`, the `extends`-handling branch in `loadWorkflow`, and `WorkflowEngine.validate()` |
| US-5 | `src/schemas/workflow-definition.ts` | edit — remove `extends`/`overrides` fields |

### `src/index.ts` barrel — exact lines removed

```
19: export * from './execution/batch-planner.js'      → REMOVE
20: export * from './execution/execution-engine.js'    → REMOVE
21: export * from './execution/worktree-manager.js'    → REMOVE
22: export * from './execution/fan-out.js'              → REMOVE
```
Line 28 (`export * from './delivery/tool-adapter.js'`) **stays** — it still
carries the four surviving content types after the interface is deleted from
the source file; no barrel edit needed there. `src/planning/` is not currently
re-exported from the root barrel at all, so no root-barrel line is added for
the relocation.

### `src/schemas/index.ts` — exact lines removed

```
4:  export * from './auto-state.js'      → REMOVE
10: export * from './plugin-manifest.js' → REMOVE
```

### Test files

- **Delete outright:** `tests/execution-engine.test.ts`, `tests/worktree-manager.test.ts`.
- **Trim:** `tests/batch-planner.test.ts` (drop `planBatches` describe block,
  keep + relocate `parseTasks`/`markTaskComplete` cases, update import to
  `../src/planning/batch-planner.js`); `tests/schemas.test.ts` (drop
  `PluginManifestSchema` and `AutoStateSchema` describe blocks + their
  top-of-file imports); `tests/workflow-engine.test.ts` (drop `validate()`
  scenarios and `extends`/`overrides` inheritance scenarios, keep topo-sort /
  `getNext` / `getStatus` / YAML-load / cycle-detection cases).
- **Confirm-only, likely no change:** `tests/delivery.test.ts` — research found
  its existing imports already pull only the two content types, not
  `ToolAdapter`; re-check in full at execution time per research target 11.
- **Untouched:** `tests/parallel-wave-computer.test.ts`, `tests/tasks-md-parser.test.ts`,
  `tests/cli-complete.test.ts`.

## Data Model

`StateFileSchema` (`src/schemas/state-file.ts`) narrows: the `auto` field is
removed, `AutoStateSchema` is deleted, schema stays `.strict()`. No other
schema shape changes. `workflow-definition.ts`'s `WorkflowDefinitionSchema`
drops `extends`/`overrides` fields — a narrowing, not a rename, so no
migration path is defined (none is needed per Risks below).

## API Design

`metta execute --help` — `--resume` option removed entirely; `--change <name>`
unchanged. Running `metta execute --resume` fails with Commander's standard
`error: unknown option '--resume'`.

`metta auto --help` — new honest framing, options narrow to `--workflow <name>`
and `--max-cycles <n>` only (`--resume` and `--from <phase>` both removed —
`--from` was confirmed dead-and-unreferenced in research target 8, and its
implied phase-targeted resume is itself the kind of lifecycle-loop claim item 4
exists to remove, so it is in scope here, not deferred):

```
Usage: metta auto [options] <description>

Prints guidance for starting a change with `metta propose`. This command
does not run an automated propose→plan→execute→verify→ship loop; use the
individual lifecycle skills (`metta-propose`, `metta-plan`, `metta-execute`,
`metta-verify`, `metta-ship`) or `/metta-auto` for the full loop, in an
AI-orchestrated session.

Options:
  --workflow <name>    workflow tier to mention in guidance (default: "standard")
  --max-cycles <n>      unused by this command; retained for output compatibility (default: "10")
  -h, --help            display help for command
```

Runtime output (non-JSON mode) drops any "Phase 0" / "resuming" language and
states plainly that it is pointing at `metta propose`.

## Direct spec edits

**`spec/specs/execution-engine/`** — retire via `git mv` to a **new dated
archive folder**, `spec/archive/2026-07-16-delete-dead-code-execution-engine-retirement/`,
not the existing `2026-07-16-spec-store-reset/` bundle. Rationale: that
bundle's README documents three specific classification criteria (fix
ceremony / subsumed / truncated slug) for its 19 folders; `execution-engine`
is none of those — it is a durable capability spec being retired because its
implementing code is deleted in this change, a fourth and distinct rationale.
Folding it into the existing bundle would misrepresent that README's stated
scope. The new folder gets its own one-paragraph `README.md` stating the
retirement reason and linking this change.

**`spec/specs/workflow-engine/spec.md`** — edited in place (not delta-merged;
`spec.md`'s H1 note explains why): remove section 2.2's `extends`/`overrides`
fields, section 2.3 (`WorkflowOverride`), section 3.6 (`validate()`), section 6
(Workflow Inheritance), and scenarios S-13, S-17–S-20. Sections 1, 2 (minus
2.2/2.3), 4, 5, 7–9 and scenarios S-01–S-12 (minus S-13), S-14–S-16 are
unchanged.

## Docs knock-on

`docs/api.md`, `docs/architecture.md`, `docs/changelog.md`,
`docs/getting-started.md` are machine-generated by `DocGenerator`
(`src/docs/doc-generator.ts`) — confirmed by reading its `generate()` method,
which only ever writes `${docType}.md` for those four types into the
top-level `docs/` output directory. These are **regenerated at finalize**;
no manual edit needed here.

`docs/workflows/workflows.md`, `docs/internals/extending.md`,
`docs/internals/data-model.md`, and `docs/internals/architecture.md:31` are
**not** covered by `DocGenerator` (confirmed: it has no output path under
`docs/workflows/` or `docs/internals/`) — these are hand-authored reference
docs that describe `extends`/`overrides` as a user-facing authoring feature
(per research target 9). They require a **manual edit** during this change's
execution/verify batch for item 5, removing or correcting the `extends`/
`overrides` sections; this is broader than `spec.md`'s Impact section names
(`docs/api.md`/`docs/architecture.md`) and is called out explicitly so it
isn't dropped.

## Risks & Mitigations

**(a) Barrel removal breaks external consumers.** Unknown risk, accepted:
metta is a single package at 0.1.0 with no published npm registry release and
no documented external-API guarantee; research found zero in-repo importers
of any deleted symbol. No mitigation beyond the per-item verified-importer
check already required by `spec.md`'s constraints.

**(b) `state.yaml` files elsewhere carry the removed `.auto` field.**
`StateFileSchema` **is `.strict()`** (confirmed directly in
`src/schemas/state-file.ts:5-9`), so any on-disk `state.yaml` with an `auto`
key would fail validation post-change. Research's repo-wide `find` for
`state.yaml` returned zero results in this repo or its `demos/` subprojects —
no in-repo fixture to break. `state.yaml` is a `.metta/`-scoped, per-project
runtime artifact (gitignored in consumer projects, ephemeral working state,
not a distributed schema), so this is a low-blast-radius, accepted risk with
one required mitigation carried into execution: re-run the `find` for
`state.yaml` (including `tests/fixtures/`) immediately before deleting the
field, since a fixture could have appeared since research ran.

**(c) Test-count drop (~4 files deleted, several trimmed) vs. the project's
1:1 test-to-source-file convention.** Accepted: source file count drops
proportionally (4 source files deleted outright, matching the 2 outright-
deleted test files plus proportional trims elsewhere), so the ratio is
preserved, not violated — this is the convention working as intended on a
shrinking codebase, not an exception to it.

Story references: US-1 (execution-engine/batch-planner), US-2 (tool-adapter),
US-3 (schemas), US-4 (CLI surface), US-5 (workflow-engine) — see `stories.md`
for acceptance criteria the planner should map tasks against.
