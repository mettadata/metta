# Research: commit scoping for backlog auto-commits + issues-store test consolidation

All paths below are relative to the change root
`/home/utx0/Code/metta/.metta/worktrees/fix-follow-ups-backlog-milestones-rework-review-pr-85`
unless shown absolute.

---

## Defect A — `commitPaths` directory pathspecs sweep unrelated dirty files

### Decision

Pass **exact per-file pathspecs** to `commitPaths` at all three call sites. For
`backlog add` and `backlog done` the paths are derivable in `backlog.ts` from the
in-scope `slug`. For `backlog migrate`, extend `MigrationResult` with a
`changedPaths: string[]` field collected inside `migrateLegacyBacklog` (it is the
only place that knows which files were converted vs. skipped on collision).
`commitPaths` itself needs **no changes** — its per-path `git add` with
swallow-on-failure semantics works identically for file pathspecs.

### Facts established

**`commitPaths` semantics** (`src/cli/commands/backlog.ts:28-44`): loops
`git add <path>` per entry with `cwd: projectRoot`, swallowing individual add
failures (pathspec matching nothing), then `git commit -m <message>`; a failed
commit reports `{ committed: false }`. A pathspec that is a directory stages
*everything* dirty under it — the defect.

**Staging a deleted tracked file by explicit path works.** Since Git 2.0,
`git add <pathspec>` records removals for paths matched by the pathspec.[^1]
Verified empirically with the environment's git in a scratch repo: after
`rm spec/issues/a.md`, `git add spec/issues/a.md` exits 0 and
`git status --porcelain` shows `D  spec/issues/a.md` staged while an unrelated
modified file in the same directory stays unstaged. (Note: a WebFetch summary of
the git-add man page initially claimed the opposite by misreading the `--no-all`
paragraph — that paragraph describes pre-2.0 behavior. The empirical check is
authoritative.) A never-tracked nonexistent path makes `git add` error
("pathspec did not match any files"), which `commitPaths` already swallows.

**What each command writes:**

| Call site | Store calls | Files touched |
|---|---|---|
| `backlog add` — `backlog.ts:181` | `createIdea` (`src/issues/issues-store.ts:186-216`) **or** `updateFrontmatter` (`issues-store.ts:223-234`) | Exactly one: `spec/issues/<slug>.md` (create or rewrite). `slug` is in scope at line 181. The `already_backlogged` no-write path already skips the commit (line 180). |
| `backlog done` — `backlog.ts:267-271` | `archive` (`issues-store.ts:281-294`) then `remove` (`issues-store.ts:296-299`) | Two: `spec/issues/resolved/<slug>.md` (created) and `spec/issues/<slug>.md` (deleted). Both sides must be staged — explicit paths handle both (see above). |
| `backlog migrate` — `backlog.ts:304-308` | `migrateLegacyBacklog` (`src/backlog/backlog-migrate.ts:186-264`) | Per converted item, three paths: new target `spec/issues/<file>` (active) or `spec/issues/resolved/<file>` (done); deleted origin `spec/backlog/<file>` or `spec/backlog/done/<file>` (fs-renamed away); new archive copy `spec/archive/backlog-legacy/{,done/}<file>`. Collision items touch nothing. `removeDirIfEmpty` (`backlog-migrate.ts:121-128`) is git-invisible (git does not track directories). |

`MigrationResult` (`backlog-migrate.ts:37-43`) currently returns only counts and
collisions — no per-file paths — so the migrate call site cannot compute exact
paths today. The module already builds project-root-relative, posix-style display
paths (`SPEC_DISPLAY` prefix, e.g. `spec/issues/<file>`, `targetDisplayPath` at
lines 211-215, 228, 238-242, 253) — these are directly usable as git pathspecs
with `cwd: projectRoot`.

### Approaches considered

**A1 (recommended): exact file pathspecs; migrate returns `changedPaths`.**
- `backlog.ts:181` → `commitPaths(ctx.projectRoot, [join('spec', 'issues', `${slug}.md`)], ...)`
- `backlog.ts:269` → `[join('spec', 'issues', `${slug}.md`), join('spec', 'issues', 'resolved', `${slug}.md`)]`
- `backlog-migrate.ts`: add `changedPaths: string[]` to `MigrationResult`; in each
  conversion loop push `plan.targetDisplayPath`, `legacyDisplayPath`, and the
  archive destination (`${ARCHIVED_TO}/<file>` / `${ARCHIVED_TO}/done/<file>`) —
  only after `migrateItem` succeeds. `backlog.ts:306` → pass `result.changedPaths`.
