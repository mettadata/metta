# Design: rework-backlog-around-issue-store-as-single-source-truth

## Approach

The issue store becomes the single stateful owner of all work items. `BacklogStore` is deleted; the backlog becomes a pure computed view over issue-file YAML frontmatter; milestones are a new, small per-directory store following the existing store pattern. This follows the consolidated research decision record (research.md) exactly — every structural choice below traces to a selected research approach.

**Architecture decision records (from research, restated as ADRs):**

- **ADR-1 — Fold backlog into `IssuesStore`; delete `BacklogStore`** (research track 1, approach 1). One store per file tree. Backlog filter/sort lives in pure functions in `src/backlog/backlog-view.ts` — "classes for stateful modules, functional core / imperative shell" both satisfied. A delegating `BacklogView` class (stateless) and a `WorkItemStore` rename (~1,100 lines of churn) were rejected in research.
- **ADR-2 — Frontmatter round-trip via a pure module using the existing `yaml` v2 Document API** (research track 2, approach 1). `src/issues/issue-frontmatter.ts` exposes `splitFrontmatter` / `parseIssueFrontmatter` / `applyFrontmatterPatch`. The body is carried as a verbatim string slice — byte preservation is true *by construction*, satisfying the spec requirement "Frontmatter writes round-trip the body and untouched fields" structurally. Mutations use `YAML.parseDocument()` / `doc.set()` / `doc.toString()`, the exact pattern already proven in `src/config/config-writer.ts`. Zero new dependencies. `gray-matter` (frozen, bundles js-yaml 3.x) and `remark-frontmatter` (tokenize-only, body-normalizing writes) were rejected.
- **ADR-3 — Singular `metta milestone create|list|show` command group** (research track 3, decision A), matching the spec's "Milestone store with Zod-validated frontmatter and CLI" requirement verbatim. `MilestonesStore` owns `spec/milestones/` I/O; `computeMilestoneRollups()` is a pure single-pass bucketing function. No Commander alias for `milestones` — keeps the guard surface single-spelling.
- **ADR-4 — `metta backlog migrate` with derived-state idempotency** (research track 3, decision B). No marker file: absence of `spec/backlog/**/*.md` means no-op. Converted originals are fs-renamed to `spec/archive/backlog-legacy/` (preserving `done/`); collisions are reported, never overwritten, exit 0. `git mv` and delete-after-convert were rejected (spec forbids silent deletion).
- **ADR-5 — Guard tiers**: `milestone list`/`show` → `ALLOWED_TWO_WORD`; `milestone create` → `BLOCKED_TWO_WORD` with mint scope `milestone:create` on the `metta-backlog` skill; `backlog migrate` → Tier 2 scope `backlog:migrate`. Both hook copies (`src/templates/hooks/` and live `.claude/hooks/`) updated in the same commit (known drift issue `hooks-and-statusline-execute-stale-main-checkout-dist-via`).
- **ADR-6 — Backward compatibility is structural, not special-cased.** Frontmatter-less files take the `rawFrontmatter: undefined` path in `splitFrontmatter` and parse through today's bold-label parser unchanged; they default to `type: issue`, `backlog: false`, no milestone — so they can never enter a backlog view or milestone bucket (spec: "Frontmatter-less issue files parse exactly as before", US-9).

**Vendor lock-in check:** none introduced. All persistence stays plain markdown + YAML frontmatter in git; the `yaml` package is an existing dependency; no external service, tracker, or provider API is touched.

### File inventory (exact)

**New files**

| File | Purpose |
|---|---|
| `src/schemas/issue-frontmatter.ts` | Strict Zod schema + types for issue frontmatter |
| `src/schemas/milestone-frontmatter.ts` | Strict Zod schema + types for milestone frontmatter |
| `src/issues/issue-frontmatter.ts` | Pure split/parse/patch module + `IssueFrontmatterError` |
| `src/backlog/backlog-view.ts` | Pure backlog filter + sort over issue records |
| `src/backlog/backlog-migrate.ts` | Legacy `spec/backlog/` → issue-store migration (imperative shell) |
| `src/milestones/milestones-store.ts` | `MilestonesStore` class — `spec/milestones/` CRUD |
| `src/milestones/milestone-rollup.ts` | Pure `computeMilestoneRollups()` |
| `src/cli/commands/milestone.ts` | `metta milestone create\|list\|show` + shared `loadMilestoneRollups()` helper |
| `src/util/archive-dirs.ts` | Shared `isArchivedChangeDir()` date-prefix predicate |

