# Design: fix-roadmap-entry-lifecycle-dangling-entries

Sources: `intent.md`, `stories.md` (US-1..US-4), `spec.md` (delta requirements + scenarios), `research.md` synthesis and the three area reports (`research-remove-verb.md`, `research-next-skip.md`, `research-auto-retire.md`). All researched contracts were re-verified against the worktree code and are adopted as-is; no contract was found wrong.

## Approach

Give roadmap entries a complete lifecycle with three coordinated pieces, all built on one shared store core:

1. **Manual exit** — `RoadmapStore.remove(target)` + `metta roadmap remove <position|slug>`: a targeted, typed-error, guard-and-commit-disciplined delete for any entry, dangling or healthy (US-2).
2. **Dangling-tolerant activation** — rewrite the `roadmap next` handler as a *plan phase* (read-only walk classifying entries healthy/dangling via `issuesStore.show`) followed by a *mutate phase* (one batched `removeSlugs` write, one commit). Skip-and-warn replaces the ADR-4 fail-stop; `--prune` opts into removing skipped entries in the same write (US-1, US-4).
3. **Automatic exit** — a no-throw `RoadmapStore.retire(slug)` hooked into `backlog done` and `fix-issue --remove-issue` after a successful archive, with `spec/roadmap.md` conditionally staged into the *same* commit as the archive (US-3).

Design principles applied:

- **One write path.** All three removal surfaces (`remove`, `removeSlugs`, `retire`) share a single private splice-and-save core in `RoadmapStore`; every write flows through the existing canonical `save()` → `RoadmapSchema.parse` → `formatRoadmap`, so renumbering, note preservation, and validate-before-write atomicity are inherited, not reimplemented. Composition over inheritance: the CLI verbs compose store primitives; no store subclassing, no resolver callbacks injected into the store (rejected in research-next-skip §3 Option C — it would couple `RoadmapStore` to `IssuesStore` and invert the functional-core/imperative-shell layering).
- **Store never guesses about CLI text.** The `<position|slug>` disambiguation rule lives at the imperative edge (the CLI handler); the store branches on `typeof target`.
- **Additive output only.** Every JSON change is a new field; every existing field keeps name, shape, and meaning (spec: "Skipped dangling entries are machine-detectable", "JSON reporting of the retirement is additive").
- **No new dependencies, no lock-in.** Everything is filesystem + git + existing internal modules. Nothing in this change touches an external service or vendor API.

## Components

| Component | File | Change |
|---|---|---|
| `RoadmapStore` | `src/roadmap/roadmap-store.ts` | Add `remove`, `removeSlugs`, `retire`; extend `RoadmapValidationError` union with `'not_found'`; **delete `removeTop`** (ADR-4 below); add private splice-and-save core |
| Roadmap CLI | `src/cli/commands/roadmap.ts` | New `remove` subcommand; rewrite `next` handler (plan phase + mutate phase, `--prune` flag, stderr warnings, additive JSON); update `next` help text |
| `backlog done` | `src/cli/commands/backlog.ts` (~238–286) | Post-archive `retire(slug)` hook; conditional `spec/roadmap.md` in `commitPaths` list; additive `retired_roadmap_entry` output |
| `fix-issue --remove-issue` | `src/cli/commands/fix-issue.ts` (~34–69) | Same hook; conditional `join('spec','roadmap.md')` appended to the existing `git add` args; additive `retired_roadmap_entry` output |
| Store tests | `tests/roadmap-store.test.ts` | New `remove` / `removeSlugs` / `retire` blocks; delete `removeTop` block |
| Roadmap CLI tests | `tests/cli-roadmap.test.ts` | New `roadmap remove` block; rewritten `roadmap next` block (inverts the ADR-4 test at lines 299–315); shared branch-discipline and error-contract block extensions; empty-envelope `toEqual` update at line 257 |
| Resolution CLI tests | `tests/cli-issue-backlog.test.ts` | Auto-retire cases for both commands using the existing `git show --name-status` same-commit assertion pattern (lines 764–782) |

No changes to: `mapRoadmapError` (its `instanceof RoadmapValidationError` branch already forwards `err.type` first — verified `src/cli/commands/roadmap.ts:19-25`), `CliContext` (`roadmapStore` already wired, `src/cli/helpers.ts:37,125`), `parseRoadmap`/`formatRoadmap`/entry-line grammar, `reorder`, `add`, `buildPromoteHandoff`, the read-only default roadmap view, or `spec/archive/2026-07-26-roadmap-feature/design.md` (ADR-3 below — the archive is never edited).

