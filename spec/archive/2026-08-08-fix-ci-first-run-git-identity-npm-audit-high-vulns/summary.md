# Verification: fix-ci-first-run-git-identity-npm-audit-high-vulns

## Spec Scenarios

Quick-workflow change; verified against intent.md claims:

- [x] Root cause confirmed by simulation: with git identity stripped (empty HOME/XDG_CONFIG_HOME, GIT_* unset), `tests/progress-ceremony-metrics.test.ts` fails 6/14 — matching the CI-only failure on run 31260049377.
- [x] `gates` job gains a "Configure git identity" step between `npm ci` and `npm test` (github-actions[bot] identity), fixing tests that run `metta install --git-init` in temp dirs on identity-less runners.
- [x] `npm audit fix` bumped transitive dev deps in package-lock.json only: nanoid 3.3.15 -> 3.3.18, postcss 8.5.15 -> 8.5.26. `package.json` untouched; no src/ or test changes.
- [x] `npm audit --audit-level=high` now exits 0 (0 vulnerabilities), so the `audit` job will pass.

## Gate Results

- tests: PASS — 1859/1859 across 103 files
- typecheck (`npx tsc --noEmit`): PASS
- build (`npm run build`): PASS
- audit: PASS — exit 0, 0 vulnerabilities at high level

## Summary

Follow-up to the initial CI rollout (PR #62): the first CI run failed on both jobs. The `gates` job failed because GitHub runners lack git user identity, breaking ceremony-metric tests that depend on `metta install --git-init` committing; fixed by configuring github-actions[bot] identity in the workflow. The `audit` job failed on two pre-existing high advisories (nanoid GHSA-28wg-ghj8-5hjv/GHSA-2v37-7h3g-55p8, postcss GHSA-r28c-9q8g-f849/GHSA-fxqj-rqcc-2cmp); fixed by `npm audit fix` lockfile bumps. Commits: 173235f7c (ci), 7c5c7f32a (deps).
