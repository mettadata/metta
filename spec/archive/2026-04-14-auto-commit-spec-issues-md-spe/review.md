# Review: auto-commit-spec-issues-md-spe

Three reviewers ran in parallel.

## Correctness — PASS_WITH_WARNINGS → addressed
- Fallback cases all handled; both call sites correct; JSON fields wired.
- Warning: `backlog add` action had no try/catch around the store call, inconsistent with `issue`. **Applied fix.**
- Warning: rename-entry / quoted-path parsing brittle. Deferred — slugs are sanitized to `[a-z0-9-]` so path-traversal via filename is unreachable.

## Security — PASS
- `execFile` with argument arrays prevents shell injection.
- Slug sanitization prevents `--`-flag traversal.
- Non-blocking suggestion: add `--` separator to `git add`. **Applied.**

## Quality — PASS_WITH_WARNINGS → addressed
- **Fix now (applied)**: dirty-check was `--untracked-files=all` which blocked on stray scratch files; switched to `--untracked-files=no` so only tracked modifications matter.
- **Fix now (applied)**: added `tests/auto-commit.test.ts` with 4 unit tests covering: clean-tree commit, non-git repo, other-dirty-tracked blocks, unrelated-untracked does NOT block.
- **Applied**: prefixed commit-failure reason with `git commit failed:`.
- Deferred: extracting helper to `src/cli/git.ts` (YAGNI until second helper), deduping the 8-line call-site pattern (only 2 call sites).

## Verdict
All 3 reviewers PASS after the applied fixes. Full suite: 329/329 (including 4 new tests).
