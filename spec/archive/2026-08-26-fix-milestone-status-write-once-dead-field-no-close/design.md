# Design: fix-milestone-status-write-once-dead-field-no-close

## Approach

Implement the selected research approach (`research.md`, detailed in `research-store-update.md`): give milestones a validated write-back path by mirroring the proven sibling `IssuesStore.updateFrontmatter` pattern (`src/issues/issues-store.ts:223-234`) — read → patch → full-frontmatter Zod re-validation → write, with git commits staying at the CLI edge ("functional core, imperative shell"). Composition throughout: the new CLI verbs compose the existing `MilestonesStore`, `assertOnMainBranch`, and a small extracted commit helper; no inheritance, no new abstractions beyond a 3-entry marker map and that helper (which removes duplication).

Five concrete moves, in dependency order (this is also the recommended implementation order):

1. **Schema** — extend the status enum with `abandoned` (spec: "MODIFIED: Milestone store with Zod-validated frontmatter and CLI").
2. **Store** — add `MilestonesStore.update(slug, patch)`; validation precedes all I/O, so byte-identical-on-failure is structural, not defensive (spec: "Milestone store update applies validated patches"; constitution: "No unvalidated state writes").
3. **Rollup + renderers** — rank-comparator sort (open=0, terminal=1; provably behavior-identical for open/closed-only inputs) and a shared exported `MILESTONE_MARKERS` map replacing three duplicated ternaries (spec: "Renderers and rollups handle the abandoned state", including the byte-compat scenario).
4. **CLI** — `milestone close [--abandoned]` and `milestone update` cloned from the `create` action shape: same branch guard, same JSON error envelope, same swallow-on-failure auto-commit via a shared `commitMilestones` helper (spec: close/update CLI requirements).
5. **Hooks + skill** — `close`/`update` join `BLOCKED_TWO_WORD` in the guard (scope keys auto-derive), `milestone:close`/`milestone:update` join `SKILL_SCOPES['metta-backlog']` in the mint hook, each edit mirrored byte-identically into `src/templates/hooks/`; the `metta-backlog` skill (both copies) gains `close`/`update` branches (spec: "Guard authorization for milestone close and update").

Rejected alternatives (derived status; close-only + advisory) are documented with rationale in `research.md` — both fail most spec requirements and the second doubles lifecycle cost. No vendor lock-in anywhere in this change: all dependencies are already-installed npm packages and in-repo modules.

## Components

### 1. `src/schemas/milestone-frontmatter.ts` (edit, 1 line + type ripple)

- Line 26: `status: z.enum(['open', 'closed']).default('open')` → `status: z.enum(['open', 'closed', 'abandoned']).default('open')`.
- Zod's enum error already names the received value and the allowed values; `formatZodError` renders it — satisfies the "`status: shipped` rejected naming allowed values" scenario with no extra code.
- `.strict()` and the `target` regex + real-calendar-date refinement are untouched.

### 2. `src/milestones/milestones-store.ts` (edit)

- `Milestone.status` (line 14): replace the duplicated literal union with the schema-derived type — `status: MilestoneFrontmatter['status']` — killing the duplication permanently (single source of truth in the schema).
- New exported interface `MilestonePatch` and new method `update` (signatures in API Design). Flow:
  1. `assertSafeSlug(slug)` (same guard as every existing method).
  2. Programmer-error check: `patch.target !== undefined && patch.clearTarget` → `throw new Error('clearTarget and target are mutually exclusive')`.
  3. Exists check on `join('milestones', `${slug}.md`)`; throw `` `Milestone '${slug}' not found` `` — exact text of `show` (line 133), so the CLI's existing `message.includes('not found')` → `not_found` mapping works unchanged. Never creates a file.
  4. `this.state.readRaw(relPath)` + `parseMilestone(content, slug, relPath)` — a corrupt current file fails here, before any write.
  5. Build next frontmatter: `name: patch.name ?? current.name`; `target` key present iff `patch.clearTarget` is false and (`patch.target ?? current.target`) is defined; `status: patch.status ?? current.status`.
  6. `validateFrontmatter(next, relPath)` — full resulting frontmatter through `MilestoneFrontmatterSchema` **before any I/O**. A failing patch throws here; the file is byte-identical by construction.
  7. `this.state.writeRaw(relPath, formatMilestone(validated, patch.description ?? current.description))`. `formatMilestone`'s `YAML.stringify` (yaml default `keepUndefined: false`) omits an absent `target` key entirely — never `target: null` — satisfying the clear-target scenario.
  8. Return the updated `Milestone` (re-built from validated frontmatter + body) so the CLI emits JSON without a second read.
