# fix-ship-flow-merges-prs-before-ci-green

## Problem

Every metta ship path merges a PR the instant it is opened, without waiting for CI. PR #66 was merged at 2026-08-11T00:13:30Z while its `gates` check was still IN_PROGRESS — only the `audit` job had completed. The GitHub Actions gates added in PR #62 therefore never actually gate a merge: the PR-based ship flow (introduced in PR #56) predates CI and was never updated when CI landed.

All six ship sequences share the same defect — `gh pr create` followed immediately by `gh pr merge <n> --merge` with no wait-for-checks step in between:

- `.claude/skills/metta-ship/SKILL.md` steps 5–6 (and its template pair `src/templates/skills/metta-ship/SKILL.md`)
- `.claude/skills/metta-auto/SKILL.md` steps 11–12 (+ template pair)
- `.claude/skills/metta-quick/SKILL.md` steps 12–13 (+ template pair)
- `.claude/skills/metta-propose/SKILL.md` ship steps c–d (+ template pair)
- `.claude/skills/metta-fix-issues/SKILL.md` ship steps b–c (+ template pair)
- `.claude/skills/metta-fix-gap/SKILL.md` ship steps b–c (+ template pair)

`gh pr merge` does not wait for checks unless branch protection requires them, and no such protection exists on main — so red or pending CI never blocks a merge.

A compounding defect lives in `.github/workflows/ci.yml`: the concurrency group `${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress: true` also applies to `refs/heads/main` push runs. When follow-up merges land quickly, the prior main-push run is cancelled and that merge commit never receives a completed CI verdict.

Affected: every developer and AI orchestrator shipping through metta — broken code can land on main with CI still running, and main's own CI history has gaps.

## Proposal

Two coordinated fixes, both instruction/config level:

1. **Wait for checks before merging** — in all six ship sequences (deployed skill + template pair, 12 files), insert a mandatory step between `gh pr create` and `gh pr merge`:
   `gh pr checks <pr-number> --watch --fail-fast` — block until all checks complete; if any check fails or is cancelled, do NOT merge — report the failing check(s) and the PR URL to the user and stop. Only merge on a fully green verdict.
2. **Guarantee main-push CI verdicts** — in `.github/workflows/ci.yml`, scope cancellation to PR runs only: `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`, so every merge commit on main gets a completed CI run.

## Impact

- Ship flows now block for the duration of CI (~a few minutes) before merging — this is the intended behavior change.
- A red or cancelled check aborts the merge and surfaces to the user instead of silently landing.
- Main-push CI runs are no longer cancelled by rapid follow-up merges; stacked merges consume more Actions minutes.
- Template and deployed skill files must stay in sync (existing convention).

## Out of Scope

- **Branch protection / rulesets on main** (candidate solution 2 in the issue) — requires GitHub admin configuration outside the codebase; can be layered later as defense in depth.
- `gh pr merge --auto` queued merges — meaningful only with required checks configured via branch protection.
- Any TypeScript/CLI code changes — the ship flow lives entirely in skill instructions and CI config.
- Changing the merge strategy (`--merge`) or any other ship semantics.