**Changed files**

| File | Change |
|---|---|
| `src/issues/issues-store.ts` | Frontmatter-aware parse; `updateFrontmatter`, `createIdea`, `listResolved`; enriched `list`/`show`; `archive` gains optional Shipped-in stamp |
| `src/cli/commands/backlog.ts` | `list/show/add/promote/done` rewired to issue frontmatter; new `migrate` subcommand; `--new/--order/--milestone` options; promote → `/metta-fix-issues`; drops `buildPromoteHandoff` import |
| `src/cli/commands/issue.ts` | `metta issue` gains `--milestone`/`--priority`; `issues list` renders `type: idea` marker |
| `src/cli/commands/roadmap.ts` | `backlogStore.show/exists` at :52/:84/:154 repointed to `issuesStore`; dangling-entry remedy text updated (`spec/backlog/<slug>.md` → `spec/issues/<slug>.md`) |
| `src/cli/commands/progress.ts` | Archive listing filtered by `isArchivedChangeDir`; milestone rollup text section + JSON keys |
| `src/cli/commands/status.ts` | Milestone rollup text section + optional JSON keys on all three envelopes |
| `src/cli/helpers.ts` | `CliContext`: remove `backlogStore`, add `milestonesStore`; construction updated |
| `src/cli/index.ts` | `registerMilestoneCommand(program)` registration |
| `src/index.ts` | Barrel: remove `backlog/backlog-store.js`; add `backlog/backlog-view.js`, `backlog/backlog-migrate.js`, `issues/issue-frontmatter.js`, `milestones/milestones-store.js`, `milestones/milestone-rollup.js`, `util/archive-dirs.js` |
| `src/schemas/index.ts` | Export the two new schema modules |
| `src/release/release-pipeline.ts` | `listArchiveDirs()` (:161) filters via `isArchivedChangeDir` |
| `src/templates/hooks/metta-guard-bash.mjs` + `.claude/hooks/metta-guard-bash.mjs` | New allow/block map entries (same commit) |
| `src/templates/hooks/metta-session-mint.mjs` + `.claude/hooks/metta-session-mint.mjs` | Extended `SKILL_SCOPES['metta-backlog']` (same commit) |
| `src/templates/skills/metta-backlog/SKILL.md` | Full rework (see API Design) |
| `src/templates/skills/metta-issue/SKILL.md` | Optional milestone/priority capture |
| `src/templates/skills/metta-fix-issues/SKILL.md` | Frontmatter-preservation note + idea-type awareness |

**Deleted files**

| File | Replacement |
|---|---|
| `src/backlog/backlog-store.ts` | `IssuesStore` (I/O) + `backlog-view.ts` (view) + `backlog-migrate.ts` (legacy parse, private) |
| `tests/backlog-store.test.ts` | `tests/backlog-view.test.ts` + `tests/backlog-migrate.test.ts` |
| `src/cli/promote-handoff.ts` | **Kept** — still used by `roadmap next` (roadmap is out of scope); only `backlog.ts` stops importing it. The "single edit point" comment in that file is updated to name roadmap as its sole consumer. |

## Components

### 1. `issue-frontmatter.ts` — pure frontmatter round-trip (functional core)

Exact contract from the research artifact (research-frontmatter-roundtrip.md), adopted unchanged:

```ts
export class IssueFrontmatterError extends Error {
  constructor(public readonly filePath: string, message: string, public readonly cause?: unknown)
}

/** Pure lexical split. Frontmatter exists iff content starts with `---\n` or `---\r\n`
 *  at offset 0. `body` is a verbatim substring slice — never re-serialized. */
export function splitFrontmatter(content: string): {
  rawFrontmatter: string | undefined
  body: string
  eol: '\n' | '\r\n'
}

/** Read path: split + YAML.parse + strict Zod (defaults applied).
 *  `frontmatter` is undefined for legacy (frontmatter-less) files. */
export function parseIssueFrontmatter(content: string, filePath: string): {
  frontmatter: IssueFrontmatter | undefined
  body: string
}

/** Write path: returns complete new file content.
 *  Existing block → YAML.parseDocument + doc.set per defined patch key; untouched keys
 *  keep value text, quoting, and relative order; new keys append. No block → canonical-order
 *  block (type, backlog, priority, milestone, order; absent fields omitted) prepended above
 *  the original content unchanged. Result set is validated with the strict schema BEFORE
 *  returning — no unvalidated state writes. Idempotency = caller compares output to input. */
export function applyFrontmatterPatch(content: string, patch: IssueFrontmatterPatch, filePath: string): string
```

