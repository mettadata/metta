# Research: delete-dead-code-identified-2026-07-framework-review-v0-2

This is a fresh, zero-importer audit conducted directly against current `src/`
and `tests/` (the framework-review evidence cited in `intent.md` is 9 days
old). Every importer claim below is backed by a `grep -rn` run on
2026-07-16 against the working tree at HEAD (`1ccfed3d7`). No `.codegraph/`
index exists in this repo, so all lookups are plain grep, not graph queries.

## Decision: proceed with the five-item deletion plan in `spec.md` as scoped, with two scope-boundary clarifications and no exclusions

All ten deletion targets named in the Deletion Contract were re-verified to
have zero non-test importers on any live code path. No target flipped to
"has a live importer" — there are **no exclusions**. Two things were found
during the audit that the Deletion Contract doesn't explicitly name and that
the planning phase should account for (not blockers, just scope-boundary
notes, both flagged below): (a) two additional zero-importer exports in
`batch-planner.ts` (`detectOverlaps`, `getCompletedTasks`) sitting right next
to `planBatches`, and (b) the `TaskDefinition` interface must travel with
`parseTasks`/`markTaskComplete` since both depend on it as their
parameter/return type, even though the contract text only names the two
functions.

### Approaches Considered

**Approach A — Execute exactly as scoped in `spec.md`/`intent.md`, verify-then-delete per item, no scope changes.**
Re-run the zero-importer grep for every named symbol immediately before each
item's deletion commit (not just once at research time), and split
`batch-planner.ts` into a deleted remainder (`planBatches` + its `BatchPlan`
type) and a relocated live remainder (`parseTasks`, `markTaskComplete`, and
`TaskDefinition`, the type both functions depend on) moved into a **new file**
`src/planning/batch-planner.ts`, re-exported via `src/planning/index.ts`.
- Pros: matches the Deletion Contract's stories/proof criteria exactly, keeps
  diffs reviewable per-item, avoids scope creep, needs no new judgment calls
  during execution beyond what's already decided here.
- Cons: leaves `detectOverlaps`/`getCompletedTasks` (newly discovered dead
  code, see Rationale) in place for a future pass; leaves two structurally
  similar tasks.md parsers (`parseTasksMd` in `tasks-md-parser.ts` and the
  relocated `parseTasks`) un-consolidated, which is a known but explicitly
  out-of-scope duplication (see Rationale).

**Approach B — Same as A, but fold `parseTasks`/`markTaskComplete` directly into `tasks-md-parser.ts` instead of a new sibling file.**
- Pros: one fewer file in `src/planning/`; physically "alongside" per the
  Impact section's wording.
