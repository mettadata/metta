# Verification: set-git-init-defaultbranch-main-ci-gates-job

## Spec Scenarios

Quick-workflow change; verified against intent.md:

- [x] Root cause confirmed by isolated-HOME simulation: with runner-like git config (identity only, no init.defaultBranch), `tests/cli-roadmap.test.ts` + `tests/cli-issue-backlog.test.ts` fail 29/46 with `Refusing to write: current branch 'master' is not the main branch 'main'` (branch write-guard in src/cli/helpers.ts, exit 4); with `init.defaultBranch=main` added, 46/46 pass.
- [x] One line appended to the `gates` job's "Configure git identity" step in `.github/workflows/ci.yml`: `git config --global init.defaultBranch main`.
- [x] No src/, test, or dependency changes.

## Gate Results

- Targeted CI-mirror run (isolated HOME with the fix): 46/46 pass across the two previously failing files
- typecheck (`npx tsc --noEmit`): clean
- Full gates re-run at finalize (tests, lint, typecheck, build)

## Summary

Third and final piece of the CI rollout (PRs #62, #64). GitHub runners lack `init.defaultBranch`, so temp repos created by `metta install --git-init` in tests land on `master`, tripping metta's main-branch write guard for `issue`/`backlog`/roadmap commands (CI-only exit-4 failures). Fixed by configuring `init.defaultBranch=main` alongside the existing CI git identity step. Commit: bf4b3a9dd.