The module implements the full edge-case table from research (CRLF, empty block, unclosed fence → loud error, non-map YAML → error, mid-body `---` ignored, BOM → legacy path).

### 2. `IssuesStore` — the single work-item store (imperative shell)

Additions/changes to `src/issues/issues-store.ts` (existing method signatures preserved so `fix-issue.ts` needs zero call-site changes):

```ts
export interface Issue {                       // existing, extended
  title: string
  captured: string
  context?: string
  status: 'logged'
  severity: Severity
  description: string                          // body BELOW the frontmatter, frontmatter stripped
  frontmatter?: IssueFrontmatter               // NEW — defaults applied; undefined for legacy files
}

export interface IssueRecord {                 // NEW — enriched list row (superset of today's row)
  slug: string
  title: string
  severity: Severity
  captured: string                             // **Captured**, falling back to **Added** (migrated ideas)
  type: 'issue' | 'idea'
  backlog: boolean
  priority?: 'high' | 'medium' | 'low'
  milestone?: string
  order?: number
}

export class IssuesStore {
  // Existing — signature extended additively (5th optional param):
  async create(title: string, description: string, severity?: Severity, context?: string,
               frontmatter?: Pick<IssueFrontmatterPatch, 'priority' | 'milestone'>): Promise<string>

  // NEW — mints a type: idea entry: frontmatter block (type: idea, backlog: true, + fields)
  // prepended above a standard formatIssue body (Captured/Status/Severity: minor), so captured-
  // date sorting and legacy listing work uniformly for ideas.
  async createIdea(title: string, description: string,
                   fields?: Pick<IssueFrontmatterPatch, 'priority' | 'order' | 'milestone'>): Promise<string>

  // NEW — applies applyFrontmatterPatch to spec/issues/<slug>.md.
  // Returns changed: false when output === input (idempotent backlog re-add).
  async updateFrontmatter(slug: string, patch: IssueFrontmatterPatch): Promise<{ changed: boolean }>

  // Enriched (return type widened; existing consumers use slug/title/severity — unaffected):
  async list(): Promise<IssueRecord[]>
  // NEW — same shape over spec/issues/resolved/ (feeds milestone rollups):
  async listResolved(): Promise<IssueRecord[]>

  async show(slug: string): Promise<Issue>     // now frontmatter-aware (strips block, populates field)
  async exists(slug: string): Promise<boolean> // unchanged

  // Extended additively: optional Shipped-in stamp (absorbs BacklogStore.archive semantics).
  // Copies raw content verbatim → frontmatter carried into resolved/ unchanged (spec:
  // "Archive preserves frontmatter end to end"). Stamp appended AFTER the body.
  async archive(slug: string, changeName?: string): Promise<void>

  async remove(slug: string): Promise<void>    // unchanged
}
```

Parsing pipeline inside `list`/`listResolved`/`show`: `splitFrontmatter` → validate block when present → legacy bold-label `parseIssue` on the body slice. Performance mitigation from research: files not starting with `---` skip YAML parsing entirely (a prefix check), so the 95 legacy resolved files cost nothing new.

### 3. `backlog-view.ts` — pure view functions

```ts
export interface BacklogEntry {
  slug: string; title: string; type: 'issue' | 'idea'
  priority?: 'high' | 'medium' | 'low'; order?: number
  milestone?: string; captured: string
}

/** Filter: exactly the records with backlog === true (any type). Legacy records
 *  (backlog defaulted false) are excluded structurally. */
export function toBacklogEntries(records: IssueRecord[]): BacklogEntry[]

/** Sort: priority (high < medium < low < none) → order asc (undefined after defined,
 *  within the same priority bucket) → captured date asc → slug asc (determinism tiebreak). */
export function sortBacklogEntries(entries: BacklogEntry[]): BacklogEntry[]
```

