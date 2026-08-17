# Research: fix-follow-ups-backlog-milestones-rework-review-pr-85

Consolidated from three parallel research passes:
- [research-renderer-sanitization.md](research-renderer-sanitization.md)
- [research-commit-scoping-and-tests.md](research-commit-scoping-and-tests.md)
- [research-guard-advisory-docs.md](research-guard-advisory-docs.md)

## Decision: Six targeted fixes in one hardening pass, each with a single-choke-point design

### Approaches Considered

1. **Renderer sanitization — shared pure utility** (selected) — new `src/util/sanitize-text.ts` exporting `stripControlSequences()`, applied at terminal render edges. Rejected alternatives: per-call-site inline regex (15+ duplications, untestable in isolation) and the `strip-ansi` dependency (does not cover bare C0 controls; new runtime dep unjustified).
2. **Commit scoping — exact file pathspecs (A1)** (selected) — `backlog add` stages `spec/issues/<slug>.md`; `backlog done` stages both the deleted `spec/issues/<slug>.md` and created `spec/issues/resolved/<slug>.md` (verified empirically: `git add <deleted-path>` stages the deletion while leaving dirty siblings unstaged); `backlog migrate` gains `changedPaths: string[]` on `MigrationResult` populated at the single source of truth. Rejected: pathspec-limited commits (subtler git semantics, same plumbing anyway) and narrower directory pathspecs (still sweeps shared `spec/issues/`).
3. **Test consolidation — fold + delete + tsconfig exclude (B1)** (selected) — the two issues-store test files are disjoint suites (401 vs 110 lines); fold the nine unique describe-blocks from `src/issues/issues-store.test.ts` into `tests/issues-store.test.ts`, delete the src copy, and add `"src/**/*.test.ts"` to `tsconfig.json` exclude — five other src-side test files compile into `dist/` for the same reason, so delete-only is incomplete. Rejected: relocating all six src test files (out of scope; backlog candidate).
4. **Guard-bash bare backlog — ALLOWED_BARE + default-to-list (A2)** (selected) — add `'backlog'` to `ALLOWED_BARE` in BOTH byte-identical hook copies (`src/templates/hooks/` and `.claude/hooks/`, identity enforced by `tests/hooks-byte-identity.test.ts`), and make `list` the `isDefault` subcommand of the backlog group (release precedent, `release.ts:48`) so the bare form is a genuine read-only view rather than help text. Rejected: generic "any two-word group is allowed bare" rule (would silently allow bare `milestone`, deliberately fail-closed).
5. **Tier advisory cap — inside `renderBanner` (B1)** (selected) — the only uncapped surface is `src/cli/commands/instructions.ts:52`; cap at `standard` inside the renderer so every present and future caller is consistent; both `complete.ts` sites already self-cap and need no change. Edge case specified: current=standard/scored=full renders the cap without recommending a move. Rejected: per-caller guards (third copy of an already-drifting policy) and clamping at scoring time (falsifies persisted authoritative score data).
6. **Stale docs sweep — 10-item must-fix inventory** (selected) — the sweep found the six listed locations plus `docs/workflows/state.md:270-288` (whole stale `spec/backlog/` section) and required test flips: `tests/metta-guard-edit.test.ts:87-94` currently asserts `spec/backlog/` writes are allowed and must invert; refresh drops the TOC Backlog row and widens the Issues row description. Legitimate references (migrate code/comments, changelog, normative "MUST NOT" spec lines, `docs/proposed/`) are left alone.

### Rationale

Each fix lands at its single choke point: the sanitize helper at the render edge (functional core convention, `slug.ts`/`format-zod-error.ts` precedent), pathspecs at the store/result boundary where written files are known, the advisory cap in the pure renderer, the guard change in the canonical hook template mirrored byte-identically. The tsconfig exclude fixes the whole class of dist test pollution rather than one instance. All fixes stay within the recorded scope of the issue's recommended "single hardening pass"; none builds full-tier support.

### Key implementation facts

- Sanitize regex (alternation order load-bearing — full ESC sequences before bare controls): `/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[PX^_][^\x1b]*(?:\x1b\\)?|\x1b[@-Z\\-_]|[\x00-\x1f\x7f-\x9f]/g` — new test file `tests/sanitize-text.test.ts`; integration cases in `tests/cli-issue-backlog.test.ts` / `tests/cli-milestone.test.ts`.
- `commitPaths` itself needs no changes; `tests/backlog-migrate.test.ts:57,264` full-object `toEqual`s gain `changedPaths: []`.
- Vitest discovery is config-driven (`vitest.config.ts` include), so the tsconfig exclude does not affect test runs.
- `tests/complexity-renderer.test.ts:82-86` breaks as-is under the cap and must be updated in the same commit, with new cases for capped-to-standard and cap-equals-current.
- Hook edits propagate to `dist/` via `npm run copy-templates` in the build; `.claude/hooks/` copies are hand-mirrored and CI-pinned.

### Out of scope / flagged for follow-up

- `spec/specs/roadmap-feature/spec.md` still normatively requires the deleted `BacklogStore` / `spec/backlog/` — genuine normative spec drift; route to its own gap/issue rather than folding into this fix.
- Residual C1 (U+009B) passthrough in `--json` output (`JSON.stringify` does not escape `\x7f–\x9f`) — noted, not fixed here.
- Relocating the five remaining src-side test files into `tests/` — backlog candidate.

### Artifacts Produced

- [Research: renderer sanitization](research-renderer-sanitization.md)
- [Research: commit scoping and test consolidation](research-commit-scoping-and-tests.md)
- [Research: guard allowlist, advisory cap, docs sweep](research-guard-advisory-docs.md)