- Cons: `tasks-md-parser.ts` returns a `TaskGraph`/`Batch`/`Task` shape
  consumed by `computeWaves`; `parseTasks` returns an unrelated
  `TaskDefinition[]`/`BatchPlan` shape consumed by `metta complete`'s
  checklist-marking flow. `parallel-wave-computer.ts` *already* exports a
  same-named-but-different `BatchPlan` interface (wave-oriented, not
  dependency-oriented) — merging the two parsers into one file would put two
  same-named-but-incompatible `BatchPlan` types in the same module, forcing
  an unwanted rename that the Constraints section ("no behavior changes")
  and the Out of Scope section ("no new functionality... this change is
  deletion and simplification only") both argue against. Rejected as
  introducing an unnecessary naming collision and a bigger diff than the
  contract calls for.

**Approach C — Expand scope to also delete `detectOverlaps`/`getCompletedTasks` and consolidate the two tasks.md parsers into one, in this same change.**
- Pros: removes all dead code discovered in this audit in one pass, and
  addresses the parser-duplication smell noted above.
- Cons: directly contradicts the change's own constraints — `detectOverlaps`
  and `getCompletedTasks` are not named anywhere in `spec.md`'s Deletion
  Contract or `intent.md`'s five categories, so deleting them isn't backed by
  the story/scenario proof criteria this change is verified against; parser
  consolidation is a refactor (new merged behavior surface), which the Out
  of Scope section explicitly excludes ("Adding new functionality... this
  change is deletion and simplification only" — consolidating two parsers
  is restructuring behavior-bearing code, not pure subtraction). Rejected;
  logged as a candidate for a future `metta issue`/backlog item instead.

### Rationale

Approach A is recommended: it is the only option that stays inside the
Deletion Contract's verifiable post-conditions without either creating an
avoidable type-name collision (Approach B) or expanding scope beyond what
the change's own Out of Scope section permits (Approach C). The two findings
below are surfaced for the record but do not change the recommended
approach or its five items.

---

## Per-target findings

### 1. `src/execution/execution-engine.ts` (`ExecutionEngine`, `ExecutionCallbacks`)

Zero non-test importers. Only importer is the barrel:
```
src/index.ts:20:export * from './execution/execution-engine.js'
```
and its own test:
```
tests/execution-engine.test.ts:7:import { ExecutionEngine } from '../src/execution/execution-engine.js'
```
`src/cli/commands/execute.ts` never imports `execution-engine.js` — confirmed
by reading the file in full (reproduced under item 8 below); its action body
only touches `ctx.artifactStore` and prints status text. **Confirmed dead.**

### 2. `src/execution/worktree-manager.ts` (`WorktreeManager`, `HeadAdvancedError`)

Non-test importers: only `src/execution/execution-engine.ts` (itself dead,
item 1) and `src/index.ts` barrel:
```
src/execution/execution-engine.ts:7:import { WorktreeManager, HeadAdvancedError, type Worktree } from './worktree-manager.js'
```
`HeadAdvancedError` has no importer outside `execution-engine.ts` and
`tests/worktree-manager.test.ts`. **Confirmed dead** — deleting item 1
removes the only live-looking consumer, so both files are safe to delete
together.

### 3. `src/execution/fan-out.ts`

Grep for the string `fan-out`/`fanOut`/`FanOut` across `src/` and `tests/`
returns many hits, but every hit outside `execution-engine.ts` and
`fan-out.ts`/its test is the **English term** "fan-out" used in orchestration
prose (skill templates describing spawning parallel subagents, a
`context.ts` recommendation-label string `'fan-out'`, a guard-hook comment),
not an import of the module:
- `src/cli/commands/context.ts:20,23` — a string literal `'fan-out'` used as
  one of four possible `recommend()` return values (a token-budget
  recommendation label, unrelated to `execution/fan-out.ts`).
- `src/templates/skills/metta-*/SKILL.md`, `src/templates/hooks/metta-guard-bash.mjs` —
  prose describing "spawn 3 agents in parallel (fan-out)"; no `import`
  statement, no reference to the TypeScript module.
- `tests/context-stats.test.ts:56,93` — tests the `context.ts` recommendation
  label, not the module.
- `src/cli/commands/complete.ts:258`, `tests/cli-complete.test.ts:532` — a
  code comment referencing "the intra-quick fan-out gate in the skill
  template" (prose, not an import).

The only real TypeScript importer of `./fan-out.js` is
`src/execution/execution-engine.ts:8` (dead, item 1) and
`tests/execution-engine.test.ts:9`. **Confirmed dead.**

### 4. `src/execution/batch-planner.ts` — live vs. dead exports

```
export interface TaskDefinition { ... }        // live (via parseTasks/markTaskComplete)
export interface BatchPlan { ... }              // dead — only used by planBatches
export function planBatches(...)                // dead
export interface OverlapReport { ... }          // dead (see note below)
export function detectOverlaps(...)             // dead (see note below)
export function parseTasks(...)                 // LIVE
export function markTaskComplete(...)           // LIVE
export function getCompletedTasks(...)          // dead (see note below)
```

Live-consumer confirmation:
```
src/cli/commands/complete.ts:13: import { parseTasks, markTaskComplete } from '../../execution/batch-planner.js'
src/cli/commands/complete.ts:529: const parsed = parseTasks(tasksMd)
src/cli/commands/complete.ts:532: updated = markTaskComplete(updated, task.id)
```
This is the only non-test importer of `parseTasks`/`markTaskComplete`. Both
functions operate on `TaskDefinition[]`/`markdown: string` — `TaskDefinition`
is not separately imported by `complete.ts` (TypeScript infers it), but the
interface must travel with the two functions when they relocate, since it's
their parameter/return type.

`planBatches` non-test importers: only `execution-engine.ts:6,54` (dead,
item 1). `BatchPlan` (the execution/batch-planner.ts one — not to be
confused with the differently-shaped `BatchPlan` in
`planning/parallel-wave-computer.ts`, see below) has no importer besides
`planBatches`'s own signature and `execution-engine.ts`. **`planBatches` +
its `BatchPlan` type confirmed dead**, matches spec.

**New finding beyond the Deletion Contract's explicit list:**
`detectOverlaps`/`OverlapReport` and `getCompletedTasks` have **zero
importers anywhere** — not even in `tests/batch-planner.test.ts` (read in
full; it only exercises `planBatches` and `parseTasks`). These three exports
are not named in `spec.md`'s Deletion Contract item 1 ("Gone from `src/`:
... `batch-planner.ts`'s `planBatches` function" — no mention of
`detectOverlaps`/`getCompletedTasks`). Recommendation: leave them out of this
change's verified scope (Approach C above explains why expanding scope here
isn't warranted) and log a follow-up `metta issue` after this change ships,
so a future change's own zero-importer audit and Deletion Contract can cover
them on their own verified terms.

