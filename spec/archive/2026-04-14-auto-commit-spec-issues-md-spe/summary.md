# Summary: auto-commit-spec-issues-md-spe

Added `autoCommitFile()` helper in `src/cli/helpers.ts` and wired it into `metta issue` and `metta backlog add`. After the store writes the file, the CLI runs `git add -- <path> && git commit -m "<conventional message>"`. Graceful skip when the working tree has other tracked modifications, not a git repo, or git fails — never throws.

## Files changed
- `src/cli/helpers.ts` (added `autoCommitFile` helper)
- `src/cli/commands/issue.ts` (wired helper)
- `src/cli/commands/backlog.ts` (wired helper + added try/catch to add action)
- `tests/auto-commit.test.ts` (new — 4 unit tests)

## Review (3 reviewers, parallel)
- Correctness: PASS_WITH_WARNINGS → addressed (try/catch on backlog add)
- Security: PASS (non-blocking `--` separator suggestion applied)
- Quality: PASS_WITH_WARNINGS → addressed (dirty check scope narrowed to tracked-only, helper unit tests added, error prefix)

See `review.md` for full breakdown.

## Verification (3 verifiers, parallel)
- `npx vitest run`: 329/329 PASS (was 325, now 329 — +4 new helper tests)
- `npx tsc --noEmit` + `npm run lint`: PASS
- Goal-vs-intent: 5/5 goals implemented with file:line citations

## Smoke test
`mktemp -d` → `git init` → `metta install --git-init` → `metta issue "smoke test" --severity minor` → file created at `spec/issues/smoke-test-issue.md`, auto-committed as `chore: log issue smoke-test-issue` (SHA `c8c146c`).

Change ready to finalize and ship.
