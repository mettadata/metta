# Summary: fix-follow-ups-backlog-milestones-rework-review-pr-85

Single hardening pass resolving the six residual defects from the backlog/milestones rework review (PR #85).

## What changed

1. **Sanitized list renderers** — new pure helper `stripControlSequences()` in `src/util/sanitize-text.ts` (CSI/OSC/DCS/Fe escapes + bare C0/DEL/C1); applied at the two defect render sites `src/cli/commands/backlog.ts` (list rows) and `src/cli/commands/milestone.ts` (milestone show issue rows). Render-only; `--json` output and files on disk stay byte-faithful. (commits afce54ea, 6d70e857, b7cf77bb)
2. **Scoped backlog auto-commits** — the three `commitPaths` call sites in `backlog.ts` now stage explicit file paths instead of the `spec/issues` directory: `add` stages `spec/issues/<slug>.md`; `done` stages the deletion + `spec/issues/resolved/<slug>.md` creation; `migrate` stages `MigrationResult.changedPaths`, a new additive field populated inside `migrateLegacyBacklog`. Unrelated dirty files under `spec/issues/` are no longer swept into commits (regression tests per command). (commits 2cb736d8, 6d70e857)
3. **Test consolidation + dist hygiene** — nine unique describe-blocks folded from `src/issues/issues-store.test.ts` into `tests/issues-store.test.ts` (38 tests); src copy deleted; `"src/**/*.test.ts"` added to tsconfig `exclude` so no test files compile into `dist/` (fixes five other src-side test files too). (deletion rode in f168e3a4; content commit 381102a1)
4. **Bare `metta backlog` allowed** — `'backlog'` added to `ALLOWED_BARE` in both byte-identical guard-bash hook copies; `list` is now the backlog group's default subcommand (release precedent), so the bare form is a genuine read-only view. Write forms (`add`/`done`/`promote`) remain Tier-2 gated; `backlog <unknown>` stays fail-closed. (commits f168e3a4, 6d70e857)
5. **Tier advisory capped at standard** — `renderBanner` clamps upscale recommendations at `MAX_UPSCALE_TIER = 'standard'`; a full-scored change never sees "upscale to full", including the current=standard/scored=full edge (states the cap without recommending a move). Scoring and persisted values untouched. (commit f90df160)
6. **Stale `spec/backlog/` sweep** — `refresh.ts` TOC drops the Backlog row, widens the Issues description, adds a Milestones row; worktree CLAUDE.md hand-edited to match with a `not.toContain('spec/backlog/')` regression pin; guard-edit `ALLOW_PREFIXES` tightened to `spec/issues/` only (both hook copies, test flipped to assert blocked); `docs/workflows/README.md`, `docs/workflows/skills.md`, `docs/internals/architecture.md`, `docs/workflows/state.md`, `docs/guide/troubleshooting.md`, `docs/internals/guard-hooks.md` rewritten to the frontmatter-view model. (commits 1b0ff21c, 71c67930, 41e6ac37)

## Breaking/behavioral notes

- **Guard-edit tightening (intended):** out-of-band `.md` edits under the retired `spec/backlog/` path are now blocked (previously allowed).
- **Bare `metta backlog` behavior change:** prints the backlog list (exit 0) instead of Commander group help (exit non-zero).
- **Advisory wording change:** full-scored changes now render capped advisory text.

## Incident log (orchestrator)

Parallel executors sharing the worktree index raced on `git commit`: Task 1.3's original commit (06195af5c) was lost to a branch-ref reset during Task 1.5's recovery; its content survived staged and was recommitted by the orchestrator as 381102a1 (verified 38/38 green). The `src/issues/issues-store.test.ts` deletion rode along in f168e3a4. Net tree state audited correct; later batches used pathspec-scoped commits.

## Follow-ups to log at ship time (per design ADR-1)

- Wrap the remaining ~13 title/description render sites with `stripControlSequences`, incl. newline-preserving variant for multi-line bodies.
- `spec/specs/roadmap-feature/spec.md` normative drift (still requires deleted `BacklogStore`) — own gap/issue.
- `--json` C1 (U+009B) passthrough in `JSON.stringify` output.
- Relocate the five remaining src-side test files into `tests/`.