**Naming-collision note:** `src/planning/parallel-wave-computer.ts` already
exports an unrelated `BatchPlan` interface (wave-batching shape, consumed by
`computeWaves`/`tasks-renderer.ts`). The `execution/batch-planner.ts`
`BatchPlan` (dependency-batching shape, consumed only by the now-dead
`planBatches`) is being deleted in full, so this is not a live collision —
but it means the relocated `parseTasks`/`markTaskComplete`/`TaskDefinition`
must **not** be merged into `parallel-wave-computer.ts` or re-use the name
`BatchPlan` for anything, and should land in a **new sibling file** (e.g.
`src/planning/batch-planner.ts`) rather than inside `tasks-md-parser.ts`,
per Approach A/B above — the two parsers return incompatible shapes and
`tasks-md-parser.ts` already imports `parallel-wave-computer.ts`'s
`BatchPlan`/`Task`/`Batch` types, so folding `parseTasks` in would put two
different `BatchPlan` concepts in one file's scope.

`src/planning/index.ts` currently only re-exports
`parallel-wave-computer.js` and `tasks-md-parser.js`:
```
export * from './parallel-wave-computer.js'
export * from './tasks-md-parser.js'
```
A third line (`export * from './batch-planner.js'`, the new relocated file)
is needed here so `parseTasks`/`markTaskComplete`/`TaskDefinition` remain
reachable via the `src/planning/` barrel — note `src/planning/` itself is
**not** currently re-exported from the root `src/index.ts` barrel at all
(confirmed: no `./planning` line in `src/index.ts`), so no root-barrel change
is needed for the relocation itself, only the item-1 barrel *removals* listed
under target 10 below.

### 5. `src/planning/parallel-wave-computer.ts` — confirmed KEEP

Live importer:
```
src/cli/commands/tasks.ts:5: import { parseTasksMd, computeWaves } from '../../planning/index.js'
src/cli/commands/tasks.ts:65: plan = computeWaves(graph, options.change)
```
`computeWaves` is called directly by the `metta tasks` command handler.
`src/planning/tasks-md-parser.ts:39` also imports its `TaskGraph`/`Task`/
`Batch` types. `tests/parallel-wave-computer.test.ts` exercises it directly.
**Confirmed live** — matches `spec.md`'s "explicitly retained, untouched."

### 6. `src/delivery/tool-adapter.ts`

`ToolAdapter` interface importers: only `claude-code-adapter.ts:3` (the sole
implementation, typed against it) and `command-installer.ts:4,12` (the
generic parameter being removed). No third implementation exists anywhere.
**`ToolAdapter` interface confirmed removable.**

