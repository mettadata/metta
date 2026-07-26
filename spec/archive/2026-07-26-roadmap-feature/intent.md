# roadmap-feature

## Problem

Metta has a backlog (`spec/backlog/*.md`, managed by `BacklogStore` and the `metta backlog` command group) but no way to express **order of execution**. The backlog is a flat, priority-tagged pool: `backlog list` prints items with a `high/medium/low` label, but nothing records "build X, then Y, then Z." The original CLI proposal (docs/proposed/09-cli-integration.md lines 69-72 and docs/proposed/00-quickstart-usage.md lines 535-539) reserved a `metta roadmap` command group for exactly this — show roadmap status, add a specced feature, reorder, and activate the next feature into `spec/changes/` — but it was never implemented.

Who is affected:

- **The project maintainer** planning multi-change milestones (e.g. the v0.2 subtractive milestone) has to keep the intended sequence in their head, in memory files, or in ad-hoc notes, because neither `spec/backlog/` nor any state file captures ordering.
- **AI orchestrator sessions** (`/metta-next`, `/metta-progress`, `/metta-auto`) cannot answer "what should we build next?" from project state — they can only enumerate the unordered backlog, so sequencing decisions get re-litigated every session.
- **The backlog promote flow** requires the caller to already know which slug to promote; there is no "take the top of the queue" operation.

## Proposal

Implement the `metta roadmap` command group as a thin ordered-list layer over the existing backlog. A roadmap entry is a reference (by slug) to an existing `spec/backlog/<slug>.md` item, plus its position and an optional note.

### CLI surface (v1, single current-milestone list)

Registered via a new `registerRoadmapCommand(program)` in `src/cli/commands/roadmap.ts`, following the structure of `src/cli/commands/backlog.ts`:

1. **`metta roadmap`** (default action, read-only) — status view of the ordered feature list: position, backlog slug, title (resolved from the backlog item), and note. Supports the global `--json` flag like every other command. Entries whose backlog item has been removed since being added are surfaced as dangling rather than crashing the view.
2. **`metta roadmap add <backlog-slug>`** — append an existing backlog item to the end of the roadmap, with an optional `--note <text>`. Rejects slugs not present in `spec/backlog/` (verified via `BacklogStore.exists`) with the standard JSON error envelope `{error: {code, type, message}}`, `type: 'not_found'`, exit code 4. Rejects duplicates already on the roadmap.
3. **`metta roadmap reorder <slug...>`** — **non-interactive**: the caller passes the complete new order as explicit positional args. The input MUST be a full permutation of the current roadmap slugs (same set, no additions, no omissions, no duplicates); anything else is rejected with exit code 4 and **no partial write** — the roadmap file is only rewritten after validation passes.
4. **`metta roadmap next`** — activate the top roadmap entry into `spec/changes/` via the same activation path `backlog promote` uses (resolve the backlog item and hand off to the propose flow), then remove the entry from the roadmap. On an empty roadmap this is a friendly no-op: `{"next": null}` in JSON mode, an informative message in text mode, exit code 0.

### Persistence

A single markdown file `spec/roadmap.md` — no new YAML state file. It is managed by a new `RoadmapStore` class in `src/roadmap/roadmap-store.ts` modeled directly on `src/backlog/backlog-store.ts`: constructor takes `specDir`, all reads/writes go through `StateStore.readRaw`/`writeRaw`, and every slug crossing the boundary is validated with `assertSafeSlug` from `src/util/slug.js`. Format/parse are pure functions in the module (functional core), file I/O at the store edge. A matching test file `test/roadmap/roadmap-store.test.ts` maintains the 1:1 test-to-source ratio, plus CLI-level tests for the command group.

### Branch and commit discipline

The mutating operations (`add`, `reorder`, `next`) call `assertOnMainBranch` from `src/cli/helpers.ts` with the `--on-branch <name>` escape hatch, exactly as `backlog add`/`backlog done` do, and auto-commit `spec/roadmap.md` via the existing `autoCommitFile` helper. The read-only default view performs no writes and no branch check.

### Guard and skill surface

- **Guard:** the two-word mutating forms `roadmap add`, `roadmap reorder`, `roadmap next` join the **Tier 2 session-tier** allowlist in `.claude/hooks/metta-guard-bash.mjs`, alongside the existing `backlog add/done/promote` entries (the blocked-forms set around line 50 and the `"<sub>:<third>"` scope-key handling around line 214). The bare read-only `roadmap` view joins the unguarded read-only pattern (like `backlog list/show` at line 32).
- **Skill:** a new `/metta-roadmap` skill at `.claude/skills/metta-roadmap/` mirroring the existing `metta-backlog` skill — it mints the session credential and wraps the mutating operations so AI orchestrators never call the CLI directly.

### Error contract

All failures use the existing JSON envelope `{error: {code, type, message}}` with exit code 4 for not-found and validation failures, matching the backlog command group's behavior (`type: 'not_found'`, `'branch_guard'`, plus roadmap-specific types such as `'invalid_reorder'` and `'duplicate_entry'`).

## Impact

- **New code, no behavioral changes to existing modules:** `src/roadmap/roadmap-store.ts` and `src/cli/commands/roadmap.ts` are new; `BacklogStore` is consumed read-only (`exists`, `show`) and is not modified.
- **CLI registration:** the roadmap command group is registered in the CLI entry point alongside the other `register*Command` calls, and `RoadmapStore` is added to the barrel export at `src/index.ts` and to `createCliContext` in `src/cli/helpers.ts` (additive field on `CliContext`).
- **Guard hook:** `.claude/hooks/metta-guard-bash.mjs` gains three Tier 2 entries and one read-only entry. Existing backlog/changes guard entries are untouched; risk is limited to the allowlist tables.
- **Activation path coupling:** `roadmap next` reuses the `backlog promote` activation path. Today that path resolves the item and emits the `metta propose "<title>"` handoff (src/cli/commands/backlog.ts lines 85-104); `roadmap next` inherits that exact behavior, so any future change to promote's activation semantics automatically applies to `roadmap next`.
- **Skills directory:** one new skill directory `.claude/skills/metta-roadmap/`; template files are copied to `dist/` at build time per the existing template convention.
- **Docs:** `spec/roadmap.md` becomes a new tracked file under `spec/`; generated docs (CLAUDE.md tables, docs/api.md) pick up the new capability on the next refresh.
- **Not affected:** existing `metta backlog` commands keep their current behavior verbatim; the statusline, workflow engine, gate runner, and state schemas are unchanged.

## Out of Scope

- **Multi-milestone support** — v1 is a single current-milestone ordered list; no milestone names, groupings, or dates.
- **Interactive TTY reordering** — the original proposal sketched `roadmap reorder` as interactive; v1 is explicitly non-interactive (full permutation passed as args).
- **Any changes to existing backlog command behavior** — `backlog add/list/show/promote/done` are untouched, including promote's current propose-handoff activation semantics.
- **MCP or plugin surface** for the roadmap.
- **Statusline integration** — the Claude statusline does not display roadmap state.
- **Automatic roadmap population** — items are added explicitly via `roadmap add`; no auto-import from backlog priorities.
- **Removing entries other than via `next`** — a dedicated `roadmap remove` operation is deferred (dangling entries are surfaced in the status view, and `reorder` cannot drop entries by design).