### 4. `MilestonesStore` + `milestone-rollup.ts`

```ts
export interface Milestone {
  slug: string; name: string; target?: string
  status: 'open' | 'closed'; description: string
}

export class MilestonesStore {
  constructor(private readonly specDir: string)          // wraps StateStore, sibling pattern
  async create(slug: string, fields: { name: string; target?: string; description?: string }): Promise<void>
  //   ^ throws when spec/milestones/<slug>.md exists (never overwrites); validates via schema before write
  async list(): Promise<Milestone[]>                     // [] when dir absent
  async show(slug: string): Promise<Milestone>           // throws not-found
  async exists(slug: string): Promise<boolean>
}
```

```ts
export interface MilestoneRollup {
  slug: string; name: string; status: 'open' | 'closed'; target?: string
  open: number; resolved: number; total: number
  percent: number                                        // Math.round(resolved/total*100), 0 when total === 0
  openIssues: Array<{ slug: string; title: string }>
  resolvedIssues: Array<{ slug: string; title: string }>
}

/** Pure single-pass bucketing: O(issues + milestones). Issues whose milestone slug has
 *  no milestone file produce a warning string, never a failure. Milestones with zero
 *  issues roll up 0/0/0 at 0%. */
export function computeMilestoneRollups(
  milestones: Milestone[],
  openIssues: IssueRecord[],
  resolvedIssues: IssueRecord[],
): { rollups: MilestoneRollup[]; warnings: string[] }
```

Rollups are sorted open-first, then slug asc. `src/cli/commands/milestone.ts` exports a wiring helper reused by `status`/`progress`:

```ts
/** Returns null when spec/milestones/ has no milestone files — the signal for
 *  status/progress to omit the section entirely (back-compat). */
export async function loadMilestoneRollups(ctx: CliContext):
  Promise<{ rollups: MilestoneRollup[]; warnings: string[] } | null>
```

### 5. `backlog-migrate.ts` — migration module

```ts
export interface MigrationCollision { slug: string; legacy_path: string; existing_path: string }

export interface MigrationResult {
  nothingToDo: boolean
  converted: { active: number; done: number }
  collisions: MigrationCollision[]
  archivedTo: string                            // 'spec/archive/backlog-legacy'
}

export async function migrateLegacyBacklog(specDir: string): Promise<MigrationResult>
```

Algorithm (per research decision B, verbatim semantics):

1. Enumerate `spec/backlog/*.md` and `spec/backlog/done/*.md`. Both empty/absent → `nothingToDo: true`, no writes.
2. Per **active** item: collision against `spec/issues/<slug>.md` OR `spec/issues/resolved/<slug>.md` → record, touch nothing, continue. Else write `spec/issues/<slug>.md` = frontmatter (`type: idea`, `backlog: true`, `priority` when the legacy `**Priority**` line parses to high/medium/low) + **original file content verbatim**; fs-rename original to `spec/archive/backlog-legacy/<slug>.md`.
3. Per **done** item: same collision check; else write `spec/issues/resolved/<slug>.md` = frontmatter (`type: idea` only) + original content verbatim; rename to `spec/archive/backlog-legacy/done/<slug>.md`.
4. Remove `spec/backlog/done/` then `spec/backlog/` only when empty (collision stragglers keep the dir; `backlog list` never reads it).
5. The legacy `**Priority**` parser (extracted from the deleted `backlog-store.ts` `parseItem`) lives here as a private pure helper. Legacy bold labels remain in the body — frontmatter is authoritative; the `IssueRecord` parser's `**Added**` fallback makes date sorting work for migrated ideas.

Idempotency is derived: a second run finds no legacy files (or only collision stragglers, re-reported with zero writes) → exit 0.

### 6. `archive-dirs.ts` — shared predicate

```ts
/** True for date-prefixed archived-change directories (YYYY-MM-DD-<change>). */
export function isArchivedChangeDir(name: string): boolean   // /^\d{4}-\d{2}-\d{2}-/.test(name)
```

Applied in `progress.ts` (archive listing) and `release-pipeline.ts` `listArchiveDirs()`.

