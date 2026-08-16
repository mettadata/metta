# Implementation Summary: rework-backlog-around-issue-store-as-single-source-truth

## What was built

The issue store (`spec/issues/`) is now the single source of truth for all work items. The backlog is a pure view over issue-file YAML frontmatter; milestones are a first-class lightweight grouping concept; legacy `spec/backlog/` data was migrated on this repo itself.

13 tasks across 7 batches, all executed and committed on branch `metta/rework-backlog-around-issue-store-as-single-source-truth`:

- **Schemas** — `src/schemas/issue-frontmatter.ts` (`type` issue|idea, `backlog`, `priority`, `milestone`, `order`; `.strict()`, defaults) and `src/schemas/milestone-frontmatter.ts` (`name`, `target` real-calendar-date, `status` open|closed).
- **Frontmatter round-trip** — pure `src/issues/issue-frontmatter.ts` (`splitFrontmatter` / `parseIssueFrontmatter` / `applyFrontmatterPatch`) using the existing `yaml` Document API; body carried as verbatim slice (byte preservation structural); 37 module tests.
- **IssuesStore** — frontmatter-aware `show`/`list` (`IssueRecord`), `createIdea`, `updateFrontmatter` (`{ changed }`), `listResolved`, `create()` optional priority/milestone, `archive` carries frontmatter into `spec/issues/resolved/` and absorbs the `**Shipped-in**` stamp. All existing signatures preserved — zero `fix-issue.ts` call-site changes. Legacy frontmatter-less issues parse byte-unchanged.
- **Backlog view** — pure `src/backlog/backlog-view.ts` filter (`backlog === true`) + deterministic sort (priority → order → captured → slug).
- **Milestones** — `MilestonesStore` (`spec/milestones/<slug>.md`), pure `computeMilestoneRollups()` (percent, dangling-ref warnings never fail), `metta milestone create|list|show` CLI, rollups surfaced in `metta status` and `metta progress` via conditional `milestones`/`milestone_warnings` keys (absent when no milestone files exist — pre-change output structurally identical).
- **Backlog CLI rework** — `add` flips frontmatter on the existing issue (or mints `type: idea` with `--new`), `list` never reads `spec/backlog/`, `promote` emits the `/metta-fix-issues <slug>` handoff, `done` archives through `spec/issues/resolved/`, new `migrate` subcommand. `BacklogStore` deleted; barrel exports updated (breaking export change, flagged for release notes). `roadmap.ts` repointed to `issuesStore`.
- **Migration** — `migrateLegacyBacklog()`: derived-state idempotent, create-only writes, originals fs-renamed to `spec/archive/backlog-legacy/`, collisions reported never overwritten. Handles pre-BacklogStore legacy frontmatter blocks (bug found and fixed during self-migration).
- **Issue logging** — `metta issue --priority/--milestone` written as frontmatter at log time; dangling milestone warns, never fails.
- **Guard/hooks** — `milestone list/show` allowed; `milestone create` + `backlog migrate` Tier-2 blocked with mint scopes on `metta-backlog`; template and live hook copies byte-identical.
- **Skills** — `metta-backlog` reworked (view-over-frontmatter framing, migrate + milestone menus), `metta-issue` optional priority/milestone question, `metta-fix-issues` frontmatter/idea touch points; all template↔deployed pairs byte-identical.
- **Archive-scan hardening** — `isArchivedChangeDir()` filter in `progress.ts` and `release-pipeline.ts` so `spec/archive/backlog-legacy/` is never treated as a completed/unreleased change.
- **Self-migration executed** — this repo's 8 archived backlog items converted to `spec/issues/resolved/` with `type: idea` frontmatter; second run no-op; `spec/backlog/` removed.

## Gate results

- `npx vitest run` — 127 files, 2284 tests, all passing
- `npx tsc --noEmit` — clean
- Hook byte-identity and skill template↔deployed identity — verified by diff and tests

## Notable deviations from plan

1. Migration gained a third collision candidate (existing archive copy) and wholesale replacement of pre-BacklogStore legacy frontmatter blocks — both defensive, both tested.
2. `toMilestoneCountsRow` exported from `milestone.ts` so status/progress reuse the exact counts-row shape (separate refactor commit).
3. `tests/metta-session-mint.test.ts` scope table updated as a direct consequence of the mint-scope extension.

## Breaking changes / risks

- `BacklogStore` removed from the public barrel (`src/index.ts`) — intended, flag in release notes.
- Consumer projects (zeus) must run `metta backlog migrate` once; until then their `spec/backlog/` files are inert legacy input.
