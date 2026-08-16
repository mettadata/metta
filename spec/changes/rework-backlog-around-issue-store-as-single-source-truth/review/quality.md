Verdict: PASS_WITH_WARNINGS

Reviewed: full diff `merge-base(HEAD, main)..HEAD` — all new modules read in full (issue-frontmatter, backlog-view, backlog-migrate, milestones-store, milestone-rollup, milestone command, archive-dirs, issues-store), all modified CLI commands, skill/hook templates, and both issues-store test files. `npx tsc --noEmit` is clean; the 7 new/changed unit test files (120 tests) all pass.

## Critical issues

None. No dead code paths, no broken imports, no unvalidated writes found in the new modules.

## Warnings

1. **src/cli/commands/refresh.ts:176 — `metta refresh` still regenerates the retired store into CLAUDE.md.** `buildReferenceSection` emits `| [Backlog](spec/backlog/) | \`spec/backlog/\` | Prioritized backlog items |`, so every refresh re-advertises `spec/backlog/` as a live store (contradicting the change's own skill rule "spec/backlog/ is not a store"), and there is no `spec/milestones/` row. Fix: update the row to point at the issue-frontmatter backlog view and add a milestones row. Neither tasks.md nor design.md defers this — it appears to be an oversight, not a scoping decision.

2. **Stale hand-maintained docs describe the deleted BacklogStore.** None of these were touched by the change:
   - docs/internals/architecture.md:45 — module table row for `src/backlog/` still says `backlog-store.ts` / "CRUD over prioritized backlog items in spec/backlog/" (file is deleted).
   - docs/internals/architecture.md:96 — `BacklogStore` still listed among store classes.
   - docs/workflows/state.md:270-287 — full section documenting `spec/backlog/` as a store owned by `BacklogStore (src/backlog/backlog-store.ts)` and `backlog done` relocating to `spec/backlog/done/`.
   - docs/workflows/skills.md:479-501 — old backlog skill semantics (owns `spec/backlog/`, archives to `spec/backlog/done/`).
   - docs/workflows/README.md:23 — "Reads/writes `spec/backlog/`".
   - docs/guide/troubleshooting.md:73 and docs/internals/guard-hooks.md:223 — cite `metta backlog add` as the command that "owns creation" of `spec/backlog/` files.
   Fix: one docs pass replacing store semantics with the frontmatter-view + `spec/issues/resolved/` + migration story.

3. **src/templates/hooks/metta-guard-edit.mjs:130 — `ALLOW_PREFIXES` still whitelists `spec/backlog/` `.md` edits** (comment at :125-127 still names `metta backlog add` as the creating command). After migration the directory is removed and nothing should be hand-edited there. Harmless during the migration window, but either drop the prefix or annotate it as a deliberate legacy-window allowance so the next reader doesn't treat it as current semantics.

4. **Two test files for one module: src/issues/issues-store.test.ts (22 tests, colocated, sync `node:fs`) and tests/issues-store.test.ts (11 tests, `tests/` dir, async `fs/promises`).** Both are picked up by vitest (`include: ['tests/**', 'src/**']`) and they overlap on archive/remove/create basics (e.g. tests/issues-store.test.ts:55 "archive moves content..." vs src/issues/issues-store.test.ts:94 "legacy archive + remove flow is unchanged"). The colocated file should absorb tests/issues-store.test.ts (or vice versa — repo precedent is mixed, `src/config/` has colocated tests) so there is a single home per module. As-is, coverage for one store is split across two files with two different fs idioms.

5. **Auto-commit logic now exists in three variants.** `commitPaths` (src/cli/commands/backlog.ts:28-44, new), an inline `git add`/`commit`/`rev-parse`/swallow block (src/cli/commands/milestone.ts:76-86), and `autoCommitFile` (src/cli/helpers.ts). milestone.ts's inline block is byte-for-byte the pattern `commitPaths` was written to replace. Fix: hoist `commitPaths` into helpers.ts and use it in milestone.ts.

6. **Frontmatter fence parsing duplicated between issue-frontmatter.ts and milestones-store.ts.** milestones-store.ts:20 (`FRONTMATTER_RE`), :50-52 (mapping check), :26-34 (validate wrapper) reimplement what issue-frontmatter.ts already provides (`splitFrontmatter`:82, `assertMapping`:130, `validateFields`:117). The milestone read path could call `splitFrontmatter` + a shared mapping assert; two independent fence parsers with subtly different edge handling (offset scan vs lazy regex) is a divergence risk. Acceptable for now — milestones never patch existing blocks — but worth consolidating.

7. **`backlog add` and `issue` validate `--milestone` inconsistently.** src/cli/commands/issue.ts:37-49 pre-validates the milestone against `SLUG_RE` (typed `invalid_milestone` error) and warns on a dangling reference via `milestonesStore.exists`. src/cli/commands/backlog.ts `add` does neither: a malformed milestone surfaces as a generic `backlog_error` carrying a raw Zod rendering from `applyFrontmatterPatch`, and a valid-but-nonexistent milestone slug is silently accepted with no dangling warning. Fix: mirror issue.ts's pre-check + warning in `backlog add`.

8. **`PRIORITIES` const + `Priority` type duplicated** in src/cli/commands/issue.ts:5-6 and src/cli/commands/backlog.ts:11-12, with near-identical validation blocks. Minor — extract to a shared CLI helper or derive from the Zod enum in src/schemas/issue-frontmatter.ts:11.

## Notes

- **Naming/conventions: clean.** All new files kebab-case, functions camelCase, classes PascalCase, every new import carries `.js`, no CommonJS, no string-literal templates in TS (skill/hook content lives under src/templates/), custom `IssueFrontmatterError` with typed fields, Zod validation before every write in issue-frontmatter.ts (:201, :218, :223) and milestones-store.ts (:97).
- **1:1 test ratio: satisfied.** issue-frontmatter → tests/issue-frontmatter.test.ts (37 tests), backlog-view → tests/backlog-view.test.ts, backlog-migrate → tests/backlog-migrate.test.ts, milestones-store → tests/milestones-store.test.ts, milestone-rollup → tests/milestone-rollup.test.ts, milestone command → tests/cli-milestone.test.ts, archive-dirs → tests/archive-dirs.test.ts (covers both the pure predicate and the progress/release consumers).
- **Test quality: good.** Every stateful test file mints a fresh `mkdtemp` dir in `beforeEach` and removes it in `afterEach` (with retry args matching repo convention); pure-module tests (backlog-view, milestone-rollup, issue-frontmatter) touch no fs. No shared module-level fixtures or order dependence found. Migration tests cover both legacy formats, collisions, idempotent re-run, and dir removal; frontmatter tests cover CRLF, BOM-adjacent legacy path, byte-preservation, and validation-before-mutation.
- **Barrel exports match design.md:46 exactly** (backlog-store removed; backlog-view, backlog-migrate, issue-frontmatter, milestones-store, milestone-rollup, archive-dirs added; both new schemas exported from src/schemas/index.ts).
- **Guard/mint templates and deployed `.claude/hooks` + `.claude/skills` copies updated in sync** (`backlog migrate` and `milestone create` Tier-2 blocked, `milestone list/show` allow-listed, mint scopes extended).
- src/issues/issues-store.ts:212-228 `listDir` does not sort `readdir` entries (milestones-store.ts:120 does) — `metta issues list` order is filesystem-dependent. Pre-existing behavior, and the backlog view sorts independently, so no functional bug; sorting for determinism would be a one-line improvement.
- src/issues/issues-store.ts:225 `entry.replace('.md', '')` strips the first `.md` occurrence rather than the suffix — pre-existing pattern; only misbehaves on filenames with an interior `.md`.
- `backlog done` (src/cli/commands/backlog.ts) archives any existing issue regardless of `backlog: true`, while its not-found message says "Backlog item '<slug>' not found". Presumably intentional (shares archive semantics with fix-issue), but the flag is never checked — worth confirming against the spec's Given/When for `done`.
- Milestone rollup warnings reach stderr in `milestone list` text mode but are silently dropped in `status`/`progress` text mode (JSON carries them in all three). Minor inconsistency, likely deliberate to keep dashboards quiet.
- src/issues/issues-store.ts:246 comment cites "`BacklogStore.archive` semantics" — fine as a historical breadcrumb since backlog-migrate.ts:21 already marks the store as retired, but "retired BacklogStore" would prevent readers from grepping for a live class.