## Data Model

### Issue frontmatter (new, optional on every file under `spec/issues/` and `spec/issues/resolved/`)

`src/schemas/issue-frontmatter.ts`, following the `.strict()` pattern of `src/schemas/agent-definition.ts`:

```ts
export const IssueFrontmatterSchema = z.object({
  type: z.enum(['issue', 'idea']).default('issue'),
  backlog: z.boolean().default(false),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  milestone: z.string().regex(SLUG_RE).optional(),        // SLUG_RE from src/util/slug.ts
  order: z.number().optional(),
}).strict()
export type IssueFrontmatter = z.infer<typeof IssueFrontmatterSchema>
export type IssueFrontmatterPatch = Partial<z.input<typeof IssueFrontmatterSchema>>
```

Strictness satisfies the spec's unknown-key rejection scenario via Zod `unrecognized_keys`; enum errors render field/received/allowed via the existing `formatZodError`. All fields optional with documented defaults — a frontmatter-less file is semantically `{ type: 'issue', backlog: false }`.

### Milestone file (`spec/milestones/<slug>.md`)

```ts
export const MilestoneFrontmatterSchema = z.object({
  name: z.string().min(1),
  target: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),  // ISO date, refined to a real calendar date
  status: z.enum(['open', 'closed']).default('open'),
}).strict()
```

Body below the frontmatter is the free-form description. Example:

```markdown
---
name: v0.6
target: 2026-09-30
status: open
---
Backlog/milestone unification release.
```

### Spec-tree layout, before → after migration

```
spec/backlog/<slug>.md            → spec/issues/<slug>.md            (+frontmatter: type: idea, backlog: true, priority?)
spec/backlog/done/<slug>.md       → spec/issues/resolved/<slug>.md   (+frontmatter: type: idea)
spec/backlog/ (originals)         → spec/archive/backlog-legacy/{,done/}<slug>.md  (fs rename, provenance)
spec/milestones/<slug>.md           NEW directory, one file per milestone
```

Issue files keep the bold-label metadata block as-is; frontmatter is a prepended, independent layer. Archived issues carry their frontmatter verbatim (archive copies raw content), which is what makes resolved-vs-open milestone counting work with no extra state.

## API Design

### CLI option surfaces

**`metta issue <description>`** (existing) gains:
- `--priority <high|medium|low>` — validated against the enum before create; invalid → exit non-zero naming allowed values, no file created.
- `--milestone <slug>` — slug-validated; when no `spec/milestones/<slug>.md` exists, a dangling-reference warning goes to stderr but the issue is still created (spec: warn, never fail).
Both are written as frontmatter via `IssuesStore.create`'s new fifth parameter.

**`metta issues list`** — human output prefixes `type: idea` rows with an `[idea]` marker; JSON rows gain the additive `type/backlog/priority/milestone/order/captured` fields from `IssueRecord`.

**`metta backlog add <slug-or-title>`** (rewired):
- `--new` — mint a new `type: idea` entry (positional is the title). Without `--new`, an unresolved slug fails with exit 4, names the slug, and suggests `--new` — never silently mints from a typo.
- `--description <text>` (with `--new`; defaults to title), `--priority <level>`, `--order <n>`, `--milestone <slug>`, `--on-branch <name>`.
- Existing slug: `updateFrontmatter(slug, { backlog: true, ...opts })`; `changed: false` → "already backlogged", exit 0.
- JSON: `{ "slug", "status": "backlogged" | "already_backlogged" | "created", "type": "issue" | "idea", "committed", "commit_sha" }`.

**`metta backlog list`** — `issuesStore.list()` → `toBacklogEntries` → `sortBacklogEntries`. Never reads `spec/backlog/`. JSON: `{ "backlog": [ { "slug", "title", "type", "priority": "high" | ... | null, "order": n | null, "milestone": "slug" | null, "captured" } ] }`.

**`metta backlog show <slug>`** — `issuesStore.show(slug)`; renders title, type, backlog fields, body. Not-found → exit 4.

**`metta backlog promote <slug>`** — `issuesStore.exists` check (exit 4 not-found), then emits the handoff only — no writes: text `Promote '<slug>' by running: /metta-fix-issues <slug>`; JSON `{ "promoted": "<slug>", "message": "Run: /metta-fix-issues <slug>" }`. `buildPromoteHandoff` import dropped (roadmap keeps it).

