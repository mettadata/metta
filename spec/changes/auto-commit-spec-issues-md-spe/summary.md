# Summary: auto-commit-spec-issues-md-spe

Added `autoCommitFile()` helper in `src/cli/helpers.ts` and wired it into `metta issue` and `metta backlog add`. After the store writes the file, the CLI runs `git add <path> && git commit -m "<conventional message>"`. If the working tree has other uncommitted changes or git is unavailable, the commit is skipped silently with a reason in JSON output / stdout line.

## Files changed
- `src/cli/helpers.ts` (added helper)
- `src/cli/commands/issue.ts` (wired helper)
- `src/cli/commands/backlog.ts` (wired helper)

## Gates
- `npm run build` — PASS
- `npx vitest run` — 325/325 PASS
- Smoke in `mktemp -d`: `metta issue "smoke test" --severity minor` → file created, `chore: log issue smoke-test-issue` committed automatically (SHA `c8c146c`).

## JSON output additions
Both commands now include `committed: bool` and `commit_sha: string | undefined` fields in `--json` mode, so skills and automation can detect success.

## Fallback behavior
Graceful skip (no error) when:
- Not a git repository
- Working tree has uncommitted changes to other files
- git command fails

In each case, the file is still written; only the commit is skipped and the reason is reported.
