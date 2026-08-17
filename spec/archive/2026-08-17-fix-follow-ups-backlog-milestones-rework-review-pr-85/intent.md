# fix-follow-ups-backlog-milestones-rework-review-pr-85

## Problem

The backlog/milestones rework (PR #85, archived 2026-08-16) replaced the `spec/backlog/` directory store with a frontmatter view over `spec/issues/`, but review of the merged change plus a live zeus session found six residual defects that survived the merge:

1. **Stale `spec/backlog/` references.** `src/cli/commands/refresh.ts:176` still emits a `spec/backlog/` Table-of-Contents row, so every regenerated CLAUDE.md advertises a directory that no longer exists. Five docs (`docs/workflows/README.md`, `docs/workflows/skills.md`, `docs/internals/architecture.md`, `docs/guide/troubleshooting.md`, `docs/internals/guard-hooks.md`) and the guard-edit template allowlist (`src/templates/hooks/metta-guard-edit.mjs:130`) still describe or permit the removed store. Users and AI orchestrators reading these artifacts are directed to a dead path.
2. **Duplicate issues-store test files.** `src/issues/issues-store.test.ts` was added colocated with the source while `tests/issues-store.test.ts` already exists, violating the repo convention of keeping tests under `tests/` — and the colocated copy compiles into `dist/`, shipping test code in the published build.
3. **Over-broad backlog auto-commit.** `commitPaths` in `src/cli/commands/backlog.ts` is called with directory pathspecs (`join('spec','issues')` at lines 181, 267/269, and 304/306), so any unrelated dirty file under `spec/issues/` is silently swept into the auto-commit — a merge-safety hazard.
4. **Unescaped titles in list renderers.** `src/cli/commands/backlog.ts:75` and `src/cli/commands/milestone.ts:176` print `e.title` / `issue.title` verbatim, so ANSI escape sequences or control characters embedded in issue frontmatter pass straight through to the terminal.
5. **Bare `metta backlog` blocked by guard hook.** `backlog` is in `ALLOWED_TWO_WORD` (`list`, `show`) but absent from `ALLOWED_BARE` (`metta-guard-bash.mjs:77`, both the repo copy in `.claude/hooks/` and the template in `src/templates/hooks/`), so the read-only bare form fails closed even though `roadmap` and `release` are allowed bare.
6. **Misleading tier advisory.** `src/complexity/renderer.ts:48` renders "scored `<tier>` -- upscale recommended" for any higher-scored tier, including `full`, even though upscale-to-full is unsupported; `complete.ts` caps the full-tier path in two places (lines 362-367, 462-466) but the cap is not applied everywhere the renderer output surfaces.

Affected: anyone regenerating CLAUDE.md or reading the docs (stale paths), consumers of the published package (test code in `dist/`), users with dirty working trees under `spec/issues/` (unwanted commits), users listing backlog/milestone issues (terminal injection), AI orchestrators invoking the read-only backlog view (spurious guard denials), and users reading the tier advisory (recommendation for an unsupported action).

## Proposal

A single hardening pass resolving all six defects, per the chosen solution in issue `follow-ups-from-the-backlog-milestones-rework-review-pr-85`:

1. **Sweep stale `spec/backlog/` references.** Remove the backlog TOC row from `refresh.ts` (or point it at the current issues-backed view), update the five docs to describe the frontmatter-over-`spec/issues/` model, and drop `spec/backlog/` from the `metta-guard-edit.mjs` template allowlist.
2. **Consolidate issues-store tests.** Fold any test cases unique to `src/issues/issues-store.test.ts` into `tests/issues-store.test.ts`, then delete the colocated file so nothing test-shaped compiles into `dist/`.
3. **Narrow auto-commit pathspecs.** Change the three `commitPaths` call sites in `backlog.ts` to pass the explicit file paths the command wrote (created/moved/archived files) instead of directory pathspecs.
4. **Sanitize rendered titles.** Strip ANSI escape sequences and control characters from titles before printing in the backlog list renderer (`backlog.ts:75`) and the milestone issues renderer (`milestone.ts:176`).
5. **Allow bare `metta backlog`.** Add `backlog` to `ALLOWED_BARE` in both hook copies — `.claude/hooks/metta-guard-bash.mjs` and `src/templates/hooks/metta-guard-bash.mjs` — keeping them byte-identical.
6. **Cap the tier advisory at standard.** Ensure the complexity renderer (or every surface that emits its output) never recommends upscaling to `full`; the advisory caps the recommendation at `standard`, consistent with the existing caps in `complete.ts`.

## Impact

- **`metta refresh` / CLAUDE.md generation** — regenerated Table of Contents changes: the `spec/backlog/` row disappears or is replaced. Downstream projects that re-run refresh get a corrected TOC.
- **Docs** — five documentation files under `docs/` change wording around backlog storage; no behavioral change.
- **Guard-edit hook template** — `spec/backlog/` is no longer an allowlisted edit prefix; out-of-band `.md` edits under that (now nonexistent) path will be denied instead of allowed. This is a tightening, not a loosening.
- **Guard-bash hook** — bare `metta backlog` moves from denied to allowed (read-only view). Both hook copies change identically; the byte-identity test (`tests/agents-byte-identity.test.ts`-style guarantees) must continue to hold.
- **Backlog CLI auto-commits** — commits become narrower: only files the command actually wrote are staged. Users who relied on the accidental directory sweep (unlikely, unintended) will see unrelated dirty files left uncommitted.
- **Backlog/milestone list output** — titles containing control characters render sanitized; normal titles are unchanged.
- **Published package** — `dist/` no longer contains a compiled issues-store test module.
- **Tier advisory output** — status lines that previously said "scored full -- upscale recommended" now cap at standard; scoring itself is unchanged.
- **Tests** — the consolidated `tests/issues-store.test.ts` supersedes the deleted colocated file; new or updated tests cover title sanitization, narrowed commit pathspecs, bare-backlog guard allowance, and the capped advisory.

## Out of Scope

- **Building upscale-to-full support.** The advisory is capped; implementing an actual upscale-to-full flow is explicitly not part of this change (called out in the issue).
- Any redesign of the backlog view, milestone model, or issue frontmatter schema shipped in PR #85 — this change only cleans up its residue.
- General ANSI/control-character sanitization across all CLI output; only the two list renderers named in the issue are touched.
- Changes to the two-tier guard trust model or session-token minting; only the `ALLOWED_BARE` set gains one entry.
- Rewriting the complexity scoring model or tier thresholds; only the rendered advisory text is capped.
- Migrating or restoring any historical `spec/backlog/` content (the migration itself shipped in PR #85).
