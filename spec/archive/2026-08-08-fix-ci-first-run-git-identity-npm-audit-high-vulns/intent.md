# Fix CI first run: git identity in gates job and npm audit high vulns

## Problem

The first CI run on main (run 31260049377) after landing `.github/workflows/ci.yml` (PR #62) failed on both jobs:

1. **`gates` job** — `tests/progress-ceremony-metrics.test.ts` fails, CI-only. Several tests run `metta install --git-init` in a temp dir and assert ceremony metrics computed from the resulting initial commit. GitHub-hosted runners ship with no git `user.name`/`user.email` configured, so the install-time commit fails silently, `git log` returns no commits, and the metrics render "no data" instead of numbers. Locally the developer's global git config masks the failure, so the tests pass on dev machines but not in CI.

2. **`audit` job** — `npm audit --audit-level=high` exits 1 on two pre-existing high-severity advisories in transitive dev dependencies of the vite/vitest toolchain:
   - `nanoid` <= 3.3.16 (GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8)
   - `postcss` <= 8.5.22 (GHSA-r28c-9q8g-f849, GHSA-fxqj-rqcc-2cmp)

   `npm audit fix` reports a fix available for both.

Until both are fixed, every CI run on main is red, which blocks CI from acting as a meaningful merge signal.

## Proposal

Two targeted fixes:

1. **Configure git identity in CI.** Add a "Configure git identity" step to the `gates` job in `.github/workflows/ci.yml`, before the `npm test` step:
   - `git config --global user.name "github-actions[bot]"`
   - `git config --global user.email "github-actions[bot]@users.noreply.github.com"`

   This makes the runner environment match the implicit precondition the ceremony-metrics tests rely on (a usable git identity for the install-time initial commit).

2. **Resolve the audit failures.** Run `npm audit fix` to bump `nanoid` and `postcss` in `package-lock.json`. This is a lockfile-only change; both packages are transitive dev dependencies (vite/vitest toolchain), so no production dependency or `package.json` ranges change.

## Impact

- **Files touched:** `.github/workflows/ci.yml` (one added step in the `gates` job), `package-lock.json` (transitive dev-dep version bumps only).
- **Behavior:** No runtime or production behavior change. CI `gates` and `audit` jobs go green; `npm audit --audit-level=high` exits 0.
- **Risk:** Low. The git identity step only affects the CI runner's global git config. The lockfile bumps are semver-compatible fixes within existing ranges for dev-only transitive deps; the test suite validates the toolchain still works.
- **Verification:** Local `npm test` and `npm audit --audit-level=high` pass; CI run on the branch shows both jobs green.

## Out of Scope

- Hardening the tests to inject git identity themselves (e.g., setting `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env or per-repo config inside the temp dir). Worthwhile, but a separate test-infra change.
- Any production dependency changes or `package.json` edits.
- Branch protection rules or required-status configuration on GitHub.
