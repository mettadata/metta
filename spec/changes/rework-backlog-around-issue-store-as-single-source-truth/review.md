# Review: rework-backlog-around-issue-store-as-single-source-truth

Merged from three parallel review personas (iteration 1). Verdicts: correctness FAIL (1 critical), security PASS_WITH_WARNINGS, quality PASS_WITH_WARNINGS.

---

Verdict: FAIL

Reviewed against `git diff $(merge-base HEAD main)..HEAD` plus spec.md. Full suite run: 127 files / 2284 tests, all pass. Frontmatter round-trip, sort comparator, rollup math, migration idempotency, and the repo's own self-migration were additionally verified empirically (tsx scripts against the worktree sources), not just by reading.

## Critical issues

- src/issues/issues-store.ts:154-183 (`createIdea`) + src/cli/commands/backlog.ts:158-161 — `metta backlog add "<title>" --new` silently overwrites an existing issue file when the title slugs to an existing slug. Verified empirically: minting the idea "Gate runner swallows timeout" against a pre-existing `spec/issues/gate-runner-swallows-timeout.md` replaced its entire RCA body with the one-line idea (StateStore.writeRaw is a plain overwrite, src/state/state-store.ts:76-80). This is unguarded data loss on the change's own single source of truth, directly contradicting the change's never-overwrite intent (the migration path enforces it with `wx` + collision checks; this path enforces nothing), and it is reachable through the sanctioned metta-backlog skill "new idea" flow, which never checks for an existing slug. No test covers the collision case. Fix: in `createIdea` (or the CLI `--new` branch), refuse when `spec/issues/<slug>.md` already exists (check `exists(slug)` before `writeRaw`; exit 4 naming the colliding slug).

## Warnings

