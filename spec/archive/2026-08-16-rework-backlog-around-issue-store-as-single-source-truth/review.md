# Review: rework-backlog-around-issue-store-as-single-source-truth

Round 2 (final). Verdicts: correctness PASS_WITH_WARNINGS, security PASS_WITH_WARNINGS, quality PASS_WITH_WARNINGS. Round 1 found one critical (createIdea/create silent slug-collision overwrite), fixed in 740bee3eb and re-verified.

---

Verdict: PASS_WITH_WARNINGS

Round 2. Round-1 critical (silent slug-collision overwrite in `createIdea`/`create`) is fixed in commit 740bee3eb and verified empirically. Round-1 warnings were re-assessed: all remain, none rises to critical, and the fix commit touched only src/issues/issues-store.ts, src/cli/commands/backlog.ts, and two test files, so the warned areas are unchanged. Targeted verification this round: `npx vitest run src/issues/issues-store.test.ts tests/cli-issue-backlog.test.ts` — 2 files / 77 tests, all pass (includes the 8 new collision tests); the four other issues-adjacent test files (tests/issues-store.test.ts, tests/backlog-view.test.ts, tests/issue-frontmatter.test.ts, tests/milestone-rollup.test.ts) — 68 tests, all pass; `npx tsc --noEmit` clean.

## Critical issues

None. The round-1 critical is resolved:

- src/issues/issues-store.ts:136-146 — new private `assertNoSlugCollision` checks BOTH `spec/issues/<slug>.md` and `spec/issues/resolved/<slug>.md` and throws the typed `IssueSlugCollisionError` (src/issues/issues-store.ts:114-122, carries `slug` + `existingPath`) before any write. Called first thing in both `create` (line 156) and `createIdea` (line 192), so the guard covers `metta issue` and `metta backlog add --new` alike — the round-1 "pre-existing same overwrite in `create`" note is also resolved.
- src/cli/commands/backlog.ts:195-202 — `--new` maps the typed error to exit 4 with `type: 'slug_collision'` (JSON) and a text-mode message that names the colliding path and suggests `metta backlog add <slug>` for the existing issue. Verified by the three new CLI tests (tests/cli-issue-backlog.test.ts:355-405): open-issue collision, text-mode suggestion, resolved-issue collision — each asserts the pre-existing file is byte-identical after the refused call and (for resolved) that nothing was minted in `spec/issues/`.
- Store-level tests (src/issues/issues-store.test.ts:234-298) cover both methods against both open and resolved collisions plus the typed-error shape (slug, existingPath, message).

## Warnings

Carried over from round 1, re-confirmed at the same severity (none critical — all are missing-warning/error-presentation gaps, not data loss):