- Pros: eliminates the sweep entirely; commit contains exactly what the command
  wrote; `commitPaths` untouched; migrate paths derived at the single source of
  truth (collision-skipped items naturally excluded). Cons: small
  `MigrationResult` shape change ripples into two full-object `toEqual`
  assertions in `tests/backlog-migrate.test.ts:57` and `:264` (add
  `changedPaths: []`).

**A2: keep staging as-is, switch to pathspec-limited commit (`git commit -m msg -- <paths>`).**
Commits only named paths regardless of index state. Still requires the exact
path list (so all of A1's plumbing anyway), and pathspec-limited commits have
subtler semantics around already-staged unrelated content (they commit
working-tree state of the named paths, leaving the index confusing). Rejected —
no benefit over A1, more git edge cases.

**A3: narrower directory pathspecs only (minimal churn).**
E.g. keep `spec/issues` out of migrate, keep dirs elsewhere. Rejected — any
directory pathspec over the shared `spec/issues/` still sweeps unrelated dirty
issue files (the reported defect scenario), and `spec/archive/` is also shared.

### Rationale

A1 is the only approach that makes the auto-commit provably scoped. The cost is
one additive result-field and ~6 changed lines across two modules. Existing CLI
coverage stays green: `tests/cli-issue-backlog.test.ts:571-589` asserts the
`done` commit contains both the deleted and created path (rename or D+A) — the
explicit-path version satisfies it; the migrate happy-path test (same file,
`converts active and done items... commits`) asserts commit message and file
placement only. Recommend adding one regression test per command: seed a dirty
unrelated file under `spec/issues/`, run the command, assert the file is absent
from `git show --name-status HEAD` and still dirty in `git status --porcelain`.

[^1]: https://git-scm.com/docs/git-add accessed 2026-08-17 — `--no-all` note:
  older Git's `git add <pathspec>` "was a synonym for git add --no-all
  <pathspec>, i.e. ignored removed files"; current default records removals.
  Confirmed empirically with local git (staged `D` for an explicitly-added
  deleted file, unrelated dirty sibling left unstaged).

---

## Defect B — duplicate issues-store test files; src copy compiles into dist

### Decision

Fold the nine describe-blocks of `src/issues/issues-store.test.ts` into
`tests/issues-store.test.ts`, delete the src copy, **and** add
`"src/**/*.test.ts"` to the tsconfig `exclude` array so the five other src-side
test files stop shipping in `dist/` too.

### Facts established

**The two files are disjoint suites, not copies.** `diff` shows near-total
divergence (401 vs. 110 lines).

Unique to `src/issues/issues-store.test.ts` (all must move):
1. `IssuesStore parseIssue body tolerance` — 3 tests (freeform body, structured H2 body, H2-at-body-start metadata boundary)
2. `IssuesStore legacy (frontmatter-less) files` — 2 tests (byte-unchanged parse with type/backlog defaults; legacy archive+remove verbatim/no-stamp)
3. `IssuesStore frontmatter-aware list/show` — 4 tests (list surfaces fm fields; `captured` falls back to `**Added**`; show strips fm block; partial fm defaults)
4. `IssuesStore.create with frontmatter fields` — 2 tests (priority/milestone block written; no block for empty fields object)
5. `IssuesStore.createIdea` — 2 tests (full fields; minimal)
6. `IssuesStore never-overwrite slug collision guard` — 5 tests (`IssueSlugCollisionError` on open/resolved collisions from both `create` and `createIdea`; typed-error fields)
7. `IssuesStore.updateFrontmatter` — 4 tests (adds block preserving body bytes; idempotent `changed: false`; targeted patch; not-found)
8. `IssuesStore.listResolved` — 2 tests (record shape over `resolved/`; empty when absent)
9. `IssuesStore.archive frontmatter carry-through and Shipped-in stamp` — 3 tests (verbatim carry; `**Shipped-in**` appended; unsafe changeName rejected)

Unique to `tests/issues-store.test.ts` (keep as-is): create/show round-trip,
critical severity, list with severity, context capture, empty list, archive copy
semantics + not-found + idempotency, remove + ENOENT, path-traversal slug
rejection across archive/remove/show/exists.

Only soft overlap: src item 2's "legacy archive + remove flow" partially
duplicates the tests-side archive/remove basics — keep both (assertions differ:
byte-identity vs. content/ENOENT) or drop the src one; either is fine.

Mechanical port notes: change the import to
`from '../src/issues/issues-store.js'` and add `IssueSlugCollisionError` to it;
carry over the src copy's helpers (`issuePath`, `resolvedPath`, `seedIssueFile`)
and its sync-fs imports (`mkdtempSync`/`rmSync`/`readFileSync`/`writeFileSync`/`mkdirSync`)
— vitest config has `globals: true` so mixed styles coexist; the two files use
separate top-level `describe` scopes so `beforeEach` fixtures do not clash if the
src copy's module-level `beforeEach` is nested under a wrapper describe (wrap the
ported content in one `describe` to keep its `tmpDir`/`store` setup scoped).

