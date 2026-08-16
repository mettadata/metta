# Research: rework-backlog-around-issue-store-as-single-source-truth

Consolidated from three parallel research tracks (full detail in the linked per-track files):

- [Store architecture](research-store-architecture.md)
- [Frontmatter round-trip strategy](research-frontmatter-roundtrip.md)
- [Milestones, rollup surfaces, and migration](research-milestones-migration.md)

## Decision: Fold backlog into IssuesStore; yaml Document-API frontmatter; singular `metta milestone` group; derived-state idempotent `metta backlog migrate`

### Approaches Considered

**Track 1 — store architecture**

1. **Fold backlog behavior into `IssuesStore`; delete `BacklogStore`; backlog view as pure functions in `src/backlog/backlog-view.ts`; separate `MilestonesStore`** (selected) — one store per file tree mirrors the data model; a delegating class would be stateless (violates "classes for stateful modules"); frontmatter competence must land in `IssuesStore` anyway because `archive()` lives there.
2. Thin delegating `BacklogView` class over `IssuesStore` — rejected: stateless class, first store-takes-store DI in `createCliContext`, second API surface that can drift.
3. Unified `WorkItemStore` replacing both stores — rejected: ~1,100+ lines of rename churn across `issue.ts`, `fix-issue.ts`, three test files, barrel, and skills for zero capability beyond `type: idea` frontmatter.

**Track 2 — frontmatter parse/round-trip**

1. **Manual `---` delimiter split + existing `yaml` v2 package + strict Zod; mutations via `YAML.parseDocument()` / `doc.set()` / `doc.toString()` (Document API)** (selected) — no new deps; spec mandates the `yaml` dependency; body carried as a verbatim string slice so byte preservation is true by construction; Document API preserves key order and quoting of untouched fields (prior art: `src/config/config-writer.ts`).
2. `gray-matter` — rejected: frozen at 4.0.3 (~5 years), bundles js-yaml 3.x as a second YAML engine, `stringify` re-serializes all keys (breaks "MUST NOT rewrite untouched fields"). Source: https://security.snyk.io/package/npm/gray-matter
3. `remark-frontmatter` — rejected: only tokenizes ("Doesn't parse the data inside them"), and `remark-stringify` normalizes markdown bodies — hard fail on byte preservation. Source: https://github.com/remarkjs/remark-frontmatter

**Track 3 — milestones + migration**

- **A (CLI shape):** `metta milestone create|list|show` (singular, matches spec text) (selected) over plural `milestones` and over nesting under `backlog` (guard has no three-word scope-key mechanism). Guard: `milestone list/show` → `ALLOWED_TWO_WORD`; `milestone create` → `BLOCKED_TWO_WORD` with mint scope `milestone:create` on the `metta-backlog` skill. Rollups: `Milestones:` text section + optional top-level `milestones`/`milestone_warnings` JSON keys in `status` and `progress` (present only when milestone files exist); per-issue detail only in `milestone show`; percent = `Math.round(resolved/total*100)`, 0-guard for empty milestones.
- **B (migration):** `metta backlog migrate`, Tier 2 scope `backlog:migrate` (selected). Idempotency is derived state — no marker file: absence of `spec/backlog/**/*.md` means no-op. Converted originals are fs-renamed to `spec/archive/backlog-legacy/` (preserving `done/`); conversion prepends frontmatter (`type: idea`, `backlog: true`, priority carried) above legacy content verbatim; open items → `spec/issues/`, `done/` archives → `spec/issues/resolved/`. Slug collisions: report, never overwrite, exit 0. Rejected: `git mv` (fs rename + auto-commit equivalent, works without git) and delete-after-convert (spec-forbidden).
- **C (rollup computation):** thin `MilestonesStore` class for `spec/milestones/` CRUD + pure `computeMilestoneRollups()` over parsed issue records — single-pass bucketing, O(issues + milestones); 95-file scan is single-digit ms, no cache.

### Rationale

All three tracks converge on the same shape: the issue store is the single stateful owner of `spec/issues/` I/O (including frontmatter), everything backlog- and milestone-shaped that is not file I/O is a pure function (functional core, imperative shell), and no new dependencies are added. The frontmatter write path never re-serializes untouched YAML or any part of the markdown body, satisfying the round-trip requirement structurally rather than by test coverage alone. The migration is idempotent by derived state, not markers, and never destroys content.

### Risks surfaced (must be handled in design/tasks)

1. **`spec/archive/backlog-legacy/` pollutes two existing readers** — `src/cli/commands/progress.ts:90` renders every archive dir as a completed change, and `src/release/release-pipeline.ts:161` counts it as an unreleased change that `release cut` would claim. Mitigation: shared `isArchivedChangeDir` date-prefix filter applied in both.
2. **Hook drift** — guard/mint edits must land in BOTH `src/templates/hooks/` and the live `.claude/hooks/` copies in the same commit (known issue `hooks-and-statusline-execute-stale-main-checkout-dist-via`).
3. **Breaking barrel export** — `BacklogStore` is exported from `src/index.ts:11`; its removal is intended but is an API break for external consumers.
4. **`roadmap.ts` hidden dependency** — `backlogStore.show/exists` at `src/cli/commands/roadmap.ts:52, 84, 154` must be repointed to `issuesStore` even though roadmap is otherwise out of scope.
5. **yaml Document API instability around trailing comments near mutated nodes** — acceptable; metta never writes frontmatter comments.

### Artifacts Produced

- [Store architecture research](research-store-architecture.md)
- [Frontmatter round-trip research](research-frontmatter-roundtrip.md) — includes proposed parse/serialize contract (`src/issues/issue-frontmatter.ts`: `splitFrontmatter` / `parseIssueFrontmatter` / `applyFrontmatterPatch`; schema in `src/schemas/issue-frontmatter.ts`)
- [Milestones + migration research](research-milestones-migration.md) — includes migration algorithm sketch and rollup JSON shapes

### Recommendation

Proceed with: `IssuesStore` as the single work-item store (frontmatter-aware via a pure `issue-frontmatter.ts` module using the `yaml` Document API), pure `backlog-view.ts` filter/sort, new `MilestonesStore` + pure rollup function, `metta milestone create|list|show` and `metta backlog migrate` CLI surfaces with the guard-tier assignments above, and the derived-state idempotent migration renaming legacy files to `spec/archive/backlog-legacy/` with collision reporting. Design must explicitly cover the five risks listed.