- src/cli/commands/issue.ts:78-93 — `metta issues list` emits no dangling-milestone warning. Spec requirement "Milestone and priority assignment via issue frontmatter" (spec.md:142) names "issue/milestone listings" as warning surfaces, and the scenario (spec.md:154-157) says "WHEN milestones or issues are listed THEN a warning identifying the dangling reference is emitted". Only `milestone list` warns; `issues list` renders the milestone field (JSON) with no warning path at all.
- src/cli/commands/status.ts:28-37 and src/cli/commands/progress.ts (text milestone section) — text-mode `metta status`/`metta progress` drop milestone warnings entirely; only the `--json` envelopes carry `milestone_warnings`. Spec.md:142 names "status rollups" among the surfaces that MUST emit the dangling-reference warning.
- src/cli/commands/milestone.ts:141-143 — `milestone show` intentionally drops all rollup warnings, so a genuinely dangling reference never warns anywhere in `show`, though spec.md:142 names `milestone show` as a warning surface. The fix is to bucket against the full milestone list and filter warnings, not to drop them.
- src/cli/commands/backlog.ts:53-77 (`backlog list`), src/cli/commands/issue.ts:81-93 (`issues list`), src/cli/commands/milestone.ts:105-126 (`milestone list`) — no try/catch around store reads: one issue file with invalid frontmatter (or one invalid milestone file) escapes as an unhandled rejection — naked stack trace, exit 1, no `--json` error envelope. Related: a single invalid milestone file makes `metta status`/`progress` fail entirely (milestones-store.ts throws from `list()`).
- src/cli/commands/backlog.ts:112-115 — `backlog show` maps every error to `not_found`, so an existing issue whose frontmatter is invalid is reported as "Item not found" instead of surfacing the validation error, contradicting "clear validation error that names the offending field".
- src/backlog/backlog-migrate.ts:162 — a legacy item whose body (after any legacy fence) itself begins with `---\n` makes `applyFrontmatterPatch` treat the body prefix as frontmatter and the migration aborts mid-stream with exit 4 (recoverable on re-run thanks to idempotency-by-derivation, but the collision-style "report and continue" treatment would be more correct).
- New, minor: src/cli/commands/issue.ts:66-71 — `metta issue` on a slug collision falls into the generic catch and reports `type: 'issue_error'` instead of the `slug_collision` type that `backlog add --new` uses. Exit code (4) and message (the typed error's "collides with existing … refusing to overwrite") are correct and clear; only the JSON `type` discriminator is inconsistent between the two entry points.

## Notes

- Regression check on the fix's semantic change: `metta issue <same title>` now exits 4 instead of silently replacing the file. No spec requirement anywhere mandates overwrite-on-duplicate — the issue-logging spec (spec/specs/issue-logging/spec.md) is silent on duplicate slugs, while the change spec explicitly requires refuse-to-overwrite for the analogous surfaces (`milestone create` MUST refuse, spec.md:123; migration MUST NOT overwrite on collision, spec.md:189). Refusal is the consistent, safer reading. Only two production call sites exist (src/cli/commands/issue.ts:56, src/cli/commands/backlog.ts:160); the migration path uses its own `wx`-flag writes and is unaffected.
- Deliberate strictness worth knowing: because the guard also checks `spec/issues/resolved/`, a previously resolved issue that recurs cannot be re-logged under the identical title — the user must vary the title (or clear the resolved copy). This is intentional and defensible: `IssuesStore.archive` (issues-store.ts:281-294) still uses a plain `writeRaw` into `resolved/`, so allowing an open/resolved slug pair would reintroduce an overwrite at `backlog done` time. The create-time guard closes that path.
- Fix verification detail: collision tests assert byte-identity of the pre-existing file after the refused call (both store-level and through the CLI), and the resolved-collision tests additionally assert nothing was minted in `spec/issues/`. The guard runs before `mkdir`/`writeRaw` in both methods, so no partial write is possible.
- Round-1 empirical validations still stand (unchanged code): frontmatter round-trip byte-preservation (CRLF fences, mid-body `---`, quoting, key order, idempotent re-patch); sort comparator matches the spec scenario (priority rank, order-with-undefined-after-defined, captured, slug); rollup zero-guard and 33% rounding; self-migration of the repo's 8 `spec/backlog/done/` items with byte-identical archived originals; exit codes for unresolved slug/promote/done/show/milestone-duplicate/migrate-rerun all covered by passing tests; guard/mint hook tiering matches spec with byte-consistent `.claude/hooks/` and `src/templates/hooks/` copies.
- Benign non-idempotency (round 1, still present, still benign): a file whose closing fence sits at EOF with no trailing newline gains one on first patch, so the first re-add reports `backlogged` instead of `already_backlogged`; no bytes lost, stable afterwards.
- Cosmetic (round 1): doc-generator.ts:390-391 emits a spurious "Archive directory 'backlog-legacy' does not have YYYY-MM-DD prefix — skipped" warning on every doc regeneration after migration.

---

Verdict: PASS_WITH_WARNINGS

Security review, round 2. Round 1 covered `git diff merge-base(HEAD, main)..HEAD` (path construction from slugs/filenames, YAML parsing of untrusted spec files, guard/mint hook tier assignments, execFile auto-commit paths, fs-rename targets in the migration, Zod `.strict()` coverage). Round 2 covers the delta of fix commit 740bee3eb (`IssueSlugCollisionError` + `assertNoSlugCollision` never-overwrite guard, `slug_collision` exit-4 handling, tests). The fix introduces no security regression and closes a data-loss path (silent overwrite of an existing issue file on `--new`). Round-1 verdict and warnings stand unchanged.

## Critical issues

None found (rounds 1 and 2).

## Warnings

Carried from round 1, still applicable — the fix commit does not touch these:

- `src/cli/commands/backlog.ts:28-44` (`commitPaths`) — auto-commit stages entire directories (`git add spec/issues`, and for migrate also `spec/backlog` + `spec/archive/backlog-legacy`). Any unrelated dirty files under those paths are silently swept into the auto-commit (e.g. a hand-edited issue file gets committed under `chore: add backlog item <slug>`). Not exploitable, but it can commit content the user never intended to record. Fix: stage the specific file(s) the command wrote (`spec/issues/<slug>.md`), as `issue.ts` already does via `autoCommitFile`.
- `src/cli/commands/milestone.ts:79` — same pattern: `git add spec/milestones` stages the whole directory for `milestone create`. Fix: `git add spec/milestones/<slug>.md` (slug is already validated at this point).
- `src/cli/commands/milestone.ts:163-171` and `src/cli/commands/backlog.ts:102-109` — issue/milestone titles and description bodies from spec files are echoed to the terminal verbatim. A malicious spec file (attacker-influenced consumer data per the threat model) can embed ANSI escape sequences to spoof terminal output. This extends a pre-existing pattern rather than introducing it; consider stripping C0/escape bytes at the print edge in a follow-up. (Note: the new `slug_collision` error path is NOT affected — its message is built only from the `toSlug`-derived slug and a fixed relative path, never the raw title, so it adds no new injection surface.)

## Notes

### Round 2 — delta of commit 740bee3eb

- **Guard placement verified**: `assertNoSlugCollision(slug)` is the first statement after `toSlug(title)` in both `IssuesStore.create` (`src/issues/issues-store.ts:155-156`) and `createIdea` (`issues-store.ts:191-192`) — before `mkdir`, before `writeRaw`, before any filesystem mutation. On collision the store throws and nothing is written; tests assert byte-identical preservation of the existing file for both open and resolved collisions (`src/issues/issues-store.test.ts:234-298`, `tests/cli-issue-backlog.test.ts:355-406`).
- **Path construction in the guard is safe**: candidates are `join('issues', slug + '.md')` and `join('issues', 'resolved', slug + '.md')` where `slug` comes exclusively from `toSlug` (safe charset `[a-z0-9-]`, no `/` or `.` segments possible), checked via `StateStore.exists` — no traversal, no new path surface. The `spec/`-relative path in the error message (`issues-store.ts:117,143`) is relative, not absolute — no path leak beyond what is acceptable for a local CLI anyway.
- **CLI error handling** (`src/cli/commands/backlog.ts:195-202`): the `instanceof IssueSlugCollisionError` branch runs before the generic handler, exits 4 in both JSON and text modes, and interpolates only `err.slug` (safe charset) and `err.message` (slug + fixed relative path) into the suggestion string — no raw user title is echoed, so no ANSI-injection regression at this print edge. JSON output goes through the existing `outputJson` helper, consistent with other error paths.
- **TOCTOU (note level only)**: the guard is an exists-check followed later by `state.writeRaw` (plain overwrite, not `wx`). A file created between check and write would still be clobbered. For a single-user local CLI this is acceptable; if hardening is ever wanted, switch the create-path write to `{ flag: 'wx' }` as `backlog-migrate.ts:165` already does.
- **Pre-existing, out of delta scope**: `assertNoSlugCollision` does not itself call `assertSafeSlug` — safe today because both call sites derive the slug from `toSlug` and the method is private; worth adding the assert if the method ever gains a caller taking external slugs. The guard also intentionally does not check `spec/archive/backlog-legacy/` — a re-minted idea whose slug matches an archived legacy item is allowed; that is a design choice, not a security issue.
- **Error class** follows the project's typed-error convention (`extends Error`, `name` set, structured `slug`/`existingPath` fields); no secrets or token material in the diff; no changes to guard/mint hooks, execFile paths, or YAML parsing in this commit.

### Round 1 — carried findings (unchanged)

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
- **Slug validation on path construction**: `MilestonesStore.create/show/exists` and `IssuesStore.show/exists/updateFrontmatter/archive/remove` all call `assertSafeSlug` (shared `SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/` — no `/`, `.`, or uppercase possible) before any `join()`. CLI-side pre-checks (`issue.ts:37-41` for `--milestone`, `backlog.ts` for `--change` and before exists) are defense in depth on top of the store asserts. `toSlug`-derived slugs (create/createIdea) are structurally within the safe charset and length.
- **Migration filenames** (`src/backlog/backlog-migrate.ts`): filenames come exclusively from `readdir()` basenames filtered to `.md` — a basename cannot contain a path separator, so `join(issuesDir, file)` / `join(archiveDir, file)` cannot escape `spec/`. Rename targets are fixed at `spec/archive/backlog-legacy/{,done/}` inside `specDir`. Overwrite protection is two-layer: `findCollision` pre-check plus `writeFile(..., { flag: 'wx' })` (`backlog-migrate.ts:165`) — the narrow TOCTOU window between check and write is closed by `wx`. Originals are renamed, never deleted.
- **execFile usage**: all git auto-commit paths (`backlog.ts:32-38`, `milestone.ts:79-81`) use `execFile` with argument vectors — no shell, no interpolation into a command string. Slugs embedded in commit messages are validated before use and are inert as argv elements regardless.
- **Migration partial-failure behavior**: a malformed legacy file (opening `---` with no closing fence) throws mid-loop (`backlog-migrate.ts:78` via `splitFrontmatter`) — already-migrated items are left uncommitted and the command exits 4. Fail-closed and re-runnable (idempotency is derived from the filesystem), so acceptable; noting for operator awareness.
- **`release-pipeline.ts:165-168`** — `isArchivedChangeDir` filter correctly prevents the new non-change `spec/archive/backlog-legacy/` dir from being claimed by `release cut`.
- No secrets, credentials, or token material appear anywhere in the diff; the mint-hook change is scope-list only.

---

Verdict: PASS_WITH_WARNINGS

Round 2. Round-1 verdict (PASS_WITH_WARNINGS, 0 criticals, 8 warnings) re-confirmed. Delta since round 1 is a single fix commit, 740bee3eb (`IssueSlugCollisionError` + never-overwrite guard in issues-store.ts, `slug_collision` handling in backlog.ts, 5 new store tests + 3 new CLI tests). Verified in this round: `npx tsc --noEmit` clean; src/issues/issues-store.test.ts + tests/cli-issue-backlog.test.ts + tests/issues-store.test.ts — 88/88 passing.

## Delta review (740bee3eb)

Clean. No new criticals, no new warnings.

- **Naming**: `IssueSlugCollisionError` follows the custom-typed-error convention (extends `Error`, sets `name`, carries typed `slug`/`existingPath` fields), consistent with `IssueFrontmatterError`. Placement next to the store class in src/issues/issues-store.ts is right.
- **No duplication of the collision check**: a single private `assertNoSlugCollision` (src/issues/issues-store.ts:137-147) is shared by both `create` (:156) and `createIdea` (:192) — exactly the shape round 1 would have asked for. Both open (`spec/issues/`) and resolved (`spec/issues/resolved/`) locations are checked, and the guard runs before any write.
- **Test placement**: store-level collision tests went into the colocated src/issues/issues-store.test.ts (the file round-1 warning 4 identified as the keeper); CLI-surface tests went into tests/cli-issue-backlog.test.ts alongside the existing `backlog add --new` cases. Correct homes on both counts. Tests assert byte-identical preservation of the existing file, the typed error's fields, both JSON (`slug_collision`, exit 4) and text renderings, and the resolved-issue collision path — real behavior, not happy-path-only.
- Minor delta nits (suggestion-level, listed below): `metta issue` on a colliding title now correctly refuses but renders through the generic catch as `issue_error` instead of a typed `slug_collision` (src/cli/commands/issue.ts:69-73); and the recovery hint `run: metta backlog add <slug>` (src/cli/commands/backlog.ts:198-199) is wrong for the resolved-issue collision case, where that command would exit `not_found`. Neither loses safety — exit code, refusal, and file preservation are correct in all paths.

## Critical issues

None. Confirmed: none of the round-1 warnings, nor anything in the delta, rises to blocking severity for this change. The remaining items are docs refresh, template annotation, and refactor/consistency work — all safe to land as follow-up issues; none causes data loss, broken builds, failing tests, or incorrect runtime behavior in the shipped paths.

## Warnings

Round-1 warnings 1-3 restated (unaddressed, still true; genuine follow-up work — mirrored under Suggested follow-ups for issue logging):

1. **src/cli/commands/refresh.ts:176 — `metta refresh` still regenerates the retired store into CLAUDE.md.** `buildReferenceSection` emits `| [Backlog](spec/backlog/) | \`spec/backlog/\` | Prioritized backlog items |`, re-advertising `spec/backlog/` as a live store; no `spec/milestones/` row. Not blocking: refresh only runs via `/metta-refresh`, and the stale row is cosmetic until then.
2. **Stale hand-maintained docs describe the deleted BacklogStore** — docs/internals/architecture.md:45,:96; docs/workflows/state.md:270-287; docs/workflows/skills.md:479-501; docs/workflows/README.md:23; docs/guide/troubleshooting.md:73; docs/internals/guard-hooks.md:223. Not blocking: docs-only.
3. **src/templates/hooks/metta-guard-edit.mjs:130 — `ALLOW_PREFIXES` still whitelists `spec/backlog/` `.md` edits** (comment :125-127 names the retired creating command). Not blocking: permissive-only during the migration window; nothing writes there anymore.

Round-1 warnings 4-8 restated (refactor/consistency debt; mirrored under Suggested follow-ups):

4. **Two test files for one module** — src/issues/issues-store.test.ts (now 27 tests, colocated, sync fs) and tests/issues-store.test.ts (11 tests, async fs) both cover IssuesStore with overlapping archive/remove/create cases. The delta correctly added to the colocated file, mildly reinforcing it as the keeper. Not blocking: redundant coverage, not wrong coverage.
5. **Auto-commit logic in three variants** — `commitPaths` (src/cli/commands/backlog.ts:28-44), inline block (src/cli/commands/milestone.ts:76-86), `autoCommitFile` (src/cli/helpers.ts). Not blocking: all three behave correctly.
6. **Frontmatter fence parsing duplicated** between issue-frontmatter.ts (`splitFrontmatter`:82) and milestones-store.ts (:20,:26-34,:50-52). Not blocking: milestones never patch existing blocks, so the divergence risk is latent.
7. **`backlog add` lacks the `--milestone` pre-validation + dangling-reference warning that `issue` has** (src/cli/commands/issue.ts:37-49 vs src/cli/commands/backlog.ts `add`). Malformed milestone still fails safely (generic `backlog_error` from the Zod-validated frontmatter patch, no file written); only the error typing and the warning are missing. Not blocking.
8. **`PRIORITIES` const + `Priority` type duplicated** in src/cli/commands/issue.ts:5-6 and src/cli/commands/backlog.ts:11-12. Not blocking: trivially small.

## Suggested follow-ups

Log as issues rather than block the ship:

1. `metta refresh` CLAUDE.md ToC: replace the `spec/backlog/` store row with the frontmatter-view story and add a `spec/milestones/` row (src/cli/commands/refresh.ts:176). [round-1 W1]
2. Docs pass replacing BacklogStore/`spec/backlog/` store semantics across docs/internals/architecture.md, docs/workflows/{state,skills,README}.md, docs/guide/troubleshooting.md, docs/internals/guard-hooks.md. [round-1 W2]
3. Drop or annotate the `spec/backlog/` entry in `ALLOW_PREFIXES` in src/templates/hooks/metta-guard-edit.mjs:130 (and the deployed .claude/hooks copy). [round-1 W3]
4. Merge tests/issues-store.test.ts into src/issues/issues-store.test.ts — one test home per module. [round-1 W4]
5. Hoist `commitPaths` from backlog.ts into src/cli/helpers.ts and reuse in milestone.ts. [round-1 W5]
6. Consolidate milestone frontmatter parsing onto issue-frontmatter.ts's `splitFrontmatter`/mapping assert. [round-1 W6]
7. Mirror issue.ts's `--milestone` slug pre-check + dangling-reference warning in `backlog add`. [round-1 W7]
8. Extract shared `PRIORITIES`/`Priority` (or derive from the Zod enum in src/schemas/issue-frontmatter.ts:11). [round-1 W8]
9. (New, from delta) Catch `IssueSlugCollisionError` in `metta issue`'s handler (src/cli/commands/issue.ts:69-73) so JSON consumers get `type: 'slug_collision'` instead of generic `issue_error`; behavior is already safe (refuses, exit 4, message names slug + path).
10. (New, from delta) The collision recovery hint `run: metta backlog add <slug>` (src/cli/commands/backlog.ts:198-199) is misleading when the collision is against `spec/issues/resolved/` — that command exits `not_found` for resolved slugs. Branch the hint on whether `existingPath` is under `resolved/`.

## Notes

- Round-1 notes stand unchanged (naming/conventions clean; 1:1 test ratio satisfied; barrel exports match design.md:46; guard/mint templates and deployed copies in sync; the minor observations on `listDir` sort order, `.md` suffix stripping, `backlog done` not checking the `backlog: true` flag, rollup-warning routing, and the `BacklogStore.archive` comment breadcrumb).
- Delta cosmetics, not worth follow-ups: `existingPath` hard-codes the `spec/` prefix via `join('spec', relPath)` (src/issues/issues-store.ts:144) while the store is constructed from `specDir` — a display convention only, correct for all real deployments; the exists-then-write guard is non-atomic (TOCTOU), acceptable for a single-user CLI on local files.
- Behavior change surfaced by the delta (intentional per the fix's purpose, safer than before): duplicate-title `metta issue` / `backlog add --new` now fails with exit 4 where it previously silently overwrote the existing file. Repeat invocations with identical titles (e.g. re-run skill flows) will now surface the collision instead of clobbering — the correct trade.
