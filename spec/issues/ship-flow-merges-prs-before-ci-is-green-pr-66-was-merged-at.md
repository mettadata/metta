# Ship flow merges PRs before CI is green — PR #66 was merged at 2026-08-11T00:13:30Z while its gates check was still IN_PROGRESS (only the audit job had completed); the metta-ship skill (and the ship steps in all fork skills after PR #56) instruct gh pr create followed immediately by gh pr merge with no wait-for-checks step, so the GitHub Actions gates added in PR #62 never actually gate a merge. Also observed: the per-ref concurrency group cancels the main-push CI run when follow-up commits land quickly, leaving merge commits without a completed CI verdict of their own. Fix directions: (a) ship steps wait for checks before merging — gh pr checks <n> --watch (or gh pr merge --auto) and abort/report on failure; (b) optionally enable branch protection requiring the gates check so gh pr merge cannot land red; (c) consider concurrency cancel-in-progress: false for main-push runs so merge commits always get a verdict. Applies to metta-ship plus the ship sections of metta-propose/quick/auto/fix-issues/fix-gap (template + deployed pairs).

**Captured**: 2026-08-11
**Status**: logged
**Severity**: major

## Symptom
PR #66 was merged at 2026-08-11T00:13:30Z while its CI `gates` check was still IN_PROGRESS (only the `audit` job had completed). The GitHub Actions gates added in PR #62 never actually gate a merge: every ship path merges the PR immediately after opening it. Additionally, the per-ref concurrency group cancels the main-push CI run when follow-up commits land quickly, leaving merge commits on main without a completed CI verdict of their own.

## Root Cause Analysis
The PR-based ship flow introduced in PR #56 (commit 04c58aa1d) predates CI (PR #62, commit 77bc5b0db) and was never updated when CI landed. Every ship sequence — metta-ship steps 5–6 and the mirrored ship steps in the fork skills (metta-propose/quick/auto/fix-issues/fix-gap, template + deployed pairs) — instructs `gh pr create` followed immediately by `gh pr merge <n> --merge` with no wait-for-checks step in between. `gh pr merge` does not wait for checks unless branch protection requires them (or `--auto` is used with such protection), and no branch protection requiring the `gates` check exists on main, so merges land regardless of CI state. Compounding this, ci.yml's concurrency group `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true` also applies to `refs/heads/main` push runs, so a rapid follow-up merge cancels the prior main run and the earlier merge commit never receives a completed verdict.

### Evidence
- `.claude/skills/metta-ship/SKILL.md:17` — step 5 (`gh pr create`) is followed directly by step 6 (`gh pr merge <pr-number> --merge`, "land the PR immediately") with no check-wait between them.
- `.github/workflows/ci.yml:12` — concurrency group keyed on `github.ref` with `cancel-in-progress: true` cancels in-flight main-push runs whenever a newer push to main arrives.
- `src/templates/skills/metta-quick/SKILL.md:200` — the same create-then-immediately-merge pair is replicated across the fork skills' ship sections (template and deployed copies), so the gap applies to all ship paths, not just metta-ship.

## Candidate Solutions
1. **Wait for checks in ship steps** — insert `gh pr checks <n> --watch --fail-fast` between `gh pr create` and `gh pr merge` in metta-ship and every fork-skill ship section (template + deployed pairs), aborting the merge and reporting to the user if any check fails or is cancelled. Tradeoff: instruction-level only — skill drift or a manual `gh pr merge` still bypasses it, and every ship now blocks for the full CI runtime.
2. **Branch protection requiring the gates check** — configure a ruleset on main requiring the `gates` check, so `gh pr merge` cannot land red or pending; pair with `gh pr merge --auto` so merges queue until green. Tradeoff: repo-admin configuration living outside the codebase (not versioned by default, needs GitHub admin permissions) and it hard-blocks emergency ships unless a bypass is defined.
3. **Stop cancelling main-push runs** — scope concurrency so cancellation applies only to PR runs (e.g. `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`), guaranteeing every merge commit on main gets a completed CI verdict. Tradeoff: complementary only — it does not prevent premature merges — and stacked merges consume more Actions minutes.