- src/cli/commands/issue.ts:78-93 — `metta issues list` emits no dangling-milestone warning. Spec requirement "Milestone and priority assignment via issue frontmatter" (spec.md:142) names "issue/milestone listings" as warning surfaces, and the scenario (spec.md:154-157) says "WHEN milestones or issues are listed THEN a warning identifying the dangling reference is emitted". Only `milestone list` warns; `issues list` renders the milestone field (JSON) with no warning path at all.
- src/cli/commands/status.ts:28-37 and src/cli/commands/progress.ts (text milestone section) — text-mode `metta status`/`metta progress` drop milestone warnings entirely; only the `--json` envelopes carry `milestone_warnings`. Spec.md:142 names "status rollups" among the surfaces that MUST emit the dangling-reference warning.
- src/cli/commands/milestone.ts:141-143 — `milestone show` intentionally drops all rollup warnings, so a genuinely dangling reference never warns anywhere in `show`, though spec.md:142 names `milestone show` as a warning surface. The stated reason (single-milestone bucketing can't distinguish "references another valid milestone" from "dangling") is real, but the fix is to bucket against the full milestone list and filter warnings, not to drop them.
- src/cli/commands/backlog.ts:53-77 (`backlog list`), src/cli/commands/issue.ts:81-93 (`issues list`), src/cli/commands/milestone.ts:105-126 (`milestone list`) — no try/catch around store reads: one issue file with invalid frontmatter (or one invalid milestone file) escapes as an unhandled rejection — naked stack trace, exit 1, no `--json` error envelope. The underlying IssueFrontmatterError message is good (names field/value/allowed values), but the delivery breaks the CLI's error-contract everywhere else (exit 4 + typed envelope). Related: a single invalid milestone file makes `metta status`/`progress` fail entirely (milestones-store.ts:109-127 throws from `list()`), a new fragility pre-change status did not have.
- src/cli/commands/backlog.ts:111-114 — `backlog show` maps every error to `not_found`, so an existing issue whose frontmatter is invalid is reported as "Item not found" instead of surfacing the validation error, contradicting "clear validation error that names the offending field".
- src/backlog/backlog-migrate.ts:162 (`migrateItem` → `applyFrontmatterPatch(plan.body, …)`) — a legacy item whose body (after any legacy fence) itself begins with `---\n` makes `applyFrontmatterPatch` treat the body prefix as a frontmatter block: verified that an unclosed second fence throws (`frontmatter opened with '---' at offset 0 has no closing fence`), and a closed second block with legacy keys throws strict-validation errors. The migration then aborts mid-stream with exit 4, items already converted (recoverable on re-run thanks to idempotency-by-derivation, but the collision-style "report and continue" treatment would be more correct than a hard abort).

## Notes

- Frontmatter round-trip verified empirically: CRLF fences re-fenced as CRLF with body bytes preserved; mid-body `---` (thematic break / second fence pair) never touched; body with no trailing newline preserved when minting a block; quoting (`"v0-6"`), key order, and hand-written comments in untouched frontmatter preserved; empty block (`---\n---\n`) patched in place; re-applying an identical patch is byte-identity (idempotent `already_backlogged` path works).
- One benign non-idempotency: a file whose closing fence sits at EOF with no trailing newline gains one on first patch (`---\nbacklog: true\n---` → `…---\n`), so the first re-add of such a file reports `backlogged` instead of `already_backlogged`. Body is empty in that shape, so no bytes are lost; subsequent runs are stable.
- Sort comparator (src/backlog/backlog-view.ts:47-67) matches the spec scenario exactly (C, B, A, D): priority rank high<medium<low<none, order ascending with undefined-after-defined inside a bucket, captured ascending, slug as final tiebreak. Rollup math (src/milestones/milestone-rollup.ts:74) has the zero guard and rounds 1/3 to 33% per spec.
- Self-migration of the metta repo's 8 `spec/backlog/done/` items is present in the branch and correct: bodies byte-preserved under minted `type: idea` frontmatter in `spec/issues/resolved/`, originals archived byte-identically under `spec/archive/backlog-legacy/done/`, `spec/backlog/` gone.
- Archive filtering: `isArchivedChangeDir` correctly guards `progress` (src/cli/commands/progress.ts:96-101) and `release cut` (src/release/release-pipeline.ts:165-169); `ceremony-metrics.ts` skips `backlog-legacy` gracefully (no `.metta.yaml`). Cosmetic: `doc-generator.ts:390-391` will emit a spurious "Archive directory 'backlog-legacy' does not have YYYY-MM-DD prefix — skipped" warning on every doc regeneration after migration.
- Legacy parsing is unchanged: `parseIssue`/`formatIssue` bodies untouched by the diff; frontmatter-less files skip YAML via the offset-0 prefix check and no file is rewritten on read. `**Shipped-in**` stamp placement (appended after body with newline normalization, src/issues/issues-store.ts:254-257) matches the spec and the archived copy carries frontmatter verbatim.
- Exit codes match the spec scenarios: unresolved slug without `--new` → 4 with `--new` suggestion; promote/done/show unknown slug → 4 not_found; milestone duplicate → 4; migrate second run → nothingToDo, exit 0, no commit; collisions reported with exit 0 and zero writes (all covered by passing tests in tests/cli-issue-backlog.test.ts, tests/backlog-migrate.test.ts, tests/cli-milestone.test.ts).
- Guard/mint hook tiering matches spec: `backlog migrate` and `milestone create` Tier-2 under the metta-backlog scope; `milestone list/show` allow-listed read-only; `.claude/hooks/` and `src/templates/hooks/` copies are byte-consistent.
- Pre-existing (not introduced here, for the record): `metta issue`/`IssuesStore.create` has the same silent same-slug overwrite semantics as the critical above; this diff did not change that behavior.

---

Verdict: PASS_WITH_WARNINGS

Security review of `git diff merge-base(HEAD, main)..HEAD` — scope: path construction from slugs/filenames, YAML parsing of untrusted spec files, guard/mint hook tier assignments, execFile auto-commit paths, fs-rename targets in the migration, and Zod `.strict()` coverage.

## Critical issues

None found.

## Warnings

- `src/cli/commands/backlog.ts:27-43` (`commitPaths`) — auto-commit stages entire directories (`git add spec/issues`, and for migrate also `spec/backlog` + `spec/archive/backlog-legacy`). Any unrelated dirty files under those paths are silently swept into the auto-commit (e.g. a hand-edited issue file gets committed under `chore: add backlog item <slug>`). Not exploitable, but it can commit content the user never intended to record. Fix: stage the specific file(s) the command wrote (`spec/issues/<slug>.md`), as `issue.ts` already does via `autoCommitFile`.
- `src/cli/commands/milestone.ts:79` — same pattern: `git add spec/milestones` stages the whole directory for `milestone create`. Fix: `git add spec/milestones/<slug>.md` (slug is already validated at this point).
- `src/cli/commands/milestone.ts:163-171` and `src/cli/commands/backlog.ts:102-109` — issue/milestone titles and description bodies from spec files are echoed to the terminal verbatim. A malicious spec file (attacker-influenced consumer data per the threat model) can embed ANSI escape sequences to spoof terminal output. This extends a pre-existing pattern rather than introducing it; consider stripping C0/escape bytes at the print edge in a follow-up.

## Notes

- **Guard hook tier assignments verified against the code** (`.claude/hooks/metta-guard-bash.mjs`, byte-identical to `src/templates/hooks/metta-guard-bash.mjs`):
  - `milestone list` / `milestone show` allow-listed (line 44); read-only confirmed in `milestone.ts` — no writes on either path.
  - `milestone create` in `BLOCKED_TWO_WORD` (line 65) with Tier-2 scope key `milestone:create`; `backlog migrate` in `BLOCKED_TWO_WORD` (line 61) with key `backlog:migrate`. Both minted only by `metta-backlog` in `metta-session-mint.mjs:30`.
  - Bare `metta milestone` is NOT in `ALLOWED_BARE` (line 77) and classifies as `unknown` → fail-closed (classify at lines 131-141: no bare-allow, no single-word block match, no third word → `unknown`). Same for any unlisted third word (`milestone close`, etc.).
  - The scope-key derivation at lines 262-265 yields `milestone:create` / `backlog:migrate` for the blocked two-word forms, matching the minted scopes exactly — no over-broad `milestone` or `backlog` key is honored.
- **YAML parsing** (`yaml` 2.8.3, verified empirically against the installed package):
  - Alias-bomb input is rejected by the package's default `maxAliasCount` ("Excessive alias count indicates a resource exhaustion attack") — no override disables it anywhere in the diff.
  - `__proto__:` in frontmatter materializes as an own key (no prototype assignment, no global `Object.prototype` pollution), and the strict schemas then reject it as an unrecognized key. Default core schema — no custom tags, no code execution.
  - Non-mapping frontmatter (scalar/sequence) is rejected before Zod in both `issue-frontmatter.ts:130-136` and `milestones-store.ts:50-52`.
- **Zod `.strict()` coverage**: `IssueFrontmatterSchema` (`src/schemas/issue-frontmatter.ts:14`) and `MilestoneFrontmatterSchema` (`src/schemas/milestone-frontmatter.ts:27`) are both `.strict()`. Every read path validates (`parseIssueFrontmatter` → `validateFields`; `parseMilestone` → `validateFrontmatter`); every write path validates before writing (`applyFrontmatterPatch` validates pre-existing fields AND the post-patch field set, `issue-frontmatter.ts:218,223`; `MilestonesStore.create` validates at `milestones-store.ts:97-103`). The `milestone` frontmatter value itself is constrained to `SLUG_RE`, so a hostile value can never reach a path or shell.
- **Slug validation on path construction**: `MilestonesStore.create/show/exists` and `IssuesStore.show/exists/updateFrontmatter/archive/remove` all call `assertSafeSlug` (shared `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/` — no `/`, `.`, or uppercase possible) before any `join()`. CLI-side pre-checks (`issue.ts:37-41` for `--milestone`, `backlog.ts:238-242` for `--change`, `backlog.ts:163/248` before exists) are defense in depth on top of the store asserts. `toSlug`-derived slugs (create/createIdea) are structurally within the safe charset and length.
- **Migration filenames** (`src/backlog/backlog-migrate.ts`): filenames come exclusively from `readdir()` basenames filtered to `.md` — a basename cannot contain a path separator, so `join(issuesDir, file)` / `join(archiveDir, file)` cannot escape `spec/`. Rename targets are fixed at `spec/archive/backlog-legacy/{,done/}` inside `specDir`. Overwrite protection is two-layer: `findCollision` pre-check plus `writeFile(..., { flag: 'wx' })` (`backlog-migrate.ts:165`) — the narrow TOCTOU window between check and write is closed by `wx`. Originals are renamed, never deleted.
- **execFile usage**: all git auto-commit paths (`backlog.ts:31-37`, `milestone.ts:79-81`) use `execFile` with argument vectors — no shell, no interpolation into a command string. Slugs embedded in commit messages are validated before use and are inert as argv elements regardless.
- **Migration partial-failure behavior**: a malformed legacy file (opening `---` with no closing fence) throws mid-loop (`backlog-migrate.ts:78` via `splitFrontmatter`) — already-migrated items are left uncommitted and the command exits 4. Fail-closed and re-runnable (idempotency is derived from the filesystem), so acceptable; noting for operator awareness.
- **`release-pipeline.ts:165-168`** — `isArchivedChangeDir` filter correctly prevents the new non-change `spec/archive/backlog-legacy/` dir from being claimed by `release cut`.
- No secrets, credentials, or token material appear anywhere in the diff; the mint-hook change is scope-list only.

---

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