- `create`/`list`/`show`/`exists` are untouched.
- An empty patch (`update(slug, {})`) is a validated no-op rewrite at store level; the CLI enforces "at least one field option" so the store stays simple (per research §2).

### 3. `src/milestones/milestone-rollup.ts` (edit)

- `MilestoneRollup.status` (line 7): `'open' | 'closed'` → `Milestone['status']`.
- Sort (lines 77-80): replace the two-state comparator with a rank comparator (exact form in API Design). For open/closed-only inputs this is behaviorally identical (open→0, closed→1), preserving the spec's byte-compat requirement; `abandoned` joins the terminal group, slug-ascending within it. Update the function's doc comment ("sorted open-first, then terminal, then slug ascending").
- New export: `MILESTONE_MARKERS` map (`▸` open, `✓` closed, `✗` abandoned) — the single source for all three render sites so glyphs cannot drift. `✗` (U+2717) matches the width class of `✓` (U+2713); no `padEnd` misalignment.
- Barrel: `src/index.ts` already does `export * from './milestones/milestone-rollup.js'` and `.../milestones-store.js` — `MilestonePatch` and `MILESTONE_MARKERS` flow through with no barrel edit.

### 4. `src/cli/commands/milestone.ts` (edit — the largest single file change)

- **`commitMilestones` helper** (module-private async function): extract `create`'s commit block (lines 77-87) verbatim — `git add spec/milestones` → `git commit -m <message>` → `git rev-parse HEAD`, whole block in a swallowing try/catch returning `{ committed: false }` when git is unavailable or there is nothing to commit. `create` refactors onto it (behavior-preserving; commit message string `chore: create milestone ${slug}` passed in by the caller — no behavior change).
- **`close` subcommand**: registered after `create`; option/flow details in API Design. Conflict check happens in the CLI (`current.status !== 'open'`) before any store call, so an already-terminal milestone's file is provably untouched.
- **`update` subcommand**: option-driven patch; builds `MilestonePatch` from provided options only; "no field options" pre-check; `--target`/`--clear-target` mutual exclusion via Commander's `.conflicts()` (available — repo pins `commander: ^13.1.0` in `package.json:37`; `.conflicts()` shipped in Commander 9). Import ripple: `import { Command, Option } from 'commander'` (`Option` needed for `.choices()` and `.conflicts()`).
- **`list` renderer** (line 121): ternary → `MILESTONE_MARKERS[r.status]` (uncolored).
- `show` needs no change: it prints `Status: ${item.status}` and passes `rollup.status` through to JSON — `abandoned` flows through as data once the type widens.

### 5. `src/cli/commands/status.ts` (edit, 1 line)

- `printMilestoneSection` (line 33): ternary → colored map lookup: `✓` stays green (32), `▸` stays cyan (36), `✗` renders red (31). Implemented as a small local lookup over `MILESTONE_MARKERS` glyphs with a color-code map `{ open: 36, closed: 32, abandoned: 31 }` (kept local per site since only the two colored sites need colors).

### 6. `src/cli/commands/progress.ts` (edit, 1 line)

- Line 217: identical treatment to status.ts. The adjacent grey (90) target text motivates red over grey for `✗` (visually distinct); glyph — not just color — differs, satisfying the distinguishability requirement in no-color terminals.

### 7. Guard hook pair (2 files, byte-identical edit)

- `.claude/hooks/metta-guard-bash.mjs` line 81: `['milestone', new Set(['create'])]` → `['milestone', new Set(['create', 'close', 'update'])]`; extend the adjacent comment (lines 79-80) to name all three Tier-2 scope keys, minted only by the metta-backlog skill.
- Scope keys auto-derive at lines 902-905 (`` `${sub}:${third}` `` for two-word blocked forms) — **no other guard logic changes**; the new verbs ride the existing Tier-2 machinery exactly as `milestone create` does. `milestone list`/`show` stay in `ALLOWED_TWO_WORD` (line 60), credential-free.
- Mirror the edit byte-identically into `src/templates/hooks/metta-guard-bash.mjs` (`tests/hooks-byte-identity.test.ts` pins the pair; a forgotten mirror fails CI — the desired tripwire).