`SkillContent`/`ProjectContext`/`CommandContent`/`QuestionCapability` —
these four content/capability types are genuinely live:
```
src/delivery/claude-code-adapter.ts:3,26,42,46,86  — implements formatSkill/formatCommand/formatContext/questionCapability against these types
tests/delivery.test.ts:8,23,40                     — constructs SkillContent/ProjectContext literals directly
```
`command-installer.ts` (read in full) drives `installCommands(adapter,
projectRoot)` purely through `adapter.skillsDir()`/`commandsDir()`/etc. —
narrowing it to call `claudeCodeAdapter`'s functions directly is a
straightforward de-genericization. **Confirmed:** delete only the
`ToolAdapter` interface; preserve `SkillContent`, `CommandContent`,
`ProjectContext`, `QuestionCapability` untouched, exactly as `spec.md`
specifies.

### 7. `src/schemas/plugin-manifest.ts`, `src/schemas/auto-state.ts`

`PluginManifestSchema`/`PluginManifest` importers: only
`src/schemas/index.ts:10` (barrel) and `tests/schemas.test.ts:21,1178-1208`.
**Confirmed dead**, zero production consumer.

`AutoStateSchema`/`AutoState` importers: `src/schemas/index.ts:4` (barrel),
`src/schemas/state-file.ts:3,8` (`auto: AutoStateSchema.optional()` field on
`StateFileSchema`), and `tests/schemas.test.ts` (schema-shape unit tests
only). Confirmed no *behavioral* producer/consumer of the `.auto` field
anywhere in `src/`:
```
grep -rn "\.auto\b" src/ --include=*.ts | grep -v auto-state.ts | grep -v state-file.ts
→ src/execution/execution-engine.ts:370: auto: loaded?.auto,
```
That one hit is inside `ExecutionEngine.saveState()` — the dead engine
being deleted in item 1 — which merely round-trips `loaded?.auto` back into
the object it writes; it never sets or reads a meaningful value, and once
`execution-engine.ts` is deleted this reference disappears with it. No other
`src/` code path reads or writes `.auto`.

Do not confuse `AutoStateSchema` (`src/schemas/auto-state.ts`, feeding
`StateFileSchema.auto`, the dead state field) with the unrelated
`AutoConfigSchema` (`src/schemas/project-config.ts:41,46,78`, backing
`config.yaml`'s `auto:` project-config section) — the latter is a live,
separate schema and is **not** in scope for this change; it was checked and
excluded from the audit deliberately since `intent.md`/`spec.md` name only
`AutoStateSchema`.

`StateFileSchema` is `.strict()`:
```
src/schemas/state-file.ts:5-9:
export const StateFileSchema = z.object({
  schema_version: z.number().int().positive(),
  execution: ExecutionStateSchema.optional(),
  auto: AutoStateSchema.optional(),
}).strict()
```
Because it's `.strict()`, an unrecognized `auto` key in an on-disk
`state.yaml` would already fail to parse today if present with unexpected
shape, and after this change any `state.yaml` carrying an `auto` key at all
would fail to parse (strict schemas reject unknown keys). A repo-wide search
for actual `state.yaml` files found **none** in this repository or its
`demos/` subprojects (only `.metta/config.yaml` and archived `.metta.yaml`
change-metadata files exist, which are unrelated to `state.yaml`):
```
find . -not -path "*/node_modules/*" -not -path "*/.git/*" -iname "state.yaml"
→ (no results)
```
So there is no on-disk fixture in this repo to break. `spec.md`'s Impact
section correctly frames this as "verified as part of implementation, not
assumed" — the implementer should re-run this same `find` (and check any CI
fixture directories under `tests/fixtures/` if they exist) before deleting,
since a fresh `state.yaml` could appear between now and execution.
**Confirmed:** atomic deletion of `plugin-manifest.ts`, `auto-state.ts`, and
the `auto` field on `StateFileSchema` is safe per current evidence.

### 8. `cli/commands/auto.ts` + `execute.ts` — current option lists and action bodies

