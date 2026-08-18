# Research: Auto-retire on issue resolution (US-3)

Area: after `backlog done <slug>` and `fix-issue --remove-issue <slug>` successfully archive an issue, remove any roadmap entry referencing that slug and land `spec/roadmap.md` in the same commit as the archive.

## Current code facts

- **`backlog done`** (`src/cli/commands/backlog.ts:238-286`): guard → `issuesStore.archive(slug, changeName)` → `issuesStore.remove(slug)` → `commitPaths(root, [spec/issues/<slug>.md, spec/issues/resolved/<slug>.md], 'chore: archive shipped backlog item <slug>')` → JSON `{ archived, shipped_in, committed, commit_sha }`. `commitPaths` (backlog.ts:29-45) stages each path independently with per-path swallow, then one commit; commit failure is swallowed (`committed: false`).
- **`fix-issue --remove-issue`** (`src/cli/commands/fix-issue.ts:34-69`): exists check → `archive` → `remove` → inline `git add spec/issues spec/issues/resolved` + `git commit -m 'fix(issues): remove resolved issue <slug>'` inside a swallow-all try/catch → JSON `{ removed: slug }`. Note: this path uses **directory pathspecs** and has **no branch guard** (unlike `backlog done`).
- **Roadmap ↔ issue matching field**: a roadmap entry is `{ slug, note? }` (`RoadmapEntrySchema`, `src/roadmap/roadmap-store.ts:23-27`); `slug` is the issue-store slug, `SLUG_RE`-validated. The bare `roadmap` view and `roadmap next` both resolve entries via `IssuesStore.show(entry.slug)` — so the match is **exact string equality on `entry.slug` vs the resolved issue slug**. Notes never participate. `RoadmapSchema` does *not* enforce slug uniqueness on parse, so a hand-edited `spec/roadmap.md` can carry duplicates (only `add` rejects them).
- **Store write discipline**: `save` = `RoadmapSchema.parse` → `formatRoadmap` → single full `writeRaw`; validation precedes the write, so a throwing retire leaves `spec/roadmap.md` untouched. Missing file → `load()` returns `[]` without creating it.
- **DI**: `CliContext` already carries `roadmapStore` (`src/cli/helpers.ts:37`, constructed at `:125`); both commands already call `createCliContext()`. `RoadmapStore` imports only `state-store` + `util/slug` — **no circular-import or new-wiring concern**; the commands need zero new imports beyond (option-dependent) the store's error/type exports.
- **Issue-logging constraint** (`spec/specs/issue-logging/spec.md:196`, "Backlog done resolves through the issue store archive"): the auto-commit MUST stage *exactly the two file paths* and MUST NOT pass directory pathspecs. The delta spec (`spec.md`, "Issue resolution auto-retires referencing roadmap entries") explicitly narrows this: in the roadmapped case the commit *additionally* contains `spec/roadmap.md`; otherwise the two-path discipline holds verbatim.
- **Existing tests** (exact names — there are no `cli-backlog*.test.ts` / `cli-fix-issue*.test.ts` files):
  - `tests/cli-issue-backlog.test.ts` — covers both commands: `fix-issue --remove-issue` archive/commit tests at lines 166-196; `metta backlog done` describe at lines 715-782, including the exact-two-paths commit assertion via `git show --name-status --format= HEAD` (lines 764-782).
  - `tests/cli-roadmap.test.ts` — CLI roadmap patterns; seeds entries via `backlog add --new` + `roadmap add` (lines 24-28, 50-51); creates dangling entries by `rm`-ing the issue file (line 88).
  - `tests/roadmap-store.test.ts` — store-level unit tests (1:1 ratio home for any new store method).

## Decision 1 — where the hook lands

Identical placement in both commands: **after `issuesStore.archive` + `issuesStore.remove` both succeed, before the commit**, so `spec/roadmap.md` is written to disk in time to join the same commit's path list.

- `backlog done`: retire, then `commitPaths(root, [issues/<slug>.md, issues/resolved/<slug>.md, ...(retired ? ['spec/roadmap.md'] : [])], msg)`. `commitPaths`'s per-path staging already tolerates oddities; the conditional spread preserves the exact-two-paths discipline in the non-roadmapped case.
- `fix-issue --remove-issue`: retire, then append `join('spec', 'roadmap.md')` to the existing `git add` argument list **only when something was retired** — unconditional staging would sweep a pre-existing dirty `spec/roadmap.md` into the commit in the non-roadmapped case, violating the "commit contains only the paths those commands commit today" scenario.