**Why the src copy lands in `dist/`:** `tsconfig.json:18-19` —
`"include": ["src/**/*"]`, `"exclude": ["node_modules", "dist", "tests"]`. No
test-file pattern is excluded, so `tsc` (the `build` script, `package.json:17`)
emits `dist/issues/issues-store.test.js` + `.d.ts` + maps. Deleting the file
suffices **for this duplicate**, but five more src-side test files compile into
dist for the same reason: `src/config/build-stamp.test.ts`,
`src/config/config-writer.test.ts`, `src/config/repair-config.test.ts`,
`src/config/version-drift.test.ts`, `src/finalize/finalize-lock.test.ts`. No src
module imports any `.test.ts` file, so excluding them cannot break the build.

### Approaches considered

**B1 (recommended): consolidate + delete + tsconfig exclude.**
Add `"src/**/*.test.ts"` to `exclude` in `tsconfig.json:19`. Pros: fixes the
whole class (all six files out of dist), zero runtime impact, vitest is
unaffected (its own include `['tests/**/*.test.ts', 'src/**/*.test.ts']` in
`vitest.config.ts` keeps running the remaining five src-side tests via its own
transform). Con: `npm run lint` (`tsc --noEmit`, `package.json:23`) stops
typechecking those five files — but that is already true of every file in
`tests/` (excluded today), so this restores consistency rather than losing
coverage that `tests/` has.

**B2: delete the duplicate only, no tsconfig change.**
Minimal diff; but `dist/` keeps shipping five compiled test files, and the next
src-side test recreates the defect. Rejected as incomplete.

**B3: relocate all six src test files into `tests/`.**
Cleanest long-term (matches the dominant convention and the 1:1 ratio note in
CLAUDE.md), but touches five files unrelated to this change's scope and their
relative imports. Out of scope here; worth a backlog item. The tsconfig exclude
in B1 makes dist correct either way.

### Rationale

B1 fixes the reported duplicate, prevents dist pollution structurally, and keeps
the change scoped. Vitest discovery is config-driven (`vitest.config.ts`
include), not tsconfig-driven, so tests keep running; `tsc` build output is
tsconfig-driven, so the exclude is the correct lever.

---

## Concrete edit plan (summary)

1. `src/backlog/backlog-migrate.ts` — add `changedPaths: string[]` to
   `MigrationResult` (line 37-43); initialize `changedPaths: []` in `result`
   (line 197-202); after each successful `migrateItem` push
   `[targetDisplayPath, legacyDisplayPath, archiveDisplayPath]` (active loop
   ~line 223-232, done loop ~line 248-257; archive display paths:
   `${ARCHIVED_TO}/${file}` and `${ARCHIVED_TO}/done/${file}`).
2. `src/cli/commands/backlog.ts` — line 181: `[join('spec', 'issues', `${slug}.md`)]`;
   line 269: `[join('spec', 'issues', `${slug}.md`), join('spec', 'issues', 'resolved', `${slug}.md`)]`;
   line 306: `result.changedPaths`.
3. `tests/backlog-migrate.test.ts` — add `changedPaths: []` to the two
   full-object `toEqual`s (lines 57, 264); optionally assert populated
   `changedPaths` in the conversion tests.
4. `tests/cli-issue-backlog.test.ts` — add sweep-regression tests: dirty
   unrelated `spec/issues/*.md` stays out of the auto-commit for
   `add`/`done`/`migrate`.
5. `tests/issues-store.test.ts` — append the nine ported describe-blocks
   (wrapped in one scoping `describe`), import `IssueSlugCollisionError`.
6. Delete `src/issues/issues-store.test.ts`.
7. `tsconfig.json` — `"exclude": ["node_modules", "dist", "tests", "src/**/*.test.ts"]`.