`src/cli/commands/auto.ts` (registerAutoCommand), full option list:
`--workflow <name>` (default `'standard'`), `--max-cycles <n>` (default
`'10'`), `--resume`, `--from <phase>`. Action body: if `options.resume`,
checks `ctx.stateStore.exists('state.yaml')` and prints
`'Resuming auto mode...'`/`{status:'resuming'}` — no further logic. Otherwise
prints `description`/`workflow`/`maxCycles` followed by literally
`'Phase 0: Discovery (interactive)'` / `'Run metta propose to begin
discovery.'`. **`--from <phase>` is defined but never referenced anywhere in
the action body** (`grep -n "options.from" src/cli/commands/auto.ts` returns
no matches) — it is entirely inert, more decorative than `spec.md`'s prose
calls out explicitly (which focuses on `--resume`). Recommend the planning
phase decide whether `--from` is folded into item 4's cleanup (it's already
covered by item 4's framing goal — "no lifecycle-loop claims" — since
`--from <phase>` implies phase-targeted resumption that doesn't exist) or
left for a follow-up; either is consistent with `spec.md`'s stated proof
criteria (`metta auto --help` must not claim lifecycle-loop behavior), since
an inert `--from` option is itself a lifecycle-loop claim.

`src/cli/commands/execute.ts` (registerExecuteCommand), full option list:
`--resume`, `--change <name>`. Action body:
`resume: options.resume ?? false` is only echoed back in the JSON output
object and gates one `console.log('  Resuming from last checkpoint...')`
line in non-JSON mode — no state is read, no checkpoint is consulted, no
different code path executes. **Confirmed decorative**, matches `spec.md`
exactly.

No dedicated `tests/cli-execute.test.ts` or `tests/cli-auto.test.ts` file
exists in this repo (`find tests -iname "*execute*"` and `*auto*"` return
no command-level test files for these two commands specifically —
`tests/auto-commit.test.ts` is an unrelated git-auto-commit test). No test
file needs trimming for item 4 beyond what's already listed in target 11.

### 9. `WorkflowEngine.extends`/`overrides`/`mergeWorkflows`/`validate()`

Confirmed unused by any shipped or example workflow:
```
grep -rn "extends\|overrides" src/templates/workflows/*.yaml
→ (no results)
```
No `.metta/workflows/` custom-workflow directory exists anywhere in this
repo (`find . -path "*.metta/workflows*"` returns nothing) to check for user
reliance in-repo.

`validate()` callers — only test code:
```
grep -rn "\.validate(" tests/ | grep -i workflow
→ tests/workflow-engine.test.ts:200,217
```
Zero `src/` callers. Matches `spec.md`.