Do **not** use `autoCommitFile` for the roadmap write here: it creates a *separate* commit (spec requires same-commit) and would refuse anyway because the just-archived issue files are dirty at that point (`helpers.ts:184` other-dirty-paths refusal). The `roadmap add/reorder/remove/next` commands keep `autoCommitFile`; the resolution commands' own commit machinery absorbs the extra path.

Ordering note: the spec's "retirement MUST occur only after the archival itself succeeds" is satisfied structurally — any archive throw hits the existing catch before the retire call is reached, and the store's validate-before-write means a failed retire cannot leave a partial `spec/roadmap.md`.

## Decision 2 — store API for the retire step

Three options considered:

**A. Reuse the planned `RoadmapStore.remove(target)` and catch `not_found`.**
Pros: one primitive. Cons: exception-as-control-flow for the *expected* no-match case; `remove` is specced as removing "a single roadmap entry", so hand-edited duplicate slugs would leave a dangling survivor; couples the resolution commands to the CLI-facing error discriminator.

**B. Add a dedicated no-throw `RoadmapStore.retire(slug): Promise<RoadmapEntry[]>`** — filter out **all** entries whose `slug` matches; when none match, return `[]` **without writing** (no `save` call, no file creation when `spec/roadmap.md` is absent); when matches exist, persist through the canonical `save` path (renumbering falls out). ~10 lines in the functional-core/imperative-shell style.
Pros: exact fit for the spec ("*any* roadmap entry referencing that slug MUST be removed"; no-match = "no roadmap write"); duplicate-safe; both call sites become two lines; unit-testable in `tests/roadmap-store.test.ts`. Cons: second removal method next to `remove(target)` — mitigated by both being thin wrappers over `load`/`save`.

**C. Command-level `list()` + filter + save.** Not viable: `save` is private, and exposing it would break the store's validated-write ownership.

**Recommendation: B.** It also keeps `remove(target)`'s throw-on-missing contract clean for the manual CLI subcommand (the other research area) with no semantic tension.

## Decision 3 — failure semantics: fail-open

If the retire step itself throws (e.g. `spec/roadmap.md` unreadable, or `save` fails), **the issue archive must still succeed and commit: catch the retire error locally, warn on stderr, proceed to commit the archive paths only, exit 0.** Fail-open, not fail-closed. Justification against the intent's atomicity assumption:

1. The atomicity the intent and delta spec demand is *"when retirement happens, it lands in the same commit as the archive"* — guaranteed by Decision 1's ordering. It is **not** an all-or-nothing transaction across archive + retire; the spec's only cross-failure clause points the other way ("a failed resolution MUST NOT touch the roadmap").
2. Fail-closed would require un-archiving (copy back from `resolved/`, delete the archive copy) — a new destructive inverse path that can itself fail, for zero user benefit.
3. Exiting 4 after the files have already moved breaks rerun semantics: a retry would hit `not_found` on the now-archived slug. The archive is durable on disk either way; lying about it with a failure exit is worse than reporting it.
4. The worst case under fail-open is exactly today's shipped behavior — a dangling entry — which this same change gives two recovery paths for (`roadmap remove <slug>`, `roadmap next` skip/`--prune`). Degrading to the status quo is an acceptable floor; blocking resolution on a cosmetic file is not.
5. Consistent with the commands' existing posture: both already swallow commit failures rather than failing the resolution.

Surface the degraded case: stderr warning naming the slug and the `metta roadmap remove <slug>` remedy; in JSON the additive field (Decision 5) reports `null` as if no entry matched — plus the warning on stderr, which never corrupts JSON stdout (established pattern, `helpers.ts:118`). If `save` failed *after* a partial state (cannot happen with full-file `writeRaw`, but defensively): the dirty `spec/roadmap.md` is simply not in the commit path list, so it stays visibly uncommitted rather than silently swept.

## Decision 4 — matching and no-op semantics

- Match: `entry.slug === <resolved slug>`, exact, case-sensitive (slugs are lowercase by `SLUG_RE`). Remove **all** matches (duplicate-tolerant per Decision 2).
- No match (including absent `spec/roadmap.md`): `retire` returns `[]`, no write, no file creation, `spec/roadmap.md` omitted from the commit list, output byte-compatible with today except the additive JSON field. This satisfies the "Non-roadmapped resolution is byte-for-byte unchanged behavior" scenario (the scenario constrains writes, commit content, and existing output contract — a read of `spec/roadmap.md` is permitted and unavoidable).

## Decision 5 — JSON/text output (additive only)

