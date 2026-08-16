# rework-backlog-around-issue-store-as-single-source-truth

## Problem

The backlog and issue stores are structurally parallel but fully disconnected, so the same piece of work ends up described in two files that drift apart. `BacklogStore.add()` (src/backlog/backlog-store.ts) always mints a brand-new `spec/backlog/<slug>.md` from caller-supplied title/description; its `BacklogItem` shape has no field capable of referencing an issue slug, and no code path in either store reads across to the other. The `--source` option looks like a link but is freeform display metadata — nothing validates it against `spec/issues/` and nothing on the `promote`/`done` paths consults it.

This was observed live in the zeus consumer project (2026-08-16): backlogging an already-logged issue via `metta backlog add` required re-entering the title and description into a standalone file completely disconnected from the original `spec/issues/` file. The issue file then received RCA updates while the backlog copy went stale, and resolving one side left the other dangling — two sources of truth for one work item. This is logged as `spec/issues/backlog-feature-duplicates-data-instead-of-referencing.md` (severity: major), which this change absorbs.

A second, related gap: there is no way to group work toward a target. Users prioritizing a release have no milestone concept — no way to say "these issues make up v0.6" and see completion progress — so planning happens outside metta or in ad-hoc backlog ordering.

Affected parties: metta users running `/metta-backlog`, `/metta-issue`, and `/metta-fix-issues` (every consumer project, including zeus with live data in both `spec/backlog/` and `spec/issues/`), and the metta repo itself (8 archived items in `spec/backlog/done/`, 95 resolved issues in `spec/issues/resolved/`).

## Proposal

Make the issue store the single source of truth for all work items. The backlog becomes a **view over issue frontmatter**, not a second store. Add milestones as a first-class lightweight grouping concept.

**1. Issue frontmatter (Zod-validated, all fields optional):**
- Issue markdown files gain YAML frontmatter: `type` (`issue` | `idea`, default `issue`), `backlog` (boolean), `priority` (`high` | `medium` | `low`), `milestone` (slug string), `order` (number).
- Backlogging an issue mutates the EXISTING file's frontmatter in place — never copies content, never mints a parallel file.
- Frontmatter is parsed with the existing `yaml` dependency (already in package.json).
- **No breaking change to plain issues**: files with no frontmatter keep parsing exactly as today via the bold-label metadata block (`**Captured**`, `**Status**`, `**Severity**`).

**2. Milestones (`spec/milestones/<slug>.md`, one file per milestone):**
- Frontmatter: `name`, `target` date, `status` (`open` | `closed`); body = free-form description. Zod-validated.
- CLI/skill support to create and list milestones, assign an issue to a milestone via its frontmatter, and view a milestone's issues with completion progress — resolved (`spec/issues/resolved/*.md` carrying the slug) vs open (`spec/issues/*.md` carrying the slug).
- Dangling milestone references (issue points at a nonexistent milestone) warn, never fail.

**3. Backlog CLI/skill rework (`metta backlog`, `metta-backlog` skill):**
- `list` — reads issue frontmatter; shows items with `backlog: true` (and `type: idea` entries), sorted by priority, then `order`, then captured date.
- `add <issue-slug>` — flips `backlog: true` (plus optional priority/order/milestone) on the existing issue file; for a genuinely new non-issue idea, mints an issue-store entry with `type: idea`.
- `promote <slug>` — hands off to `/metta-fix-issues` for the chosen issue (replacing the current `buildPromoteHandoff` → `/metta-propose` path).
- `done <slug>` — resolves through the issue store's archive path (`spec/issues/resolved/`), not a separate `spec/backlog/done/`.

**4. Store unification:** standalone non-issue backlog items are unified into the issue store with a `type: idea` frontmatter marker. `spec/backlog/` is retired; `BacklogStore`'s standalone-file mint path is removed.

**5. Migration (idempotent):** a migration converts existing `spec/backlog/` items (including `spec/backlog/done/` archives) into issue-store entries with frontmatter (`type: idea`, `backlog: true`), preserving content, mapping archived items to `spec/issues/resolved/`, and archiving the old directory. Running it twice produces no further changes. Must work on consumer projects with live data in both stores (zeus) and on the metta repo itself.

**6. Related surfaces:**
- `metta issue` / `metta-issue` skill accept optional `--milestone` and `--priority` at log time, written as frontmatter.
- `metta status` / `metta progress` show milestone rollups (per-milestone open/resolved counts).

## Impact

- **`src/backlog/backlog-store.ts`** — largest change: standalone-file minting removed; the module becomes a frontmatter-backed view over `IssuesStore` (or is folded into it). Near-total rewrite plus its test file.
- **`src/issues/issues-store.ts`** — gains frontmatter read/write alongside the legacy bold-label parser; `archive()` semantics unchanged but now also serve backlog `done`.
- **`src/cli/commands/backlog.ts`** — `list/show/add/promote/done` all rewired to issue frontmatter; `promote` handoff target changes from `/metta-propose` to `/metta-fix-issues`; `done` auto-commit path now touches `spec/issues/resolved/`.
- **`src/cli/commands/issue.ts` / `fix-issue.ts`** — new `--milestone`/`--priority` options; fix-issue resolution must preserve frontmatter through archive.
- **Skills** — `src/templates/skills/metta-backlog` reworked; `metta-issue` and `metta-fix-issues` updated for frontmatter fields and the new promote handoff.
- **Schemas** — new Zod schemas for issue frontmatter and milestone frontmatter (extends the `schemas` capability).
- **Specs** — `issue-logging` and backlog-related requirements updated; new milestone requirements added.
- **Status surfaces** — `metta status`/`metta progress` gain milestone rollups.
- **Consumer data** — zeus and this repo must run the migration; until then, existing `spec/backlog/` files are read-only legacy input. `spec/backlog/done/` (8 items here) and `spec/issues/resolved/` (95 files) are both in the migration's blast radius.
- **Orchestration guard** — the Tier 2 scoped forms `backlog add/done/promote` keep working; any new subcommands (e.g. milestone commands) need guard-tier decisions.
- **Backward compatibility guarantee** — plain issues with no frontmatter continue to parse and resolve exactly as before; no consumer action required for issue files.

## Out of Scope

- **GitHub (or any external tracker) issue sync** — no import/export/two-way sync with GitHub Issues, Jira, Linear, etc.
- **Web UI / dashboard** — milestone progress is CLI/skill text output only; no visual frontend.
- **Roadmap-feature rework** — the existing `roadmap-feature` capability is untouched; milestones are not merged with or replacing roadmap constructs in this change.
- **Retroactive rewriting of resolved-issue bodies** — the 95 files in `spec/issues/resolved/` keep their existing bold-label content; the migration only relocates backlog archives and adds frontmatter where needed, never rewrites prose or RCA content.
- **Milestone auto-close or date-driven behavior** — no automation that closes milestones on target date or when all issues resolve; `status` is user-managed.
- **Cross-project milestone aggregation** — milestones are per-project; no rollup across multiple consumer repos.
- **Deduplicating pre-existing zeus duplicates by content matching** — the migration converts standalone backlog items mechanically; merging a duplicated backlog copy back into its originating issue is a manual follow-up, not automated fuzzy matching.