**`metta backlog done <slug> [--change <name>] [--on-branch <name>]`** — `issuesStore.archive(slug, changeName)` + `issuesStore.remove(slug)`; git stage targets become `spec/issues` + `spec/issues/resolved` (matching `fix-issue.ts:49`). JSON shape unchanged: `{ "archived", "shipped_in", "committed", "commit_sha" }`.

**`metta backlog migrate [--on-branch <name>]`** (new) — runs `assertOnMainBranch`, calls `migrateLegacyBacklog`, then the swallow-on-failure auto-commit staging `spec/backlog`, `spec/archive/backlog-legacy`, `spec/issues`. JSON:

```json
{ "nothing_to_do": false,
  "converted": { "active": 2, "done": 1 },
  "collisions": [ { "slug": "dark-mode", "legacy_path": "spec/backlog/dark-mode.md", "existing_path": "spec/issues/dark-mode.md" } ],
  "archived_to": "spec/archive/backlog-legacy",
  "committed": true, "commit_sha": "..." }
```

Exit 0 with or without collisions; non-zero only on I/O failure.

**`metta milestone create <slug> --name <name> [--target <date>] [--description <text>] [--on-branch <name>]`** — refuses existing files (exit 4, `milestone_exists`); JSON `{ "slug", "created": true, "committed", "commit_sha" }`.

**`metta milestone list`** — full rollups (counts only, no per-issue detail):

```json
{ "milestones": [
    { "slug": "v0-6", "name": "v0.6", "status": "open", "target": "2026-09-30",
      "open": 2, "resolved": 1, "total": 3, "percent": 33 } ],
  "milestone_warnings": ["issue 'x' references unknown milestone 'v9-9'"] }
```

(`milestone_warnings` present only when non-empty; warnings also mirrored to stderr in text mode.)

**`metta milestone show <slug>`** — the only per-issue surface:

```json
{ "slug": "v0-6", "name": "v0.6", "status": "open", "target": "2026-09-30",
  "description": "...", "open": 2, "resolved": 1, "total": 3, "percent": 33,
  "issues": [ { "slug": "gate-runner-swallows-timeout", "title": "...", "state": "open" },
              { "slug": "config-drift", "title": "...", "state": "resolved" } ] }
```

Unknown slug → exit 4 not-found. Zero-issue milestone → exit 0 with empty `issues` and 0/0 at 0%.

### Status / progress rollups

Both commands call `loadMilestoneRollups(ctx)`; `null` (no milestone files) → **no section, no JSON keys** — output byte-compatible with pre-change structure (spec back-compat scenario).

- **`metta progress`** — text: a `Milestones:` block after `Completed (N):`, one line per milestone: `v0-6  ▸ 1/3 resolved (33%)  target 2026-09-30` (closed milestones marked `✓` and sorted after open ones). JSON: optional top-level `milestones` (same element shape as `milestone list`) + optional `milestone_warnings`.
- **`metta status`** — same optional top-level keys appended to whichever envelope is emitted (single `ChangeStatusJson`, `{ changes: [...] }`, or `{ changes: [], message }`), never embedded per change; text prints the same `Milestones:` section after the change block(s).

### Guard and mint changes (both hook copies, one commit)

`metta-guard-bash.mjs`:

```js
ALLOWED_TWO_WORD  += ['milestone', new Set(['list', 'show'])]
BLOCKED_TWO_WORD:    ['backlog', new Set(['add', 'done', 'promote', 'migrate'])]   // 'migrate' added
                  += ['milestone', new Set(['create'])]
```

Bare `metta milestone` stays fail-closed (`milestone` is not added to `ALLOWED_BARE` — there is no bare read view). `metta-session-mint.mjs`:

```js
'metta-backlog': ['backlog:add', 'backlog:done', 'backlog:promote', 'backlog:migrate', 'milestone:create'],
```

### Skill template updates