- `backlog done --json`: keep `{ archived, shipped_in, committed, commit_sha }` untouched; add `retired_roadmap_entry: string | null` (the slug when an entry was retired, else `null`). Always-present-with-null is friendlier to consumers than a sometimes-key and still strictly additive.
- `fix-issue --remove-issue --json`: keep `{ removed }`; add the same `retired_roadmap_entry` field.
- Text mode: one extra line only when retired, e.g. `  Retired roadmap entry: <slug>` — matching the existing indented detail-line style (`Shipped-in:`, `Committed:`).
- If design wants to report the duplicate-slug multi-removal count, prefer keeping the field a single slug (duplicates are a hand-edit anomaly); do not complicate the shape.

## Decision 6 — DI / imports

No concern. Both commands reach the store via the existing `ctx.roadmapStore` (`CliContext`, `helpers.ts:28-43`). No import cycle: `roadmap-store` depends only on `state-store`/`util`; the commands already sit above both. With option B, the commands import nothing new from the roadmap module (no error-type import needed, since `retire` never throws for the expected cases).

Design flag (host-command parity, not a blocker): `fix-issue --remove-issue` has no main-branch guard, so auto-retire will mutate `spec/roadmap.md` on whatever branch the resolution runs on — inheriting the host command's guard posture is correct (the roadmap edit must ride the archive commit wherever that commit lands), but the design doc should state it explicitly since standalone roadmap mutations are guard-protected.

## Test plan

Store level — `tests/roadmap-store.test.ts` (1:1 ratio):
1. `retire('foo')` removes the matching entry, returns it, remaining entries renumber via the canonical writer.
2. `retire` removes **all** duplicate matches from a hand-written file.
3. No match → returns `[]`, file byte-for-byte unchanged (compare content before/after).
4. Missing `spec/roadmap.md` → returns `[]`, file still absent.

CLI level — extend `tests/cli-issue-backlog.test.ts` (existing home for both commands; seed via the `cli-roadmap.test.ts` pattern: `backlog add <title> --new` → `roadmap add <slug>`):
5. **`backlog done` with matching entry (same-commit assertion):** roadmapped `foo`; run `backlog done foo`; assert entry gone from `spec/roadmap.md`; assert via `git show --name-status --format= HEAD` (the established pattern at lines 777-781) that the single HEAD commit lists `spec/issues/foo.md`, `spec/issues/resolved/foo.md`, **and** `spec/roadmap.md`; assert exactly one new commit (e.g. `git log --format=%s` count).
6. **`backlog done` without matching entry:** roadmap contains only `other`; resolve `baz`; assert `spec/roadmap.md` byte-identical, HEAD commit does **not** list `spec/roadmap.md`, and JSON contains today's fields unchanged.
7. **JSON additivity:** `--json backlog done` on a roadmapped slug still has `archived`/`shipped_in`/`committed`/`commit_sha` with unchanged shapes, plus `retired_roadmap_entry` equal to the slug; non-roadmapped case yields `null`.
8. **`fix-issue --remove-issue` with matching entry:** analogue of (5) — entry removed, `spec/roadmap.md` in the same `fix(issues): remove resolved issue <slug>` commit.
9. **`fix-issue --remove-issue` without matching entry:** analogue of (6), including that a *pre-dirtied* `spec/roadmap.md` is left dirty and out of the commit (guards the conditional-staging rule of Decision 1).
10. **Fail-open:** make the retire step fail deterministically by creating `spec/roadmap.md` as a *directory* (forces `readRaw` to throw); `backlog done` still exits 0, archives, commits the two issue paths, emits the stderr warning, and JSON reports `retired_roadmap_entry: null`.

## Recommendation

Add a no-throw `RoadmapStore.retire(slug): Promise<RoadmapEntry[]>` (remove all matches, no write on no-match, canonical `save` otherwise). In both `backlog done` and `fix-issue --remove-issue`, call it immediately after the archive+remove pair succeeds and before the commit; conditionally append `spec/roadmap.md` to the existing commit path list (`commitPaths` array / `git add` args) only when entries were retired. Retire failures are caught locally: warn on stderr with the `roadmap remove` remedy, commit the archive anyway, exit 0 (fail-open). Report `retired_roadmap_entry: string | null` additively in both JSON outputs and an indented text line when retired. No DI changes — `ctx.roadmapStore` already exists. Tests per the plan above in `tests/roadmap-store.test.ts` and `tests/cli-issue-backlog.test.ts`, reusing the `git show --name-status` same-commit assertion pattern.