### 8. Mint hook pair (2 files, byte-identical edit)

- `.claude/hooks/metta-session-mint.mjs` line 35: append `'milestone:close', 'milestone:update'` to `SKILL_SCOPES['metta-backlog']`.
- Mirror byte-identically into `src/templates/hooks/metta-session-mint.mjs`.

### 9. Skill pair (2 files, same edit)

- `.claude/skills/metta-backlog/SKILL.md` line 28: milestone action choices `create | list | show` → `create | list | show | close | update`, plus two dispatch branches:
  - **close** → run `metta milestone list --json` (allow-listed; completes a prior mint cycle), present open-milestone slugs via `AskUserQuestion`, ask whether the milestone was achieved (`closed`) or dropped (`abandoned`), then run `metta milestone close <slug>` (append `--abandoned` for dropped). Echo the resulting status and commit line.
  - **update** → present milestone slugs the same way, collect which fields to change (`name` / `target` / clear target / `description` / `status`) via `AskUserQuestion`, then run `metta milestone update <slug>` with only the matching flags. Note in the branch that `--status open` is the reopen path.
- Same edit in `src/templates/skills/metta-backlog/SKILL.md` (templates are copied to `dist/` at build time per project conventions; keep both copies in sync — no byte-identity test pins skills, so this is a review checklist item, and `tests/skill-template-anchoring.test.ts` lints both trees).

## Data Model

### Milestone file (on disk, `spec/milestones/<slug>.md`) — schema change only

```yaml
---
name: <string, min 1>          # required
target: <YYYY-MM-DD>           # optional; key absent when unset/cleared (never null)
status: open | closed | abandoned   # default open  ← enum gains 'abandoned'
---
<free-form description body>
```

