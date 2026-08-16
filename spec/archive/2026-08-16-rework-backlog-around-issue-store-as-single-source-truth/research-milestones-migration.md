# Research: milestone store, rollup surfaces, and the backlog migration command

Scope: sub-areas A (milestone CLI + rollup surfaces), B (migration command), C (rollup computation + module shape). Grounded against the worktree at `.metta/worktrees/rework-backlog-around-issue-store-as-single-source-truth` and live legacy data in the main checkout (`spec/backlog/done/`, 8 items; `spec/issues/resolved/`, 95 files). All findings are from local code reading; no external-doc questions arose, so no web citations were needed.

---

## Decision A: Milestone CLI shape and rollup surfaces

**Decision:** Singular top-level command group `metta milestone create|list|show` (matching spec.md's ADDED milestone requirement verbatim). Rollups surface as (1) a `Milestones:` text section plus a `milestones` JSON key in `metta progress`, (2) the same optional `milestones` key and text section in `metta status`, and (3) full per-issue detail only in `metta milestone show`. Guard tiers: `milestone list`/`show` join `ALLOWED_TWO_WORD`; `milestone create` joins `BLOCKED_TWO_WORD` with mint scope `milestone:create` added to the `metta-backlog` skill's `SKILL_SCOPES` entry (no new skill needed for v1).

### Approaches Considered

1. **`metta milestone <verb>` (singular command group)** — new registration in `src/cli/index.ts` alongside `registerBacklogCommand`, own file `src/cli/commands/milestone.ts`.
2. **`metta milestones <verb>` (plural)** — mirrors the existing `metta issues list` plural precedent.
3. **Fold under backlog: `metta backlog milestone <verb>`** — three-word forms nested inside the existing backlog command.

### Rationale

- The spec requirement "Milestone store with Zod-validated frontmatter and CLI" already names the surface `metta milestone create/list/show` and fixes the tier assignments (create = Tier 2 scoped two-word form; list/show = read-only allowed). Research confirms this shape is implementable with no guard redesign: the guard (`src/templates/hooks/metta-guard-bash.mjs`, mirrored in `.claude/hooks/metta-guard-bash.mjs`) keys two-word forms as `<sub>:<third>`, so `milestone:create` slots into the existing `BLOCKED_TWO_WORD` map and `metta-session-mint.mjs` `SKILL_SCOPES` without new mechanism. Bare `metta milestone` (no third word) stays fail-closed by default since `milestone` is not in `ALLOWED_BARE` — correct, there is no bare read view.
- Command-group naming precedent is mixed (`issues` plural, `backlog`/`roadmap`/`gate` collective/singular, `changes`/`gaps` plural), so neither singular nor plural violates convention; following the spec text avoids a spec amendment for zero benefit.
- Option 3 (nesting under backlog) was rejected: the guard has no three-word scope-key mechanism (`<sub>:<third>` only), milestones are conceptually issue-store groupings rather than backlog features (an issue can carry `milestone:` without `backlog: true`), and Commander sub-sub-commands would be a new pattern in this codebase.
- **Both hook copies must be edited**: `src/templates/hooks/*.mjs` (shipped, copied to `dist/` at build) and `.claude/hooks/*.mjs` (the live installed copy this repo actually executes). A known issue (`hooks-and-statusline-execute-stale-main-checkout-dist-via`) shows the live copies drift; the execute phase must update both in the same commit.

**Rollup surface placement:**

- `metta progress` (`src/cli/commands/progress.ts`): text section after the `Completed (N):` block and before the summary line — a `Milestones:` block, one line per milestone: `v0-6  ▸ 1/3 resolved (33%)  target 2026-09-30`. Closed milestones render with a distinct marker but are still listed (spec draws no open-only line; simplest is list all, sorted open-first then by slug). JSON gains a top-level key, present only when at least one milestone file exists (spec: "when no milestone files exist... output identical in structure to pre-change output"):

  ```json
  "milestones": [
    { "slug": "v0-6", "name": "v0.6", "status": "open", "target": "2026-09-30",
      "open": 2, "resolved": 1, "total": 3, "percent": 33 }
  ],
  "milestone_warnings": ["issue 'x' references unknown milestone 'v9-9'"]
  ```

  (`milestone_warnings` also only present when non-empty; dangling refs must warn but never fail per spec.)
- `metta status` (`src/cli/commands/status.ts`): status JSON is change-centric — `ChangeStatusJson` per change, or `{ changes: [...] }` for multiples, or `{ changes: [], message }` when idle. Recommendation: append the same optional `milestones` (+ `milestone_warnings`) top-level key to whichever envelope is emitted, including the no-active-changes envelope, and print the same text section after the per-change block. Do **not** embed milestone data inside each change object — milestones are project-level, and duplicating them per change would bloat multi-change output.
- `metta milestone show <slug>`: the only surface that lists individual issues (slug, title, open/resolved), plus the same rollup numbers. `status`/`progress` show counts only — keeps their output bounded as issue counts grow.
- Percentage: `Math.round((resolved / total) * 100)`, `0` when total is 0 (spec: empty milestone renders 0 resolved / 0 open, must not fail — guard the division).

### Pros/Cons

**`metta milestone ...` (chosen):**
- Pros: matches spec text exactly; guard integration is two map entries + one mint scope; own command file follows the one-file-per-command layout of `src/cli/commands/`; leaves room for future verbs (`close`, `assign`) as additional scope keys.
- Cons: adds a fifth naming style to an already-mixed singular/plural command family; users may type `milestones` (mitigable with a Commander alias — note an alias must also be recognized by the guard's parser or simply not registered; recommend **no alias** to keep the guard surface single-spelling).

**`metta milestones ...`:**
- Pros: reads naturally for `list`.
- Cons: reads badly for `create`/`show`; diverges from spec text, forcing a spec edit; no functional gain.

**`metta backlog milestone ...`:**
- Pros: single skill/guard umbrella.
- Cons: guard cannot scope three-word forms without new mechanism; wrong conceptual home; novel Commander nesting pattern.

---

## Decision B: Migration command — `metta backlog migrate`, derived-state idempotency, report-only collisions, relocate originals to `spec/archive/backlog-legacy/`

**Decision:** `metta backlog migrate` (a fourth subcommand in `registerBacklogCommand`), Tier 2 scoped as `backlog:migrate` (added to `BLOCKED_TWO_WORD['backlog']` and to `SKILL_SCOPES['metta-backlog']`). Idempotency is **derived from filesystem state** — no marker file: absence of any `spec/backlog/**/*.md` means "nothing to do". Collisions are reported and skipped, never overwritten, and the colliding legacy file stays in place. Successfully converted originals are **moved (fs rename, not `git mv`) to `spec/archive/backlog-legacy/`** (preserving the `done/` subpath), empty legacy directories are removed afterwards, and the standard swallow-on-failure auto-commit stages the touched paths. **This requires a small companion fix: `progress.ts` and `release-pipeline.ts` must skip non-`YYYY-MM-DD-` archive directories** (detailed below).

### Approaches Considered

**Command shape**
1. `metta backlog migrate` — subcommand of the existing backlog group.
2. `metta migrate backlog` — new top-level `migrate` group.

**Idempotency detection**
1. Derived state: legacy dir empty (or absent) → no-op; per-file, target-exists → skip.
2. Marker file (e.g. `.metta/backlog-migrated`) checked before running.

**Fate of the old directory**
1. Move originals to `spec/archive/backlog-legacy/` (fs rename + git add in the auto-commit).
2. `git mv` the whole directory.
3. Delete after conversion (git history as the archive).

### Rationale

- **Shape:** the spec already mandates `metta backlog migrate` and its guard tier. It is also the pragmatically better option: the guard/mint plumbing for `backlog:*` scope keys exists, the `metta-backlog` skill is the natural driver, and a top-level `migrate` group would be a one-verb command family with its own guard entry and no other tenants.
- **Idempotency — derived, no marker.** The migration's inputs and outputs are all on disk, so state can be recomputed exactly: a legacy file that was converted no longer exists under `spec/backlog/` (it was moved to the archive location); a legacy file that collided still exists there next to its unrelated `spec/issues/` twin. A marker file would (a) lie the moment a user restores or adds a `spec/backlog/` file, (b) need its own schema/validation per project conventions, and (c) duplicate what git already records. Crucially, derived state makes the collision case naturally re-reportable: a second run with unresolved collisions re-reports the same conflicts and changes zero bytes — still idempotent, still exit 0. The spec's second-run scenario ("no files created, modified, or moved, reports nothing to do, exit 0") falls out of "no `.md` files remain under `spec/backlog/`".
- **Collisions:** target slug already present in `spec/issues/` **or** `spec/issues/resolved/` → report `{ slug, legacy_path, existing_path }`, touch neither file, continue with remaining items, exit 0. Exit 0 (not an error code) because the spec's collision scenario demands report-not-fail and the run as a whole completed its pass; the collision list in `--json` output lets the skill surface follow-ups. Because converted originals are moved out, "remaining legacy file + existing target" is unambiguously a collision on re-runs — no risk of re-reporting an already-converted item.
- **Archive location — the load-bearing finding.** Five modules read `spec/archive/` and their tolerance of a non-change directory differs:
  - `src/cli/commands/progress.ts:90` — lists **all** subdirectories as completed changes and renders `name.slice(0,10)` as a date → a `backlog-legacy` dir would appear in the Completed list as garbage. **Needs a date-prefix filter.**
  - `src/release/release-pipeline.ts:161` (`listArchiveDirs`) — every archive dir not claimed in `spec/releases.yaml` counts as an unreleased change in `release status`, and would be claimed by the next `release cut`. **Needs the same filter.**
  - `src/docs/doc-generator.ts:~385` — already skips non-`YYYY-MM-DD-` dirs, but emits a warning per run ("does not have YYYY-MM-DD prefix — skipped"). Acceptable; optionally special-case `backlog-legacy` to skip silently.
  - `src/util/ceremony-metrics.ts` — skips dirs without a valid `.metta.yaml` (try/catch). Safe.
  - `src/ship/merge-safety.ts:95` — suffix-matches `-<changeName>`. Safe.

  Recommendation: introduce a tiny shared predicate (e.g. `isArchivedChangeDir(name)` testing `/^\d{4}-\d{2}-\d{2}-/` in `src/util/`) and apply it in `progress.ts` and `release-pipeline.ts`. Cost is ~10 lines + tests, and `progress.ts` is already being modified for milestone rollups in this change. With that fix, `spec/archive/backlog-legacy/` is the right home: it matches the spec's own example ("e.g. under an archive location"), keeps the provenance files committed and greppable, and keeps `spec/` self-contained (no `.metta/` involvement — parts of `.metta/` are gitignored, so archiving there risks silent loss).
- **Rejected: `git mv`.** The stores operate through `StateStore`/`node:fs` and every existing command treats git as best-effort (swallowed errors in `backlog done`, `autoCommitFile`). An fs `rename` followed by the standard `git add <paths>` in the auto-commit produces an identical index state to `git mv`, and keeps the migration functional in non-git projects. **Rejected: delete-after-convert.** The spec explicitly forbids it ("rather than silently deleting it"), and the zeus incident history shows why recoverable provenance matters here.
- **Content mapping (from real data):** the 8 files in `/home/utx0/Code/metta/spec/backlog/done/` follow exactly the `formatItem` shape in `src/backlog/backlog-store.ts` — `# Title`, `**Added**: <date>`, optional `**Source**:`, `**Status**: backlog` (yes, still `backlog` even in `done/`), optional `**Priority**: <level>`, blank line, body (sometimes just the title repeated). Recommended conversion: **prepend a frontmatter block above the original file content verbatim** — `type: idea`, `backlog: true` (active items only; done items get `type: idea` only, matching the spec), `priority: <level>` when the legacy `**Priority**` line parses to high/medium/low. This is the zero-rewrite-risk reading of "preserve each file's descriptive body content". Consequences to accept: the legacy `**Priority**`/`**Added**`/`**Status**` bold labels remain in the body (frontmatter is authoritative; these items are frozen), and the frontmatter-aware issue parser should fall back to `**Added**` when `**Captured**` is absent so backlog-list date sorting works for migrated ideas. The alternative — rewriting `**Added**` → `**Captured**` and stripping migrated labels — produces cleaner files but edits content the spec says not to rewrite; not recommended.

### Migration algorithm sketch

1. Resolve `specDir`; enumerate `spec/backlog/*.md` (active) and `spec/backlog/done/*.md` (archived). If both sets are empty (or the dir is absent): print/emit `nothing to do`, exit 0. *(Derived idempotency — no marker.)*
2. `assertOnMainBranch` with `--on-branch` escape hatch, matching `backlog add`/`done` (migration rewrites tracked spec files; same guard applies).
3. For each **active** item `spec/backlog/<slug>.md`:
   a. If `spec/issues/<slug>.md` **or** `spec/issues/resolved/<slug>.md` exists → record collision `{slug, legacy, existing}`; leave both files untouched; continue.
   b. Else parse via the existing `parseItem` (title, added, priority, body); write `spec/issues/<slug>.md` = frontmatter (`type: idea`, `backlog: true`, `priority` if present) + original content verbatim.
   c. Move (fs `rename`) the original to `spec/archive/backlog-legacy/<slug>.md` (mkdir -p first).
4. For each **done** item `spec/backlog/done/<slug>.md`: same collision check against both issue dirs; on clear, write `spec/issues/resolved/<slug>.md` = frontmatter (`type: idea`) + original content verbatim (any existing `**Shipped-in**` stamp rides along in the body); move original to `spec/archive/backlog-legacy/done/<slug>.md`.
5. After the pass, remove `spec/backlog/done/` and `spec/backlog/` **only if empty** (collision stragglers keep the dir; `backlog list` no longer reads it, per the "leftover legacy file" spec scenario).
6. Auto-commit (swallow-on-failure, per the `backlog done` pattern): `git add spec/backlog spec/archive/backlog-legacy spec/issues && git commit -m "chore: migrate legacy backlog into issue store"`.
7. Report: converted-active / converted-done counts, per-collision lines, archive destination. `--json`: `{ converted: {active, done}, collisions: [...], archived_to, committed, commit_sha }`. Exit 0 whether or not collisions were found; nonzero only on I/O failure.
8. **Re-run behavior:** step 1 short-circuits when fully migrated; with stragglers, steps 3a/4 re-report identical collisions and steps 3b–6 write nothing → zero changes, exit 0.

### Pros/Cons

**Derived idempotency (chosen):** Pros — cannot desync from reality; no new state file/schema; collision re-reporting is free. Cons — "nothing to do" is indistinguishable from "never had a backlog" (harmless; the message covers both).
**Marker file:** Pros — O(1) check. Cons — stale-marker hazard; extra validated state; still needs the per-file checks anyway to be safe. Rejected.
**`spec/archive/backlog-legacy/` (chosen):** Pros — spec-conformant, committed, discoverable next to other archived history. Cons — requires the `progress.ts`/`release-pipeline.ts` date-prefix filter (small, and progress is already in this change's blast radius).
**Delete after convert:** Pros — cleanest tree. Cons — spec-forbidden; provenance only via git archaeology. Rejected.

---

## Decision C: Rollup computation — single-pass scan, pure rollup functions + a thin `MilestonesStore` class

**Decision:** A `MilestonesStore` class in `src/milestones/milestones-store.ts` handling milestone-file I/O only (`create`/`list`/`show`/`exists`, Zod-validated frontmatter, wired into `createCliContext` in `src/cli/helpers.ts` like the other stores), plus **pure functions** in `src/milestones/milestone-rollup.ts` (e.g. `computeMilestoneRollups(milestones, openIssues, resolvedIssues): { rollups, warnings }`) that take already-parsed issue frontmatter records and group them by milestone slug in one pass. Issue-file scanning stays in `IssuesStore` (which is gaining frontmatter parsing in this change anyway) via a method that lists open **and** resolved entries with their frontmatter. Scan cost at current repo scale (95 resolved + ~1 open) is negligible; no cache or index.

### Approaches Considered

1. **Pure rollup functions + store for I/O (chosen)** — store reads files, function computes; CLI wires them.
2. **Fat `MilestonesStore`** — the store itself scans `spec/issues/` and `spec/issues/resolved/` and returns rollups.
3. **No class at all** — free functions for both milestone I/O and rollups.

### Rationale

- Project conventions pin most of this: "Classes for stateful modules" and the uniform `IssuesStore`/`BacklogStore`/`RoadmapStore`/`GapsStore` shape (constructor takes `specDir`, wraps `StateStore`, registered in `createCliContext`) make a `MilestonesStore` class the consistent choice for milestone-file CRUD; "functional core, imperative shell" makes the rollup math a pure function. Option 2 would couple the milestone store to issue-store file layout and parsing — two stores reaching into one directory tree is exactly the cross-store entanglement this change is eliminating. Option 3 breaks the store convention for no gain.
- **Single pass, not per-milestone scans.** `metta status`/`progress` need rollups for *all* milestones; `milestone show` needs one. The rollup function should take the full issue list once and bucket by `frontmatter.milestone`, making status/progress O(issues + milestones) with exactly one directory scan of each issue dir — never N scans for N milestones. `milestone show` reuses the same function and picks its slug from the result.
- **Scan cost is a non-issue at current scale.** The metta repo's worst case is 95 resolved files + open issues, each ~1–4 KB. The existing stores already do full-directory sequential `readRaw` loops on every `list()` (see `IssuesStore.list`), so one more scan of ~100 small files (~200–400 KB total read + trivial YAML parses) adds single-digit milliseconds — well under process-startup noise for a CLI. Two cheap mitigations worth taking anyway: (a) only attempt YAML parsing on files whose content starts with `---` (frontmatter-less legacy files — the majority of the 95 — are skipped after a prefix check, and per spec they can never carry a milestone), and (b) read the two directories' files with bounded concurrency (`Promise.all` over the entries) rather than the sequential await-in-loop the older stores use. No caching layer, mtime index, or resolved-count denormalization is justified; revisit only if consumer repos reach thousands of resolved issues, and even then an early-exit read of just the frontmatter block would be the first lever.
- **Dangling references**: the rollup function returns `warnings` for issue records whose `milestone` slug has no matching milestone file (and, symmetrically, nothing for milestones with zero issues — they roll up as 0/0). Callers print warnings to stderr and include them in JSON; exit code stays 0 per spec.
- **Frontmatter-less resolved files never miscount**: they parse with no `milestone` field, so they simply never enter any bucket — the spec's backward-compatibility scenario is satisfied structurally, not by special-casing.

### Pros/Cons

**Store class + pure rollup (chosen):** Pros — matches both conventions at once; rollup logic unit-testable with in-memory fixtures (no fs); one scan feeds all surfaces; `MilestonesStore` stays ~100 lines. Cons — CLI handlers do three wiring steps (load milestones, load issues, compute) instead of one call; mitigate with a small helper in the milestone command module reused by status/progress.
**Fat store:** Pros — one-call ergonomics. Cons — cross-store coupling; rollup tests need fs fixtures; duplicate issue-parsing logic or an awkward store-into-store dependency. Rejected.
**Free functions only:** Pros — minimal. Cons — breaks the store convention every other spec-dir domain follows; `createCliContext` wiring becomes irregular. Rejected.

### Complexity estimate

| Piece | New/changed files | Est. size |
|---|---|---|
| `MilestonesStore` + Zod milestone frontmatter schema | `src/milestones/milestones-store.ts`, `src/schemas/` addition, tests | ~120 LOC + ~150 test |
| `milestone-rollup.ts` pure functions | `src/milestones/milestone-rollup.ts`, tests | ~80 LOC + ~120 test |
| `metta milestone` CLI (create/list/show) | `src/cli/commands/milestone.ts`, `helpers.ts` wiring, `index.ts` registration, tests | ~180 LOC + ~150 test |
| Status/progress rollup sections (text + JSON) | `status.ts`, `progress.ts`, tests | ~80 LOC + ~120 test |
| `backlog migrate` subcommand | `backlog.ts` (or `src/backlog/migrate.ts` core + thin CLI), tests incl. collision/idempotency/re-run fixtures | ~150 LOC + ~200 test |
| Archive-dir date-prefix filter | `src/util/` predicate, `progress.ts`, `release-pipeline.ts`, tests | ~15 LOC + ~40 test |
| Guard + mint updates (both copies) | `src/templates/hooks/metta-guard-bash.mjs`, `metta-session-mint.mjs`, `.claude/hooks/` mirrors | ~8 lines × 2 copies |

Overall: **medium** — roughly 600 LOC source + 800 LOC tests across ~10 files, no new dependencies (`yaml` and `zod` already present), no schema migrations of existing state. The riskiest edges are (1) the `spec/archive/` reader pollution (addressed by the filter, must not be skipped) and (2) keeping the two hook copies in lockstep.
