# UAT: fix-ship-flow-merges-prs-before-ci-green

- **Change**: fix-ship-flow-merges-prs-before-ci-green
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Wait for checks before merging — in all six ship sequences (deployed skill + template pair, 12 files), insert a mandatory step between `gh pr create` and `gh pr merge`: `gh pr checks <pr-number> --watch --fail-fast` — block until all checks complete; if any check fails or is cancelled, do NOT merge — report the failing check(s) and the PR URL to the user and stop. Only merge on a fully green verdict.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Guarantee main-push CI verdicts — in `.github/workflows/ci.yml`, scope cancellation to PR runs only: `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, so every merge commit on main gets a completed CI run.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

PR #66 was merged while its `gates` check was still IN_PROGRESS — the ship flow (PR #56) predates CI (PR #62) and merged immediately after opening the PR. The per-ref cancel-in-progress also cancelled main-push runs on rapid follow-up merges.

#### Step 2.1
- **Do**: Confirm: Ship flows now wait for green CI before merging. All six ship sequences — metta-ship, metta-auto, metta-quick, metta-propose, metta-fix-issues, metta-fix-gap (deployed `.claude/skills/` + template `src/templates/skills/` pairs, 12 files) — gained a mandatory step between `gh pr create` and `gh pr merge`: Subsequent steps were renumbered; no cross-references to renumbered steps existed (verified by grep).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: Main-push CI runs are never cancelled. `.github/workflows/ci.yml` concurrency changed from `cancel-in-progress: true` to `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, so superseded PR runs still cancel but every merge commit on main receives a completed CI verdict.
- **Observe**: behaves as described
- [ ] Pass