## Data Model

**`RoadmapEntry` is unchanged**: `{ slug: string (SLUG_RE), note?: string }`, file grammar unchanged, ordinals remain cosmetic and canonically renumbered on every write.

**Error discriminator union** (the only type-level change):

```ts
export class RoadmapValidationError extends Error {
  constructor(
    readonly type: 'duplicate_entry' | 'invalid_reorder' | 'not_found',
    message: string,
  ) { ... }
}
```

No new error class (ADR-2). Distinct messages per miss shape aid the remedy: position miss → `No roadmap entry at position 9 (roadmap has 3 entries)`; slug miss → `No roadmap entry with slug 'nope'`.

**Matching rule for retire/next**: exact, case-sensitive string equality on `entry.slug` vs the issue-store slug (slugs are lowercase by `SLUG_RE`; notes never participate). `retire` removes **all** matches because `RoadmapSchema` does not enforce slug uniqueness on parse (hand-edited files can carry duplicates; only `add` rejects them).

**Dangling definition** (load-bearing, code-verified): an entry is dangling iff `issuesStore.show(entry.slug)` throws — `show` reads only `spec/issues/<slug>.md`, never `resolved/`, so every resolved roadmapped item is dangling by construction.

## API Design

### 1. Store surface (`src/roadmap/roadmap-store.ts`)

After this change the public mutation surface is: `add`, `reorder`, `remove`, `removeSlugs`, `retire`. `removeTop` is deleted (ADR-4).

```ts
/** Removes one entry by 1-based position (number) or slug (string).
 *  Miss → throws RoadmapValidationError('not_found', ...), file untouched. */
async remove(target: string | number): Promise<{ entry: RoadmapEntry; position: number }>

/** Removes every entry whose slug is in `slugs`, in a single load/validate/save.
 *  Any slug matching no entry → throws RoadmapValidationError('not_found', ...),
 *  file untouched (defensive: `next` passes slugs it just read, so a miss means
 *  a concurrent write). Empty input → no-op, returns [], no write.
 *  Returns removed entries in roadmap order. */
async removeSlugs(slugs: string[]): Promise<RoadmapEntry[]>

/** No-throw retire for resolution hooks: removes ALL entries matching `slug`
 *  (duplicate-tolerant). No match (including absent spec/roadmap.md) → returns []
 *  with no write and no file creation. Returns removed entries. */
async retire(slug: string): Promise<RoadmapEntry[]>
```

Shared core — implemented once, used by all three:

```ts
/** Filters out the entries at `indices`, persists via the canonical save(),
 *  returns the removed entries in roadmap order. Private. */
private async spliceAndSave(
  entries: RoadmapEntry[],
  indices: ReadonlySet<number>,
): Promise<RoadmapEntry[]>
```

- `remove`: `load()` → resolve index (`typeof target === 'number'` → bounds-check `target - 1` against `0..length-1`; string → `findIndex` on slug) → miss throws typed `not_found` → `spliceAndSave` → `{ entry, position: index + 1 }`.
- `removeSlugs`: `load()` → `slugs.length === 0` → return `[]` (no write) → build the index set from a slug `Set`; any input slug with zero matches throws typed `not_found` → `spliceAndSave`.
- `retire`: `load()` → collect all matching indices → none → return `[]` (no `save`, so a missing file is never created) → `spliceAndSave`.

