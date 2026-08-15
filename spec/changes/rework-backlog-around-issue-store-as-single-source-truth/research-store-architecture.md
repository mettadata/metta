# Research: Store Architecture

**Question:** How should the TypeScript store modules be structured when the backlog becomes a view over issue-file frontmatter and milestones are added as `spec/milestones/<slug>.md`?

## Decision

**Approach 1 — fold backlog behavior into `IssuesStore` and delete `BacklogStore`**, with the backlog *view* logic (filter + sort) implemented as pure functions in `src/backlog/backlog-view.ts` rather than as methods, and a **separate `MilestonesStore` class** in `src/milestones/milestones-store.ts` following the existing per-directory store pattern (`RoadmapStore`, `GapsStore`). Frontmatter parse/serialize lives in a dedicated pure module with its Zod schema in `src/schemas/`.

### Approaches Considered

1. **Fold backlog into `IssuesStore`; delete `BacklogStore`; backlog view as pure functions** — **SELECTED**
2. Thin `BacklogView` class delegating to `IssuesStore` (no own files)
3. New unified `WorkItemStore` replacing both `IssuesStore` and `BacklogStore`

### Rationale

The spec makes the data model unambiguous: there is exactly one file tree for work items (`spec/issues/` + `spec/issues/resolved/`), and every backlog mutation is a frontmatter mutation on an issue file. Once that is true, a `BacklogStore` class has no files, no state, and no invariants of its own — everything it could do is either (a) a frontmatter write that must be owned by `IssuesStore` anyway (archive must carry frontmatter through `spec/issues/resolved/`, so the store that owns `archive()` must understand frontmatter), or (b) a pure filter/sort over records `IssuesStore` already returns. The codebase convention is explicit: *"Classes for stateful modules"* and *"functional core, imperative shell."* A stateless delegating class (Approach 2) violates the first; folding the sort/filter logic into store methods would weaken the second. Approach 1 with a pure `backlog-view.ts` module satisfies both: one store owns all `spec/issues/` I/O, and the backlog-specific ordering rules (priority → order → captured date, per the spec's "Backlog list is a sorted view" requirement) are pure, trivially unit-testable functions.

Approach 3 was rejected because the spec's own language keeps "the issue store" as the named concept throughout (every requirement says "issue store", "issue frontmatter schema", "issue file"); a rename to `WorkItemStore` buys no capability that `type: issue | idea` in frontmatter doesn't already provide, while tripling the mechanical blast radius (every `issuesStore` call site in `issue.ts`, `fix-issue.ts`, three test files totaling ~615 lines, the barrel export, and skill/doc references).

Milestones get their own store class because they *do* own a distinct file tree (`spec/milestones/`) with its own schema and lifecycle — exactly the situation the existing pattern (`IssuesStore` : `spec/issues/` :: `RoadmapStore` : `spec/roadmap.md` :: `GapsStore` : `spec/gaps/`) already handles. The rollup computation (resolved vs. open per milestone) is pure math over two record lists, so it belongs in a pure function (e.g. `src/milestones/milestone-rollup.ts`) that the CLI feeds from `IssuesStore` + `MilestonesStore` reads — no store-to-store dependency needed, which keeps `MilestonesStore` testable in isolation and matches how `roadmap.ts` composes `roadmapStore` + `backlogStore` reads at the command edge today (src/cli/commands/roadmap.ts:52, 84, 154).

### Pros/Cons per Approach

#### Approach 1 — Fold into `IssuesStore` + pure `backlog-view.ts` (selected)

**Pros**
- Code structure mirrors the data model: one store per file tree. No second API surface that can drift from the store it wraps — which is precisely the failure mode this change exists to fix at the data layer.
- `IssuesStore.archive()` must preserve frontmatter regardless of approach (spec: "Archive preserves frontmatter end to end"), so frontmatter read/write competence lands in `IssuesStore` in every approach; Approach 1 adds nothing extra there.
- Pure view functions (`filterBacklog`, `sortBacklog`) satisfy functional-core and are the cheapest possible unit tests — no temp dirs, no fs.
- DI simplifies: `backlogStore` is removed from `CliContext` (src/cli/helpers.ts:35) and its construction (src/cli/helpers.ts:123) is deleted; `milestonesStore` is added in the same shape as its siblings (src/cli/helpers.ts:122–126).
- `src/backlog/` directory survives (holding `backlog-view.ts` and the migration module), preserving discoverability and the 1:1 test mapping (`tests/backlog-view.test.ts`, `tests/backlog-migrate.test.ts` replace `tests/backlog-store.test.ts`).

**Cons**
- `IssuesStore` grows: frontmatter-aware parse/write, `updateFrontmatter(slug, patch)`, an enriched `list()`/`listResolved()`, and idea creation. Mitigated by extracting frontmatter round-trip into a pure sibling module (`src/issues/issue-frontmatter.ts`) so the class stays an I/O shell (~same shape as today's src/issues/issues-store.ts:54–123 with pure helpers at :17–48).
- `CliContext` interface change is a breaking API edit for barrel consumers — `BacklogStore` is exported from src/index.ts:11 and must be removed. This is intended (spec retires the standalone store) but must be flagged as a breaking export change.
- All five `backlogStore` call sites in src/cli/commands/backlog.ts (:22, :38, :68, :94, :128–136) and three in src/cli/commands/roadmap.ts (:52, :84, :154) must be rewired to `issuesStore`. The roadmap sites are unavoidable in every approach that deletes the standalone files — roadmap validates slugs against the backlog today, and after migration those slugs live in `spec/issues/`.

#### Approach 2 — Thin delegating `BacklogView`/`BacklogStore` class

**Pros**
- Smallest diff in `backlog.ts` and `roadmap.ts`: `ctx.backlogStore.show/exists` keep resolving (now against issue files under the hood).
- `tests/backlog-store.test.ts` survives with edits rather than replacement.
- Familiar name retained in `CliContext`.

**Cons**
- A class with zero owned state contradicts "Classes for stateful modules"; its only field would be a reference to `IssuesStore`.
- Two API surfaces for one file tree invites drift: e.g. `BacklogView.done()` vs `IssuesStore.archive()` must stay behaviorally identical or backlog `done` and fix-issue resolution diverge on frontmatter preservation — recreating the two-sources-of-truth bug one layer up.
- DI gets ordered: `createCliContext` must construct `IssuesStore` first and inject it (src/cli/helpers.ts:122–123 currently constructs each store independently from `specDir`; no existing store takes another store as a dependency — this would be the first, a new pattern for no capability gain).
- The delegation methods are pass-throughs plus a filter/sort — the exact code that the pure-function module in Approach 1 holds, but wrapped in a class and doubled in test surface.

#### Approach 3 — Unified `WorkItemStore`

**Pros**
- One store, one record type (`WorkItem` with `type: issue | idea`), conceptually clean greenfield design.
- No naming asymmetry between issues and ideas.

**Cons**
- Maximum blast radius: renames every `issuesStore` reference in src/cli/commands/issue.ts (:27, :55, :71), src/cli/commands/fix-issue.ts (:37, :46–47, :73, :82, :110), src/cli/helpers.ts (:16, :34, :122), the barrel (src/index.ts:9), and three test files (tests/issues-store.test.ts — 110 lines, src/issues/issues-store.test.ts — 53 lines, tests/cli-issue-backlog.test.ts — 452 lines), plus the `metta-issue`/`metta-fix-issues` skill templates that name the store's behavior.
- Contradicts the spec's stated backward-compatibility posture: the spec text consistently names "the issue store" as the surviving concept; a rename churns docs/specs (`issue-logging` capability, 40 requirements) for zero behavioral difference.
- `type: idea` frontmatter already unifies the data; the class rename is cosmetic.
- Riskiest migration for a change that must land alongside a data migration on live consumer projects (zeus).

### Fit with existing code

- **Store-per-directory pattern**: `IssuesStore` (src/issues/issues-store.ts:54), `BacklogStore` (src/backlog/backlog-store.ts:52), `RoadmapStore`, `GapsStore` are all classes taking `specDir`, wrapping `StateStore` for raw I/O (src/issues/issues-store.ts:57–59). `MilestonesStore` slots in identically; `createCliContext` adds one line next to src/cli/helpers.ts:122–126.
- **Functional core precedent**: both existing stores already keep `formatIssue`/`parseIssue` (src/issues/issues-store.ts:17–48) and `formatItem`/`parseItem` (src/backlog/backlog-store.ts:19–50) as module-level pure functions with the class as I/O shell. The frontmatter round-trip module and `backlog-view.ts` extend this exact pattern.
- **Schema placement**: Zod schemas live in `src/schemas/` with a barrel (src/schemas/index.ts); `issue-frontmatter.ts` and `milestone-frontmatter.ts` go there, validated on every read/write per the state-store convention (src/state/state-store.ts:33–59 shows the read/write validation shape, though frontmatter files need the raw-read + parse + validate variant since they are markdown, not pure YAML).
- **Guard compatibility**: the guard matches literal command text, not store internals — `['backlog', new Set(['add', 'done', 'promote'])]` at src/templates/hooks/metta-guard-bash.mjs:56 and the mint scope map `'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote']` at src/templates/hooks/metta-session-mint.mjs:30. Keeping the CLI surface `metta backlog add/done/promote` (which all approaches do) keeps the guard working unchanged. New scoped forms `backlog:migrate` and `milestone:create` must be added to both files regardless of store architecture — this is orthogonal to the approach choice.
- **Command blast radius (Approach 1)**: `backlog.ts` is rewritten anyway per the spec (new `--new` flag, frontmatter semantics, promote → `/metta-fix-issues`, done → issue archive path — the `spec/backlog/done` git-add at src/cli/commands/backlog.ts:141 becomes `spec/issues`/`spec/issues/resolved`, matching the existing pattern in src/cli/commands/fix-issue.ts:49). `issue.ts` gains `--milestone`/`--priority` options feeding `IssuesStore.create` — additive. `fix-issue.ts` needs no call-site changes at all: it uses `exists/show/archive/remove` whose signatures survive; frontmatter preservation lands inside `archive()` (src/issues/issues-store.ts:109–117 already copies raw content verbatim, so frontmatter passes through today — the work is in `show()`/`list()` learning to strip/parse it).
- **Promote handoff**: `buildPromoteHandoff` (src/cli/promote-handoff.ts:5) is shared by backlog promote and `roadmap next` (src/cli/commands/roadmap.ts:166). The spec changes only backlog promote's target to `/metta-fix-issues`; roadmap is explicitly out of scope, so `backlog.ts` stops importing the helper while `roadmap.ts` keeps it — the "single edit point" comment in that file becomes stale and should be updated.
- **Tests / 1:1 ratio**: replacing `tests/backlog-store.test.ts` (101 lines) with `tests/backlog-view.test.ts` + `tests/backlog-migrate.test.ts`, adding `tests/milestones-store.test.ts`, `tests/issue-frontmatter.test.ts` (or colocated, matching src/issues/issues-store.test.ts), and extending `tests/issues-store.test.ts` keeps the ratio intact. `tests/cli-issue-backlog.test.ts` (452 lines) needs substantial rework in every approach since the CLI behavior itself changes.

### Complexity estimate

| Approach | New modules | Modified modules | Deleted | Test churn | Risk |
|---|---|---|---|---|---|
| 1 (selected) | 5 (frontmatter, backlog-view, backlog-migrate, milestones-store, milestone-rollup + 2 schemas) | 6 (issues-store, helpers, backlog.ts, issue.ts, roadmap.ts, index.ts) | backlog-store.ts | ~600 lines touched | Medium — contained; store API extended, not renamed |
| 2 | 5 + kept view class | 7 (adds DI-ordering change in helpers) | mint path only | ~550 lines | Medium — plus permanent drift risk between two APIs |
| 3 | 6 | 10+ (every issue call site + skills/docs) | both stores | ~1,100+ lines | High — rename churn atop a live-data migration |

Approach 1 estimated at **M** (3–5 focused modules plus command rewiring), dominated by the frontmatter round-trip module (key-order + body byte preservation is the only genuinely subtle code — note: `YAML.parse`/`YAML.stringify` on a plain object preserves string-key insertion order, but the safest implementation splits the file on `---` delimiters and re-serializes only the frontmatter block, never touching body bytes) and the idempotent migration.
