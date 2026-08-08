# UAT: fix-ci-first-run-git-identity-npm-audit-high-vulns

- **Change**: fix-ci-first-run-git-identity-npm-audit-high-vulns
- **Generated**: 2026-08-08
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
- **Do**: Confirm: Configure git identity in CI. Add a "Configure git identity" step to the `gates` job in `.github/workflows/ci.yml`, before the `npm test` step: This makes the runner environment match the implicit precondition the ceremony-metrics tests rely on (a usable git identity for the install-time initial commit).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Resolve the audit failures. Run `npm audit fix` to bump `nanoid` and `postcss` in `package-lock.json`. This is a lockfile-only change; both packages are transitive dev dependencies (vite/vitest toolchain), so no production dependency or `package.json` ranges change.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Quick-workflow change; verified against intent.md claims:

#### Step 2.1
- **Do**: Confirm: [x] Root cause confirmed by simulation: with git identity stripped (empty HOME/XDG_CONFIG_HOME, GIT_* unset), `tests/progress-ceremony-metrics.test.ts` fails 6/14 — matching the CI-only failure on run 31260049377.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] `gates` job gains a "Configure git identity" step between `npm ci` and `npm test` (github-actions[bot] identity), fixing tests that run `metta install --git-init` in temp dirs on identity-less runners.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] `npm audit fix` bumped transitive dev deps in package-lock.json only: nanoid 3.3.15 -> 3.3.18, postcss 8.5.15 -> 8.5.26. `package.json` untouched; no src/ or test changes.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] `npm audit --audit-level=high` now exits 0 (0 vulnerabilities), so the `audit` job will pass.
- **Observe**: behaves as described
- [ ] Pass