- **`metta-backlog/SKILL.md`** (rework): menu becomes `list | show | add | promote | done | migrate | milestone`. `add` first asks "existing issue or new idea?" — existing: pick a slug from `metta issues list --json` and run `metta backlog add <slug> [--priority] [--order] [--milestone]`; new idea: collect title/description and run `metta backlog add "<title>" --new ...`. `promote` echoes the `/metta-fix-issues <slug>` handoff (the rule "do not call metta propose" becomes "do not invoke the fix-issues flow yourself; surface the command"). `done` echoes the `spec/issues/resolved/<slug>.md` path. `migrate` runs `metta backlog migrate --json` and reports converted counts + collisions. `milestone` sub-menu drives `metta milestone create|list|show`. The "CLI owns spec/backlog/" line is replaced with "the backlog is a view over spec/issues/ frontmatter".
- **`metta-issue/SKILL.md`** (additive): after severity, one optional `AskUserQuestion` for priority and milestone (milestone options from `metta milestone list --json` when any exist; skip the question entirely when none do); forward as `--priority`/`--milestone` on the `metta issue` call in step 7.
- **`metta-fix-issues/SKILL.md`** (touch points): note in step 1 that `metta issues show --json` may carry a `frontmatter` field (`type: idea` entries are valid fix targets) and in step 11 that resolution preserves frontmatter through `spec/issues/resolved/` — no skill-side action needed; plus a line that `metta backlog promote` hands off into this skill.

### Test file plan (1:1 ratio maintained)

| Test file | Covers | Status |
|---|---|---|
| `tests/issue-frontmatter.test.ts` | Full edge-case table: CRLF, byte-preserved body, key order, unclosed fence, non-map, unknown key, enum errors, patch idempotency | new |
| `tests/backlog-view.test.ts` | Filter + deterministic sort (spec scenario C, B, A, D ordering), defaults rendering | new |
| `tests/backlog-migrate.test.ts` | Active/done conversion, priority carry, collision report-not-overwrite, second-run no-op, verbatim body, legacy-dir archival | new |
| `tests/milestones-store.test.ts` | Create/list/show/exists, duplicate refusal, invalid status/target rejection | new |
| `tests/milestone-rollup.test.ts` | Bucketing, percent rounding, 0-guard, dangling warnings, closed sorting | new |
| `tests/cli-milestone.test.ts` | Command surfaces + JSON shapes, not-found paths | new |
| `tests/archive-dirs.test.ts` | Predicate + progress/release integration fixtures | new |
| `tests/issues-store.test.ts` | Extended: frontmatter-aware list/show, `updateFrontmatter`, `createIdea`, `listResolved`, archive stamp + frontmatter carry-through, legacy files byte-unchanged | changed |
| `tests/cli-issue-backlog.test.ts` | Reworked: new add/list/promote/done/migrate behavior, `--new` failure path, `--milestone`/`--priority` on issue log | changed |
| `tests/cli-roadmap.test.ts` | Fixtures repointed: roadmap slugs validated against `spec/issues/` | changed |
| `tests/cli-status.test.ts` | Milestone section presence/absence envelopes | changed |
| `tests/cli-metta-guard-bash-integration.test.ts` | `milestone list/show` allowed; `milestone create` + `backlog migrate` Tier-2 gated | changed |
| `tests/backlog-store.test.ts` | — | deleted |

## Dependencies

**External (no additions):**
- `yaml` ^2.x — already in package.json; the spec mandates it for frontmatter. Document API (`parseDocument`/`set`/`toString`) for mutations; `YAML.parse` for reads.
- `zod` — schema validation on every frontmatter read/write (existing convention).
- `commander`, `vitest` — existing; new command group and test files only.
- Explicitly **not** added: `gray-matter`, `remark-frontmatter` (rejected in research with citations).

**Internal:**
- `src/state/state-store.ts` — unchanged; both stores keep wrapping it for raw I/O.
- `src/util/slug.ts` — `SLUG_RE` reused in the frontmatter schema and milestone slug validation.
- `src/util/format-zod-error.ts` — renders frontmatter validation errors (field/received/allowed) with zero new formatting code.
- `src/config/config-writer.ts` — prior art for the Document-API mutation pattern (referenced, not modified).
- Dependency direction: `issues-store` → `issue-frontmatter` → `schemas` (pure); `backlog-view` and `milestone-rollup` are leaf pure modules; CLI commands compose stores + pure functions at the edge. No store-to-store dependency anywhere (milestone rollups are wired in the CLI, matching how `roadmap.ts` composes stores today).