- **Backward compatible reads:** every existing file carries `open` or `closed`; both stay valid; `.default('open')` unchanged. Spec scenario "Pre-existing open and closed files are unaffected" holds structurally.
- **Forward-compat caveat (accepted in intent.md §Impact):** a file written with `status: abandoned` fails validation under older metta builds — a one-way door once any milestone is abandoned.
- **Normalization (accepted, research §7):** `update` re-serializes the full frontmatter via `YAML.stringify` (unlike the issue store's minimal-diff Document API). Files written by `milestone create` round-trip stably; hand-edited files (reordered keys, comments) are normalized on first update. Acceptable — milestone frontmatter is three metta-owned keys and hand-editing is the workflow this change eliminates. `formatMilestone`/`parseMilestone` both trim the body, so body normalization is limited to leading/trailing whitespace.

### In-memory types

```ts
// milestones-store.ts
interface Milestone {
  slug: string
  name: string
  target?: string
  status: MilestoneFrontmatter['status']   // was 'open' | 'closed' literal union
  description: string
}

export interface MilestonePatch {
  name?: string
  target?: string        // set or change
  clearTarget?: boolean  // remove the key entirely; mutually exclusive with target
  status?: Milestone['status']
  description?: string   // full body replacement
}

// milestone-rollup.ts
interface MilestoneRollup { status: Milestone['status'] /* … unchanged fields … */ }
export const MILESTONE_MARKERS = { open: '▸', closed: '✓', abandoned: '✗' } as const
```

Design decision (ADR-style, from research §2): **`clearTarget: boolean` rather than `target: string | null`.** Rationale: `null` would leak a YAML-serialization concern into the type and fight `YAML.stringify`'s `keepUndefined: false` behavior; a boolean maps 1:1 to the `--clear-target` CLI flag and keeps the patch type free of null unions. The sibling issue patch type never needed field removal, so there is no precedent conflict.

### Session-tier scope keys (guard/mint hooks)

New Tier-2 scope keys `milestone:close` and `milestone:update`, auto-derived by the guard from `BLOCKED_TWO_WORD`, minted only into `metta-backlog` tokens. No change to token file format, TTL/GRACE policy, or the two-tier trust model.

## API Design

### Store

```ts
// src/milestones/milestones-store.ts
async update(slug: string, patch: MilestonePatch): Promise<Milestone>
```

Errors (all plain `Error`, matching the store's existing error style — no new error classes; the CLI maps messages, exactly as it does for `show`):

| Condition | Message | CLI mapping |
|---|---|---|
| unsafe slug | existing `assertSafeSlug` text | `milestone_error`, exit 4 |
| `target` + `clearTarget` both set | `clearTarget and target are mutually exclusive` | unreachable from CLI (`.conflicts()`); programmer error |
| no file | `Milestone '<slug>' not found` | `not_found`, exit 4 |
| patched frontmatter invalid | `Invalid milestone frontmatter in <relPath>:\n  - <field>: …` (via `formatZodError`) | `milestone_error`, exit 4; names the offending field |

### CLI: `metta milestone close <slug>`

```ts
milestone
  .command('close')
  .argument('<slug>', 'Milestone slug')
  .option('--abandoned', 'Mark abandoned instead of closed')
  .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
  .description('Close (or abandon) an open milestone')
```

Action flow (clones `create`'s structure):
1. `json = program.opts().json`; `createCliContext()`; load config; `assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)`.
2. `current = await ctx.milestonesStore.show(slug)` — not-found propagates to the catch.
3. Conflict: `current.status !== 'open'` → exit 4, `type: 'milestone_conflict'`, message `` `Milestone '${slug}' is already ${current.status}` `` (names the current status per spec). No store call — file untouched.
4. `await ctx.milestonesStore.update(slug, { status: options.abandoned ? 'abandoned' : 'closed' })`.
5. `commitMilestones(ctx.projectRoot, `chore: close milestone ${slug}`)` — one message for both closed and abandoned (spec pins this for the `--abandoned` scenario too).
6. Output — JSON: `{ slug, status, committed, commit_sha }`; text: `Closed milestone: <slug>` or `Abandoned milestone: <slug>` plus `  Committed: <short-sha>` when committed (matches `create` conventions).
7. Catch: `type = message.startsWith('Refusing to write') ? 'branch_guard' : message.includes('not found') ? 'not_found' : 'milestone_error'`; envelope `{ error: { code: 4, type, message } }` under `--json`, plain stderr otherwise; `process.exit(4)`.

### CLI: `metta milestone update <slug>`

```ts
milestone
  .command('update')
  .argument('<slug>', 'Milestone slug')
  .option('--name <name>', 'Rename display name')
  .addOption(new Option('--target <date>', 'Set or change target date (YYYY-MM-DD)').conflicts('clearTarget'))
  .option('--clear-target', 'Remove the target date')
  .option('--description <text>', 'Replace the description body')
  .addOption(new Option('--status <status>', 'Set status explicitly (reopen with --status open)').choices(['open', 'closed', 'abandoned']))
  .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
  .description('Edit milestone fields (name, target, description, status)')
```

**Resolved:** Commander `.conflicts()` and `Option.choices()` are used — `package.json:37` pins `commander: ^13.1.0`; both APIs exist since Commander 9. No manual mutual-exclusion check needed; Commander exits non-zero with its standard conflict message. `.choices()` gives friendly rejection of bad `--status` values; Zod remains the authoritative write gate (defense in depth).

Action flow:
1. Same context / config / branch-guard preamble as `close`.
2. "No field options" pre-check: none of `name`, `target`, `clearTarget`, `description`, `status` present → exit 4, `type: 'milestone_error'`, message `At least one field option is required (--name, --target, --clear-target, --description, --status)`. No store call.
3. Build `MilestonePatch` from provided options only (spread conditionally — absent options never appear in the patch, so untouched fields are preserved by the store).
4. `await ctx.milestonesStore.update(slug, patch)` — validation failures and not-found propagate to the same catch mapping as `close`.
5. `commitMilestones(ctx.projectRoot, `chore: update milestone ${slug}`)`.
6. Output — JSON: `{ slug, changed, committed, commit_sha }` where `changed` is the ordered list of patched field names (e.g. `['target', 'status']`; `clearTarget` reports as `'target'` — the field that changed); text: `Updated milestone: <slug> (<changed fields joined>)` plus committed line.

### Shared helper

```ts
// src/cli/commands/milestone.ts (module-private)
async function commitMilestones(
  projectRoot: string,
  message: string,
): Promise<{ committed: boolean; commitSha?: string }>
```

Same `git add spec/milestones` → `commit -m <message>` → `rev-parse HEAD` sequence and swallow-on-failure semantics as `create` today; `create` refactors onto it.

### Rollup comparator (exact replacement, `milestone-rollup.ts:77-80`)

```ts
const rank = (s: Milestone['status']): number => (s === 'open' ? 0 : 1)
rollups.sort((a, b) =>
  rank(a.status) - rank(b.status) ||
  (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
```

### Exit codes / envelope summary

All failure paths on the new verbs use exit code 4 with the standard envelope `{ error: { code: 4, type, message } }` under `--json` (types: `branch_guard`, `not_found`, `milestone_conflict`, `milestone_error`), plain stderr message otherwise — byte-consistent with `create`/`show`. Successful commands exit 0. Commander-level option errors (`.conflicts()`, `.choices()`) exit with Commander's own non-zero code, matching every other subcommand's behavior for bad flags.

## Dependencies

**External (all already installed — no additions, no version bumps, no lock-in):**
- `commander ^13.1.0` — `.command`/`.argument`/`.option`/`.addOption`, `Option.choices()`, `Option.conflicts()`.
- `zod` — `MilestoneFrontmatterSchema` enum extension; `safeParse` via existing `validateFrontmatter`.
- `yaml` — `YAML.stringify` with default `keepUndefined: false` (the clear-target mechanism) via existing `formatMilestone`.
- `vitest` + existing test helpers (`tests/helpers/cli.js`: `runCli`, `installFixture`, `execAsync`).

**Internal:**
- `StateStore` (`readRaw`/`writeRaw`/`exists`) — unchanged, consumed by `update`.
- `src/cli/helpers.ts` — `assertOnMainBranch`, `createCliContext`, `outputJson`, `getErrorMessage` — unchanged, consumed by both new verbs.
- `formatZodError`, `assertSafeSlug` — unchanged.
- `loadMilestoneRollups` / `toMilestoneCountsRow` — unchanged; `status`/`progress` inherit `abandoned` through them.
- Guard/mint hooks and their `src/templates/hooks/` mirrors; `metta-backlog` skill and its `src/templates/skills/` mirror.

**Complete file list (12 source + 5 test files to extend):**

| # | File | Edit |
|---|---|---|
| 1 | `src/schemas/milestone-frontmatter.ts` | enum + `abandoned` |
| 2 | `src/milestones/milestones-store.ts` | `MilestonePatch`, `update()`, derived status type |
| 3 | `src/milestones/milestone-rollup.ts` | status type, rank comparator, `MILESTONE_MARKERS` |
| 4 | `src/cli/commands/milestone.ts` | `commitMilestones`, `close`, `update`, marker lookup, `Option` import |
| 5 | `src/cli/commands/status.ts` | marker lookup (line 33) |
| 6 | `src/cli/commands/progress.ts` | marker lookup (line 217) |
| 7 | `.claude/hooks/metta-guard-bash.mjs` | `BLOCKED_TWO_WORD` milestone set + comment |
| 8 | `src/templates/hooks/metta-guard-bash.mjs` | byte-identical mirror of 7 |
| 9 | `.claude/hooks/metta-session-mint.mjs` | `SKILL_SCOPES['metta-backlog']` + 2 keys |
| 10 | `src/templates/hooks/metta-session-mint.mjs` | byte-identical mirror of 9 |
| 11 | `.claude/skills/metta-backlog/SKILL.md` | `close`/`update` branches |
| 12 | `src/templates/skills/metta-backlog/SKILL.md` | mirror of 11 |

**Test plan (extends existing files — near-1:1 ratio holds; no new test files required):**

| Test file | New cases |
|---|---|
| `tests/milestones-store.test.ts` | `update` status patch preserves name/target/body; `clearTarget` removes the key (assert raw file content has no `target:` line); invalid patch (`target: '2026-02-30'`, empty `--name` equivalent) throws naming the field AND file byte-identical to a pre-call `readFile` snapshot (`seedMilestoneFile` helper); `target`+`clearTarget` throws; not-found throws and `milestones/` gains no file; `abandoned` round-trips through `show`; seeded `status: abandoned` file validates; seeded `status: shipped` rejects naming allowed values; seeded pre-change `open`/`closed` files parse identically (back-compat pin) |
| `tests/cli-milestone.test.ts` | `close` happy path (frontmatter `status: closed`, `git log` contains `chore: close milestone <slug>`, JSON `{ slug, status, committed, commit_sha }`); `close --abandoned` writes `abandoned` with same commit message; close on already-closed → exit 4 + `milestone_conflict` envelope naming current status + byte-identical file; close on missing slug → exit 4 `not_found`, no file created; branch-guard refusal without `--on-branch`; `update --description` replaces body only; `--clear-target` removes key; `--status open` reopens a closed milestone; `--target 2026-02-30 --json` → exit 4, envelope names `target`, byte-identical file; update missing slug → `not_found`; zero field options → exit 4, file untouched; `--target` + `--clear-target` together rejected by Commander |
| `tests/milestone-rollup.test.ts` | mixed open/closed/abandoned sorts open-first then terminal slug-ascending; open/closed-only ordering unchanged (byte-compat pin); `abandoned` passes through the rollup row; `MILESTONE_MARKERS` covers all three statuses |
| `tests/cli-status.test.ts` + a progress test file (`tests/progress-secondary-line.test.ts` or sibling) | one case each: abandoned milestone renders exit 0 with `✗`, sorted after open; existing open/closed assertions double as byte-compat pins |
| `tests/metta-guard-bash.test.ts` | `metta milestone close x` / `metta milestone update x` blocked without credential (exit 2, mirroring the `backlog add` case); allowed with a minted metta-backlog token covering `milestone:close`/`milestone:update` (token-fixture helpers already present); `milestone list`/`show` still allowed credential-free. Note: file currently has **zero** milestone-specific cases (research §1.6) — this closes that gap |

`tests/hooks-byte-identity.test.ts` and `tests/skill-template-anchoring.test.ts` need no edits — they automatically pin/lint the mirrored files. `tests/metta-guard-mint-seam.test.ts` does not enumerate `metta-backlog` scopes (verified by grep) — no edit needed.

## Risks & Mitigations

1. **Forgotten hook template mirror** (files 8/10) — Mitigation: `tests/hooks-byte-identity.test.ts` fails CI on any divergence; the tripwire is pre-existing and requires no new work.
2. **Rollup comparator regression** — the only behavioral rewrite of existing logic. Mitigation: rank comparator is provably identical to the old comparator for two-state inputs (open→0, closed→1 reproduces `a.status === 'open' ? -1 : 1`); byte-compat pin tests in `milestone-rollup`, `cli-milestone`, status, and progress suites.
3. **Skill template drift** (files 11/12) — no byte-identity test pins `.claude/skills/` against `src/templates/skills/`. Mitigation: both files are in the explicit file list above as a paired task; the anchoring lint covers both trees for path hygiene. (Flag for a possible follow-up: a skills byte-identity test analogous to the hooks one.)
4. **Marker glyph rendering** — `✗` (U+2717) is the same width class as `✓` (U+2713); Mitigation: text-mode assertion in the CLI list test verifies column alignment; glyph (not just color) differs, so no-color terminals still distinguish states.
5. **`update --status closed` bypasses `close`'s conflict check** — intentional and symmetric with the reopen scenario (spec US-2): `close` is the guarded transition, `update` is the explicit override verb. Mitigation: documented in both command descriptions.
6. **Forward-compat one-way door** — `status: abandoned` fails validation under older metta builds. Accepted in `intent.md` §Impact; no mitigation beyond documentation.
7. **Frontmatter normalization on first update of hand-edited files** — accepted (research §7): three metta-owned keys, and hand-editing is the workflow being eliminated. Not worth importing the issue store's Document-API minimal-diff machinery.
8. **TOCTOU between the CLI's `show` and the store's `update` re-read in `close`** — single-user, single-process, local files; the store re-validates on its own read. Consistent with every existing metta command. Accepted.
9. **Future programmatic closers** — only `metta-backlog` mints `milestone:close`/`milestone:update`; a future ship/finalize flow wanting to close milestones needs its own scope extension. Mitigation: comment at the `SKILL_SCOPES` line noting the mint boundary; out of scope now.
10. **Vendor lock-in** — none: no new dependencies, no external services; Commander `.conflicts()`/`.choices()` usage is already the repo-wide pattern for option validation.