**Documentation caveat worth flagging:** `extends`/`overrides` *is*
documented as a first-class, user-facing authoring capability, not just
speculative internal code:
```
docs/workflows/workflows.md:22   "A workflow may declare `extends: <base>` and an `overrides:` array..."
docs/workflows/workflows.md:299,308,315  (full field reference)
docs/internals/extending.md:165,179,221  (`extends`/`overrides[]` schema description, "lets a tier inherit a base workflow's artifacts")
docs/internals/data-model.md:146  (`extends` field table entry)
docs/internals/architecture.md:31 ("Loads workflow YAML, resolves `extends`...")
```
Every one of these doc pages already states "none of the four built-in
workflows use `extends`" — so no *shipped* workflow needs migration, exactly
as `spec.md`'s Impact section claims — but a project author who wrote a
**custom** workflow YAML using `extends`/`overrides` following this
documentation would have that workflow silently stop working (the schema
would reject the now-removed fields) after this change ships. This is
already acknowledged in scope by `spec.md` item 5 ("Documentation... that
references... requires a follow-on doc regeneration") and the Deletion
Contract's proof criteria for `spec/specs/workflow-engine/spec.md` section 6
removal — flagging it here only so the doc-regeneration follow-on explicitly
includes `docs/workflows/workflows.md`, `docs/internals/extending.md`,
`docs/internals/data-model.md`, and `docs/internals/architecture.md:31`, not
just `docs/api.md`/`docs/architecture.md` as `spec.md`'s Impact section
names generically.

### 10. `src/index.ts` barrel — exact lines to remove

Full current barrel (`src/index.ts`, 33 lines) — lines requiring change:
```
19: export * from './execution/batch-planner.js'      → REMOVE (planBatches/BatchPlan gone; parseTasks/markTaskComplete relocate to src/planning/, not re-exported from root barrel today — see target 4)
20: export * from './execution/execution-engine.js'    → REMOVE
21: export * from './execution/worktree-manager.js'    → REMOVE
22: export * from './execution/fan-out.js'              → REMOVE
28: export * from './delivery/tool-adapter.js'          → KEEP line (still exports SkillContent/ProjectContext/CommandContent/QuestionCapability after ToolAdapter interface is deleted from the file; `export *` needs no edit, only the source file changes)
```
`src/schemas/index.ts` (separate barrel, feeding into `src/index.ts:1`):
```
4:  export * from './auto-state.js'      → REMOVE
10: export * from './plugin-manifest.js' → REMOVE
```
`src/workflow/workflow-engine.js` barrel line (`src/index.ts:6`) is
unaffected — the file stays, only some of its exported symbols
(`mergeWorkflows` is already `private`... actually it's a private class
method, not a module-level export, so no barrel-line change there;
`validate()` is a public method on the exported `WorkflowEngine` class, so
removing it changes the class's shape but not the barrel's export list).

### 11. Test files affected

- **Deleted outright:** `tests/execution-engine.test.ts`,
  `tests/worktree-manager.test.ts`.
- **Trimmed (lose specific cases, keep others):**
  - `tests/batch-planner.test.ts` — loses the `describe('planBatches', ...)`
    block (lines 4-61); keeps `describe('parseTasks', ...)` (lines 63-110),
    relocated alongside the moved source file with an updated import path
    (`../src/planning/batch-planner.js` per the Approach A file layout, or
    wherever the relocated file lands).
  - `tests/schemas.test.ts` — loses the `PluginManifestSchema` describe
    block (~1178-1219) and the `AutoStateSchema` describe block (~747-820,
    exact end line to be confirmed at execution time), plus the
    `AutoStateSchema`/`PluginManifestSchema` entries in its top-of-file
    import list (lines 14, 21).
  - `tests/delivery.test.ts` — loses any case constructing a custom/mock
    `ToolAdapter` object (none use the interface as an importable type today
    besides `SkillContent`/`ProjectContext`, which stay — the file's current
    import at line 8 already only pulls the two content types, not
    `ToolAdapter` itself, so this file may need no case removal at all;
    confirm at execution time by re-reading `tests/delivery.test.ts` in
    full).
  - `tests/workflow-engine.test.ts` — loses the `validate()` scenarios
    (lines ~200, ~217 and their surrounding `describe`/`it` blocks) and the
    `extends`/`overrides` inheritance scenarios (S-17–S-20 equivalents);
    keeps topological-sort, `getNext`, `getStatus`, YAML-loading, and
    cycle-detection cases.
- **Unaffected, no changes needed:** `tests/parallel-wave-computer.test.ts`,
  `tests/tasks-md-parser.test.ts`, `tests/cli-complete.test.ts` (its
  `parseTasks`/`markTaskComplete` usage is exercised indirectly through the
  CLI command, not via a direct `execution/batch-planner.js` import — grep
  confirms no such import in this file).

### 12. `spec/specs/execution-engine/` retirement

```
grep -rn "spec/specs/execution-engine\|specs/execution-engine" src/ tests/ docs/
→ (no results in src/, tests/, or docs/; only spec/specs/execution-engine/spec.md itself matches, i.e. it references its own path implicitly via being that file)
```
Nothing in `src/` references this spec path. **Confirmed safe to
retire** — no code depends on the spec file's existence at runtime (specs
are documentation, not imported), and no other doc cross-links it besides
its own content. Per the change's own H1 note in `spec.md`, retirement
target is `spec/archive/`.

### Artifacts Produced

None — findings inline.