## Risks & Mitigations

The five risks flagged in research.md, each with its committed mitigation, plus two additional design-level risks:

1. **`spec/archive/backlog-legacy/` pollutes existing archive-dir readers.** `progress.ts:90` renders every archive subdirectory as a completed change (garbage date from `name.slice(0,10)`), and `release-pipeline.ts:161` would count it as an unreleased change that the next `release cut` claims into `spec/releases.yaml`. **Mitigation:** shared `isArchivedChangeDir()` (`/^\d{4}-\d{2}-\d{2}-/`) in `src/util/archive-dirs.ts`, applied in both readers in this change (progress is already in the blast radius). `doc-generator.ts` already skips non-date dirs; `ceremony-metrics.ts` and `merge-safety.ts` are safe per research. Covered by `tests/archive-dirs.test.ts` with fixtures for both consumers — this filter is a hard task-list item, not optional.

2. **Hook drift between template and live copies.** Guard/mint tier changes that land only in `src/templates/hooks/` leave the executing `.claude/hooks/` copies stale (known issue `hooks-and-statusline-execute-stale-main-checkout-dist-via`) — `backlog migrate` and `milestone create` would be blocked or, worse, `milestone list` fail-closed. **Mitigation:** all four files (`src/templates/hooks/metta-guard-bash.mjs`, `metta-session-mint.mjs`, and their `.claude/hooks/` mirrors) are edited in the same commit, as a single task; the guard integration test asserts the new classifications against the template copy, and the task's verify step diffs the two copies for equality.

3. **`BacklogStore` removal is a breaking barrel export.** `src/index.ts:11` exports `BacklogStore`/`BacklogItem` to external consumers. **Mitigation:** intended and accepted — the spec retires the standalone store. Flagged as a breaking API change for the release notes (release-versioning: warrants a minor bump pre-1.0 with a BREAKING note in the changelog entry). The barrel gains the replacement surface (`backlog-view`, `backlog-migrate`, `issue-frontmatter`, `milestones-store`, `milestone-rollup`) in the same commit so consumers have a migration target.

4. **`roadmap.ts` hidden dependency on `backlogStore`.** `backlogStore.show/exists` at `roadmap.ts:52, 84, 154` would break at compile time when the store is deleted — and after migration, roadmap slugs live in `spec/issues/`. **Mitigation:** repoint all three call sites to `issuesStore.show/exists` in this change (roadmap behavior is otherwise untouched — explicitly out of scope); update the dangling-entry remedy text (`Restore spec/backlog/<slug>.md` → `Restore spec/issues/<slug>.md`); `tests/cli-roadmap.test.ts` fixtures updated to seed issues instead of backlog items. TypeScript's compile-time check on the removed `CliContext.backlogStore` field guarantees no site is missed.

5. **Milestone rollup JSON keys and back-compat for status/progress consumers.** Existing consumers (statusline, scripts parsing `--json`) must see structurally identical output when no milestones exist. **Mitigation:** `loadMilestoneRollups` returns `null` when `spec/milestones/` has no milestone files, and both commands add the `milestones`/`milestone_warnings` keys *only* in the non-null case (same conditional-key pattern already used for `artifact_timings` in progress). `tests/cli-status.test.ts` asserts key absence in the no-milestone envelope and presence with milestones — both directions.

6. **Frontmatter write corrupting a live issue file (data-loss class).** A bug in `applyFrontmatterPatch` could damage RCA content on real consumer data (zeus). **Mitigation:** byte preservation is structural (body is a verbatim slice, never re-serialized); the patched result is schema-validated before any write; `updateFrontmatter` writes only when output differs from input; the edge-case table is fully test-covered including CRLF and no-trailing-newline bodies. The migration additionally never rewrites originals — it renames them intact to the archive location, so every pre-migration byte remains recoverable without git archaeology.

7. **yaml Document API trailing-comment re-association.** Documented upstream instability for trailing comments adjacent to a mutated node. **Mitigation:** accepted as-is (research risk 5 verdict) — metta never writes frontmatter comments; hand-added comments on untouched lines survive; the scenario is noted in the module doc comment rather than worked around.