Guarantees inherited from `save()`: canonical renumbering (`formatRoadmap` numbers `index + 1` unconditionally), notes preserved verbatim (entries are spliced, never rebuilt), validate-before-write atomicity (a throw leaves `spec/roadmap.md` byte-for-byte untouched — satisfies the error-contract requirement's no-partial-write clause with zero new machinery). Removing the last entry writes the legal header-only file `# Roadmap\n\n`.

`remove`'s string branch does **not** call `assertSafeSlug`: unlike `add`/`reorder`, `remove` never writes the target string into the file and builds no path from it; a garbage string simply matches nothing and lands in the same typed `not_found` (spec-literal: "via a typed discriminator"). Would-be symmetry via `assertSafeSlug` reaches the same `not_found` envelope through `mapRoadmapError`'s prefix branch anyway — the typed path is cleaner.

### 2. `metta roadmap remove <target>` (CLI)

```
roadmap.command('remove')
  .argument('<target>', '1-based position or entry slug')
  .option('--on-branch <name>', 'Acknowledge non-main branch and proceed')
  .description('Remove a roadmap entry by position or slug')
```

Handler order (normative — mirrors `add`/`reorder`, and the branch-discipline scenario pins guard-before-target-validation):

1. `configLoader.load()` → `assertOnMainBranch(ctx.projectRoot, config.git?.pr_base ?? 'main', options.onBranch)` — **before any roadmap read**.
2. Disambiguate: `/^\d+$/.test(target) ? Number(target) : target` (ADR-1: all-digit input is ALWAYS a position; `remove 0` flows as position 0 → out of range → typed `not_found` with a positional message).
3. `ctx.roadmapStore.remove(parsed)` → `{ entry, position }`.
4. `autoCommitFile(ctx.projectRoot, join(ctx.projectRoot, 'spec', 'roadmap.md'), \`chore: remove roadmap entry ${entry.slug}\`)`.
5. Output — JSON: `{ removed: entry.slug, position, committed, commit_sha }`; text: `Removed from roadmap (was position N): <slug>` + the standard `Committed:` / `Not committed:` lines.
6. Single `catch` → `mapRoadmapError` → `exitWithError` — identical to `add`/`reorder`. `mapRoadmapError` needs **zero changes**: the thrown `RoadmapValidationError('not_found', …)` is forwarded by the existing first branch into `{ error: { code: 4, type: 'not_found', message } }`.

Deliberate non-action: **no `issuesStore` access anywhere in the handler** (spec: "MUST NOT read or modify any file under `spec/issues/`") — this is precisely what makes dangling removal work, and it deliberately differs from `add`, which checks `issuesStore.exists` first.

### 3. `metta roadmap next` rewrite (skip-and-warn + `--prune`)

New flag: `.option('--prune', 'Also remove the skipped dangling entries in the same write and commit')`. Help text updated to describe skip behavior (this retires the wording flagged by issue `roadmap-ts-137-…` exactly as far as the rewrite forces — intent's allowed extent).

Handler structure — **two strictly separated phases** (ADR-8 banks this for a future preview flag):

**Phase 1 — plan (read-only, no store mutation, no output):**
1. Branch guard (unchanged position: before any roadmap read).
2. `entries = await ctx.roadmapStore.list()`.
3. Walk from index 0: for each entry `try { issuesStore.show(slug) }` — failure → push slug onto `skipped[]`, continue; success → `candidate = { slug, title }`, stop. Cost: one file read + parse per walked entry; the default `roadmap` view already pays this for *every* entry, so no batching/caching is warranted.

**Phase 2 — report + mutate:**
4. Emit one **stderr** warning per skipped slug, both output modes (ADR-5):
   `Warning: skipping dangling roadmap entry '<slug>' — spec/issues/<slug>.md not found. Remedy: metta roadmap remove <slug>, or restore spec/issues/<slug>.md`
   Slugs are `SLUG_RE`-validated at parse time — no `stripControlSequences` needed on warning lines (titles still sanitize at the text render edge as today).
5. **Empty roadmap** (`entries.length === 0`): JSON `{ next: null, skipped: [], pruned: [] }`; text `Roadmap is empty — nothing to activate.` Exit 0, no write, no commit. (Uniform-shape choice — see the test-matrix note on updating the strict `toEqual({ next: null })` assertion; additive fields are permitted by the spec, which pins only `next: null` for this case.)
6. **All dangling** (no candidate, `skipped.length > 0`): after the per-entry warnings, guidance — text: `All N roadmap entries are dangling — nothing to activate. Remove them (metta roadmap remove <slug>) or restore the issue files under spec/issues/.`; JSON: `{ next: null, message: <guidance>, skipped: [...], pruned: [] }`. Exit 0. **No store call at all** — `--prune` is structurally inert here (spec: "MUST NOT mutate the roadmap even when --prune is passed"), guaranteed by construction rather than defended by a conditional.
7. **Candidate found**: `handoff = buildPromoteHandoff({ title })`; `toRemove = options.prune ? [...skipped, candidate.slug] : [candidate.slug]`; **one** `ctx.roadmapStore.removeSlugs(toRemove)` call → one write; **one** `autoCommitFile` call. Commit message: base `chore: pop roadmap entry <slug>` always preserved (log-grep automation contract); when prune actually removed entries, append ` (pruned <n> dangling)` — prefix-stable for existing `toContain` assertions.
8. Success output — JSON (additive to today's `{ next, message, committed, commit_sha }`):

```json
{
  "next": "foo",
  "message": "Run: metta propose \"Foo feature\"",
  "skipped": ["ghost-a", "ghost-b"],
  "pruned": ["ghost-a", "ghost-b"],
  "committed": true,
  "commit_sha": "…"
}
```

- `skipped`: always present, roadmap order, `[]` when nothing skipped.
- `pruned`: always present; `[]` unless `--prune` fired on a successful activation, in which case it equals `skipped`. Two arrays (not a boolean) per the spec's "MUST distinguish which of the skipped entries were pruned", future-proof for selective pruning.
- Text mode: today's lines, plus (when pruning fired) `  Pruned <n> dangling entries.`

Failure atomicity: `removeSlugs` validates before its single save, so a concurrent-write race between phase 1 and phase 2 surfaces as a typed `not_found` through the standard envelope with the file untouched.

The dangling condition **never** produces the error envelope on `next` — the fail-stop branch (current `roadmap.ts:157-165`) is deleted entirely (spec: "the previous fail-stop behavior MUST NOT remain in any code path").

### 4. Auto-retire hooks (`backlog done`, `fix-issue --remove-issue`)

Identical placement in both commands: **after `issuesStore.archive` + `issuesStore.remove` both succeed, before the commit** — so the roadmap write is on disk in time to ride the same commit. The spec's "retirement MUST occur only after the archival itself succeeds" is satisfied structurally: an archive throw hits the existing catch before the retire call is reached.

```ts
// shared shape at both call sites
let retired: string | null = null
try {
  const removed = await ctx.roadmapStore.retire(slug)
  if (removed.length > 0) retired = slug
} catch (err) {
  process.stderr.write(
    `Warning: failed to retire roadmap entry '${slug}' — ${getErrorMessage(err)}. ` +
    `Remove it manually with: metta roadmap remove ${slug}\n`,
  )
}
```

- **`backlog done`** (`backlog.ts` ~268): the `commitPaths` list becomes
  `[join('spec','issues',`${slug}.md`), join('spec','issues','resolved',`${slug}.md`), ...(retired !== null ? [join('spec','roadmap.md')] : [])]` — the conditional spread preserves the issue-logging spec's exact-two-paths discipline verbatim in the non-roadmapped case (the change spec's cross-capability note narrows it only for the roadmapped case).
- **`fix-issue --remove-issue`** (`fix-issue.ts` ~50): append `join('spec','roadmap.md')` to the existing `git add` argument list **only when `retired !== null`**. Conditional staging is mandatory — unconditional staging would sweep a pre-dirty `spec/roadmap.md` into the commit in the non-roadmapped case, violating the "commit contains only the paths those commands commit today" scenario. Existing commit messages unchanged (`chore: archive shipped backlog item <slug>` / `fix(issues): remove resolved issue <slug>`).
- **NOT `autoCommitFile`** (ADR-7): it creates a *separate* commit (spec requires same-commit) and would refuse anyway because the just-archived issue files are dirty at that point (`helpers.ts:184` other-dirty-paths refusal). The resolution commands' own commit machinery absorbs the extra path.
- **Fail-open** (ADR-6): a retire failure warns on stderr, the archive commit proceeds with the two issue paths only, exit 0, JSON reports `retired_roadmap_entry: null`. Worst case degrades to today's shipped behavior (a dangling entry), for which this same change provides two recovery paths.
- **Output (additive)**: both JSON payloads gain `retired_roadmap_entry: string | null` (always present; the slug when retired, else `null` — always-present-with-null is friendlier to consumers than a sometimes-key and still strictly additive). `backlog done` → `{ archived, shipped_in, committed, commit_sha, retired_roadmap_entry }`; `fix-issue --remove-issue` → `{ removed, retired_roadmap_entry }`. Text mode: one extra indented line only when retired: `  Retired roadmap entry: <slug>` (matches the `Shipped-in:` / `Committed:` detail-line style). Duplicate multi-removal stays a single-slug report (duplicates are a hand-edit anomaly; the shape stays simple).
- **Guard posture is inherited, stated explicitly**: `fix-issue --remove-issue` has **no** main-branch guard today, so its auto-retire will mutate `spec/roadmap.md` on whatever branch the resolution runs on. This is correct by design — the roadmap edit must ride the archive commit wherever that commit lands — but it means this one roadmap mutation path is not guard-protected, unlike every standalone `roadmap` mutation. This change does not add a guard to `fix-issue` (out of scope; host-command posture governs).
- **DI**: zero new wiring — both commands already build `CliContext` and `ctx.roadmapStore` exists (`helpers.ts:37,125`). With the no-throw `retire`, the commands import no roadmap error types. No import cycle: `roadmap-store` depends only on `state-store` + `util/slug`.

## Dependencies

- **External**: none added. No new npm packages, no network, no vendor surface — nothing in this change creates lock-in.
- **Internal**: existing modules only — `StateStore` (via `RoadmapStore`), `IssuesStore.show` (dangling classification), `assertOnMainBranch` / `autoCommitFile` / `outputJson` / `getErrorMessage` from `src/cli/helpers.ts`, `buildPromoteHandoff`, `commitPaths` (local to `backlog.ts`), the inline git exec in `fix-issue.ts`.
- **Spec cross-dependencies**: narrows issue-logging's "Backlog done resolves through the issue store archive" (exact-two-paths → conditionally three) and extends fix-issues-command's `--remove-issue` commit behavior, both exactly as drafted in this change's `spec.md` cross-capability note. Supersedes roadmap-feature ADR-4 via the merged spec text (ADR-3 below).
- **Sequencing**: `roadmap-store.ts` + its test file are touched by all three areas → single-owner task. `roadmap.ts` hosts both the `remove` verb and the `next` rewrite → one task. `backlog.ts` / `fix-issue.ts` depend only on the store's `retire` landing first; they are independent of the CLI-roadmap task.

## Architecture Decision Records

### ADR-1 — Single `remove(target: string | number)` with CLI-side digit disambiguation

**Decision**: One store primitive branching on `typeof target`; the CLI parses `/^\d+$/` input as a 1-based position, everything else as a slug. **Rationale**: matches the spec's named primitive; keeps text-parsing at the imperative edge (functional-core discipline); the rule is one sentence and deterministic — no fall-back-to-slug second-guessing (spec scenario: `remove 9` on a 3-entry roadmap is `not_found`, full stop). Rejected: two methods (`removeAt`/`removeBySlug` — duplicates plumbing, contradicts the specced primitive, CLI still needs the same rule); store-side disambiguation (pushes CLI semantics into the store). **Consequence**: an all-digit slug (`2024` is legal per `SLUG_RE`) is addressable only by position — acceptable; real slugs are title-derived and the position is always visible in the default `roadmap` view. `/^\d+$/` (not `/^[1-9]\d*$/`) so `remove 0` fails as an out-of-range *position* with a clear message rather than being treated as slug `"0"`.

### ADR-2 — Extend the `RoadmapValidationError` union with `'not_found'`; no new error class

**Decision**: `type: 'duplicate_entry' | 'invalid_reorder' | 'not_found'`. **Rationale**: `mapRoadmapError`'s `instanceof` branch runs first and forwards `err.type` verbatim — zero CLI mapping changes. A parallel `RoadmapNotFoundError` class would add an export, a second `instanceof` branch, and a barrel change for no contract benefit; the spec explicitly prescribes "extending the `RoadmapValidationError` discriminator pattern".

### ADR-3 — Supersede roadmap-feature ADR-4's fail-stop with skip-and-warn (archive not edited)

**Decision**: `roadmap next` no longer exits 4 `not_found` on a dangling entry; it skips with one stderr warning per entry and activates the first healthy entry. The **normative** record of the supersession is the merged spec text (this change's `spec.md` delta → `spec/specs/roadmap-feature/spec.md` on ship, with explicit "supersedes ADR-4" trace lines). This ADR is the forward-referencing decision record, citing the original: `spec/archive/2026-07-26-roadmap-feature/design.md:17` (the ADR-4 decision) and `:248` (its own risk R4, which predicted exactly this wedge and requested the `roadmap remove` escape hatch this change delivers). **The 2026-07-26 archive is immutable and is not edited** — forward references from new artifacts to old are the repo's mechanism; spec text governs, archived ADRs are historical. **Consequence**: an intended, spec'd **breaking change** — automation keyed on exit-4-dangling must migrate to the `skipped` JSON field / stderr warnings (US-4's replacement signal). **Rationale for the flip**: post-PR#85, dangling is the *normal end state of every shipped entry*, not an accident; ADR-4's fail-stop blocks the primary activation flow in the common case, and its printed remedy (`reorder`) can only shuffle a dangling entry deeper, never remove it.

### ADR-4 — Batched `removeSlugs` primitive; `removeTop` deleted

**Decision**: `next` activates via `removeSlugs(slugs[])` — single load/validate/save — and `removeTop` is deleted along with its unit tests. **Rationale**: `--prune` mandates removing the activated entry plus all skipped entries "in the same write and the same auto-commit"; looping single-entry `remove(target)` would be k+1 loads and k+1 writes, violating that and multiplying partial-failure windows. Activating a non-head entry cannot be expressed with `removeTop` at all. After the rewrite, `removeTop`'s sole production caller (the old `next` handler, `roadmap.ts:168`) is gone — a dead mutation primitive on a validated-write store is a liability, not a convenience; the modified spec no longer names it. `remove(target)` must NOT be reused as `--prune`'s mechanism (single-write requirement).

### ADR-5 — Skip warnings go to stderr in both output modes

**Decision**: one warning line per skipped slug on **stderr**, in text *and* JSON mode; the all-dangling guidance line also goes to stderr in JSON mode (stdout stays a single JSON document) and may print to stdout in text mode alongside stderr warnings. **Rationale**: JSON stdout must remain a single parseable document (every `outputJson` consumer `JSON.parse`s stdout); this matches the CLI's established stderr-warning convention (e.g. `helpers.ts:118`); a mode-dependent stream split would make scripts look in different places per mode. **Contract**: JSON consumers use the `skipped`/`pruned` fields; text consumers grep stderr. The spec's "the command's output contains the literal slugs" is satisfied — stderr is command output, and tests assert on `res.stderr`.

### ADR-6 — `retire` is no-throw and duplicate-tolerant; resolution hooks are fail-open

**Decision**: `retire(slug)` returns `RoadmapEntry[]`, removes all matches, returns `[]` with no write on no match, and never throws for expected cases; a retire *failure* in `backlog done` / `fix-issue --remove-issue` is caught locally — stderr warning with the `roadmap remove` remedy, archive commit proceeds, exit 0. **Rationale**: the spec's atomicity clause means *"when retirement happens, it rides the archive commit"*, not all-or-nothing across archive+retire (the only cross-failure clause points the other way: "a failed resolution MUST NOT touch the roadmap" — satisfied by ordering). Fail-closed would require an un-archive inverse (new destructive path that can itself fail); exiting 4 after the files already moved breaks rerun semantics (retry hits `not_found` on the archived slug). Worst case under fail-open is exactly today's behavior — a dangling entry — now with two recovery paths. Consistent with both commands' existing swallow-commit-failure posture. Rejected: reusing `remove(target)` + catching `not_found` (exception-as-control-flow for the *expected* no-match case; single-entry contract leaves hand-edited duplicate survivors).

### ADR-7 — Same-commit staging via the host commands' existing commit path lists, never `autoCommitFile`

**Decision**: the retired roadmap file joins the archive commit by conditionally extending `commitPaths`' array (`backlog done`) / the `git add` args (`fix-issue`), only when something was retired. **Rationale**: `autoCommitFile` creates a separate commit (spec requires same-commit) and refuses when other tracked files are dirty — which the just-archived issue files always are at that point. Conditional (not unconditional) staging preserves the non-roadmapped scenarios of the issue-logging and fix-issues-command specs verbatim and never sweeps a pre-dirty `spec/roadmap.md` into an unrelated commit. **Stated explicitly**: `fix-issue --remove-issue` has no branch guard, and its auto-retire inherits that posture — the roadmap edit lands wherever the archive commit lands.

### ADR-8 — Read-only `next` stays out of scope; handler structured for it anyway

**Decision**: issue `metta-roadmap-next-mutates-on-invocation-with-no-read-only` is **NOT absorbed**. Bare `next` remains a mutating activation — the skip loop changes *which* entry pops, not *whether* popping is the default. **Rationale**: read-only-by-default is a second, independent breaking change (success-contract flip touching the `metta-roadmap` skill, guard Tier-2 semantics, and the orchestrator-routing `{"next": null}` contract) stacked on top of the failure-contract flip this change already makes — doubling the migration surface for consumers like zeus. **Banked composition win**: the handler's plan phase (read-only walk → `skipped` + `candidate`) is strictly separated from the mutate phase, so a future `--pop`-gated or preview mode is a flag check before phase 2 — no rework of the skip logic. The issue stays logged.

## Test Matrix

Near-1:1 ratio holds: every touched source already has its paired test file; no new test files.

### Store — `tests/roadmap-store.test.ts`

| # | Case | Asserts | Spec trace |
|---|---|---|---|
| S1 | `remove(2)` on `a,foo,c` | returns `{entry: foo, position: 2}`; raw file content is the canonical `1. a` / `2. c` renumber | Remove-by-position scenario |
| S2 | `remove('slug')` with noted survivors | notes preserved verbatim | Canonical-writer guarantee |
| S3 | `remove` of the only entry | file becomes `# Roadmap\n\n`; `list()` → `[]` | Edge pin |
| S4 | `remove(0)`, `remove(length+1)` | `RoadmapValidationError` `type: 'not_found'`; file byte-for-byte unchanged | Missing-target scenario |
| S5 | `remove('absent')` | same typed `not_found`, file unchanged | Missing-target scenario |
| S6 | `remove` on missing file | `not_found`; file still not created (`existsSync` false) | Load-without-create |
| S7 | `removeSlugs` middle entry | single write, canonical renumber, notes preserved | next requirement (single write) |
| S8 | `removeSlugs` multiple in one call | one write (single save); removed entries returned in roadmap order | `--prune` single-write scenario |
| S9 | `removeSlugs(['unknown'])` | typed `not_found`, file untouched | Defensive concurrent-write contract |
| S10 | `removeSlugs([])` | no-op, returns `[]`, no write | API contract |
| S11 | `retire('foo')` match | removed + returned; canonical renumber | Auto-retire requirement |
| S12 | `retire` on hand-written duplicates | ALL matches removed | Duplicate tolerance (ADR-6) |
| S13 | `retire` no match | returns `[]`, file byte-for-byte unchanged | Non-roadmapped scenario |
| S14 | `retire` missing file | returns `[]`, file still absent | No file creation |
| — | Delete the `removeTop` describe block (currently lines 167–180) | — | ADR-4 |

### CLI roadmap — `tests/cli-roadmap.test.ts`

| # | Case | Asserts | Spec scenario |
|---|---|---|---|
| C1 | `--json roadmap remove 2` (3 entries) | exit 0; `{removed, position: 2, committed: true, commit_sha}`; raw file renumbered; `git log` contains `chore: remove roadmap entry <slug>` | "Remove by position renumbers through the canonical writer" |
| C2 | `roadmap remove <slug>` on a **dangling** entry (`rm` the issue file per the pattern at line 302) | exit 0; entry gone; nothing under `spec/issues/` touched (file not recreated) | "Remove by slug deletes the matching entry" |
| C3 | text mode remove | `Removed from roadmap` + `Committed:` lines | Output contract |
| C4 | `--json roadmap remove nope` then `remove 9` on 3 entries | both exit 4, `error.type === 'not_found'`, file byte-identical after both | "Missing target fails not_found with no write" |
| C5 | Extend `blocks add, reorder and next off-main` (line 327) with `remove` passing an **invalid** target | `branch_guard`, not `not_found` — pins guard-before-target-validation | "Non-main branch blocks each mutation" |
| C6 | Extend the four-type envelope test (lines 360–383) with the `remove` not_found case | all five failure shapes share `{code: 4, type, message}` | "Envelope shape is consistent across failure types" |
| C7 | Dangling head skipped, healthy second activates | exit 0; stderr contains `ghost`, `metta roadmap remove ghost`, `spec/issues/ghost.md`; JSON `next: 'foo'`, `skipped: ['ghost']`, `pruned: []`; roadmap retains `ghost` at position 1, `foo` gone; commit `chore: pop roadmap entry foo` | "Dangling head is skipped…" |
| C8 | Two consecutive dangling + healthy third | exactly one stderr warning line per slug; `skipped: ['ghost-a','ghost-b']` in order; both ghosts remain | "Multiple consecutive dangling entries…" |
| C9 | `next --prune` | `git rev-list --count` before/after shows exactly one new commit; none of the three slugs remain in the file; JSON `pruned` equals `skipped` | "--prune removes skipped… same write and commit" |
| C10 | All-dangling (with and without `--prune`) | exit 0, no `error` key, `next: null`, non-empty `skipped`, `pruned: []`; roadmap file byte-for-byte unchanged; `git log` unchanged | "All-dangling roadmap is a non-error no-op" |
| C11 | **Empty-envelope update** (line 257): change `toEqual({ next: null })` → `toEqual({ next: null, skipped: [], pruned: [] })`; text branch unchanged | uniform shape, exit 0, no write/commit | "Empty roadmap is a friendly no-op" |
| C12 | **Invert the ADR-4 test (lines 299–315)**: dangling head + healthy second, `--json` | replaces the fail-stop test — no `error` object, exit 0 | "Dangling entries no longer surface through the error contract on next" |
| C13 | Healthy head, nothing skipped | `skipped` present and `[]`; `next`/`message`/`committed`/`commit_sha` unchanged in shape | "Nothing skipped yields an empty skip signal" |
| C14 | Text warnings name every skipped slug | literal `ghost-a`, `ghost-b` on stderr, one line each, with remedy | "Text warnings name every skipped slug" |
| C15 | Off-main + dangling head | still `branch_guard` (guard before roadmap read) | Branch-discipline requirement |
| C16 | Existing sanitization test (lines 268–297) | stands as-is — titles still split JSON-faithful/text-sanitized | Unchanged contract |

### CLI resolution — `tests/cli-issue-backlog.test.ts`

Seeding pattern: `backlog add <title> --new` → `roadmap add <slug>` (per `cli-roadmap.test.ts:24-28`).

| # | Case | Asserts | Spec scenario |
|---|---|---|---|
| R1 | `backlog done foo` with `foo` roadmapped | entry gone from `spec/roadmap.md`; **`git show --name-status --format= HEAD`** (the established pattern at lines 764–782) lists `spec/issues/foo.md`, `spec/issues/resolved/foo.md`, **and** `spec/roadmap.md`; exactly one new commit | "backlog done retires the roadmap entry atomically" |
| R2 | `backlog done baz`, roadmap contains only `other` | `spec/roadmap.md` byte-identical; HEAD commit does NOT list `spec/roadmap.md`; existing JSON fields unchanged | "Non-roadmapped resolution is byte-for-byte unchanged" |
| R3 | `--json backlog done` roadmapped / non-roadmapped | `archived`/`shipped_in`/`committed`/`commit_sha` unchanged in shape; `retired_roadmap_entry` = slug / `null` | "JSON reporting of the retirement is additive" |
| R4 | `fix-issue --remove-issue bar` roadmapped | entry removed; `spec/roadmap.md` in the same `fix(issues): remove resolved issue bar` commit (same git-show pattern) | "fix-issue --remove-issue retires… atomically" |
| R5 | `fix-issue --remove-issue` non-roadmapped with a **pre-dirtied** `spec/roadmap.md` | roadmap file left dirty and OUT of the commit — pins the conditional-staging rule | Conditional staging (ADR-7) |
| R6 | Fail-open: create `spec/roadmap.md` as a **directory** (forces the store read to throw), then `backlog done` | exit 0; archive succeeds; commit contains the two issue paths; stderr warning names the slug + `metta roadmap remove` remedy; JSON `retired_roadmap_entry: null` | Fail-open (ADR-6) |

## Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Breaking change**: automation keyed on `next` exit-4 for dangling heads silently changes behavior | High (intended, spec'd) | Formal ADR-3 supersession in merged spec text; replacement signal is explicit and machine-detectable (`skipped`/`pruned` JSON fields, per-slug stderr warnings); called out in intent Impact and US-4; changelog entry at ship |
| Consumers doing strict `toEqual`-style matching on `next` / `backlog done` / `fix-issue` JSON break on additive fields | Low | Additive-only is the repo's established output contract; only in-repo strict matcher is the empty-envelope test, updated here (C11); spec scenarios pin additivity (C13, R3) |
| Fail-open retire leaves a dangling entry after a successful resolution | Low | Exactly today's shipped behavior as the floor; stderr warning names the one-command remedy; `roadmap remove` and `next` skip/`--prune` both recover it |
| `fix-issue --remove-issue` mutates `spec/roadmap.md` off-main (no branch guard on the host command) | Low | Deliberate, stated inheritance (ADR-7): the roadmap edit must ride the archive commit wherever it lands; adding a guard to `fix-issue` is out of scope |
| All-digit slugs unaddressable by slug in `remove` | Low | Deterministic documented rule (ADR-1); position escape hatch always visible in the default `roadmap` view |
| Concurrent roadmap edit between `next`'s plan and mutate phases | Low | `removeSlugs` throws typed `not_found` before any write; standard envelope, file untouched |
| Commit-message suffix `(pruned <n> dangling)` breaks log greps | Low | Base prefix `chore: pop roadmap entry <slug>` preserved verbatim; suffix only appended when pruning fired; existing tests use `toContain` on the prefix |
| Hand-edited duplicate slugs leave a survivor after retire | Low | `retire` removes ALL matches by design (ADR-6, S12) |
| Deleting `removeTop` breaks an unseen caller | Low | Research grep confirmed the sole production caller is the current `next` handler; class-only export, no external consumers; compile + full test suite gate |
