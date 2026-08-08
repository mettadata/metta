# Summary — fix-metta-guard-edit-worktree-blind

## What changed

### Hook: worktree-aware probe and allowlist
`metta-guard-edit` no longer probes `metta status --json` at `process.cwd()`.
It now extracts the edit target first, walks up from the target's nearest
existing ancestor (Write targets often don't exist yet) to the containing
checkout via `git rev-parse --show-toplevel` (5s timeout), and runs both the
status probe and the allowlist `relPath` computation against that resolved
root. Edits inside `.metta/worktrees/<change>/` checkouts with an active
change are now allowed; edits inside a change-less worktree — and in the main
checkout with no active change — are blocked exactly as before. Every failure
mode (git missing, metta missing, target outside any repo, timeout) falls
back to the previous tolerant cwd-rooted behavior. The installed hook and the
template remain byte-identical (asserted by test).

### CLI: worktree-aware change resolution
- `createCliContext` roots the context via a new `resolveProjectRoot()`:
  nearest ancestor of cwd with its own `spec/changes/`, never escaping the
  containing git checkout, falling back to cwd (pre-init projects unchanged).
  Invocations from inside a worktree checkout or any subdirectory now root at
  that checkout's top level.
- `ArtifactStore` accepts an optional `worktreesDir`. When set (the CLI passes
  `<root>/.metta/worktrees`), change discovery (`listChanges`, new
  `discoverChanges`) and change resolution by name (`getChange`,
  `updateChange`, `markArtifact`, artifact reads/writes, `archive`/`abandon`)
  additionally cover `.metta/worktrees/<name>/spec/changes/` checkouts.
  `metta status --json` from the main root reports each hosted change with its
  hosting worktree path (`worktree` field, injected on read when the stored
  metadata predates worktree mode — JSON shape stays additive). On a slug
  collision the worktree copy wins and a warning is printed to stderr — never
  silently merged. `createChange` now also rejects slugs already hosted in a
  worktree.

## Files touched
- `.claude/hooks/metta-guard-edit.mjs` (byte-identical with template)
- `src/templates/hooks/metta-guard-edit.mjs`
- `src/cli/helpers.ts` (`resolveProjectRoot`, worktree-aware store wiring)
- `src/artifacts/artifact-store.ts` (discovery + per-change routing)
- `tests/metta-guard-edit.test.ts` (real git-worktree fixture + `metta` shim)
- `tests/artifact-store.test.ts` (discovery, collision, routing)
- `tests/cli-helpers.test.ts` (`resolveProjectRoot`)
- `tests/cli-status.test.ts` (root-level aggregation with worktree path)

## Gate results
- `npm test`: 99 files / 1751 tests passed (includes 21 new tests)
- `npx tsc --noEmit`: pass
- `npm run build`: pass (templates copied to dist, hook parity verified)

## Notes / accepted consequences
- Because root-level `metta status` is now truthful about worktree-hosted
  changes, the guard hook allows main-checkout edits while any change is
  active anywhere in the repo (the hook only asks "is there an active
  change at this checkout root"). This follows from the intent's design of
  deriving the hook's answer from the CLI rather than duplicating
  change-resolution semantics.
- Worktree discovery covers the default `.metta/worktrees` layout only; a
  custom `git.worktree.dir` is not aggregated (config load is async, context
  creation is sync). One level of nesting only, per intent out-of-scope.

## Review (2026-08-08)
Three parallel reviewers (correctness, security, quality): all PASS_WITH_WARNINGS, zero critical issues. Merged report in review.md. Multi-reviewer warnings fixed in commit ef2aea842: hook symlink physical/logical fail-open (realpath normalization), non-string file_path guard, transient (non-persisted) injected worktree path, collision-warning I/O moved to CLI shell with accurate host naming, resolveProjectRoot normalization.

## Verification (2026-08-08, iteration 1)
- Gate tests: PASS — 99/99 files, 1759/1759 tests, 0 failures
- Gate typecheck+lint+build: PASS — tsc clean, lint (tsc) clean, build + template copy clean
- Gate intent-coverage: PASS — all 6 intent commitments verified with file:line evidence; hook/template byte parity confirmed by cmp and by test
