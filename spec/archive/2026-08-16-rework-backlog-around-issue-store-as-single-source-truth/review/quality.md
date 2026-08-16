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
