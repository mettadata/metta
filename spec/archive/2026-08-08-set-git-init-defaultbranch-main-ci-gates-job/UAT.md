# UAT: set-git-init-defaultbranch-main-ci-gates-job

- **Change**: set-git-init-defaultbranch-main-ci-gates-job
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
- **Do**: Confirm: Add one line to `.github/workflows/ci.yml`: append `git config --global init.defaultBranch main` to the existing "Configure git identity" step in the `gates` job, so every `git init` on the runner — including those performed by `metta install --git-init` inside tests — starts on `main` and satisfies the write guard.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Quick-workflow change; verified against intent.md:

#### Step 2.1
- **Do**: Confirm: [x] Root cause confirmed by isolated-HOME simulation: with runner-like git config (identity only, no init.defaultBranch), `tests/cli-roadmap.test.ts` + `tests/cli-issue-backlog.test.ts` fail 29/46 with `Refusing to write: current branch 'master' is not the main branch 'main'` (branch write-guard in src/cli/helpers.ts, exit 4); with `init.defaultBranch=main` added, 46/46 pass.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] One line appended to the `gates` job's "Configure git identity" step in `.github/workflows/ci.yml`: `git config --global init.defaultBranch main`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] No src/, test, or dependency changes.
- **Observe**: behaves as described
- [ ] Pass
