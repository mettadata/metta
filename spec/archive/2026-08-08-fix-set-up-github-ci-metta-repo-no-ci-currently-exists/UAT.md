# UAT: fix-set-up-github-ci-metta-repo-no-ci-currently-exists

- **Change**: fix-set-up-github-ci-metta-repo-no-ci-currently-exists
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
- **Do**: Confirm: One job on `ubuntu-latest` using `actions/setup-node` with Node 22 and npm caching (matching `engines.node >= 22` in `package.json`).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Steps, in order: `npm ci`, `npm test` (vitest run), `npx tsc --noEmit` (typecheck/lint gate), `npm run build` (tsc + copy-templates).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: A second, parallel, non-blocking-by-severity job running `npm audit --audit-level=high` so dependency alerts surface on PRs without noise from low-severity findings.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Quick-workflow change (no spec.md); verified against intent.md claims instead. All SATISFIED:

#### Step 2.1
- **Do**: Confirm: [x] Triggers: every `pull_request` + `push` to `main` — ci.yml:3-7
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] Runner `ubuntu-latest` — ci.yml:18 (gates), ci.yml:35 (audit)
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] `actions/setup-node` with Node 22 + npm cache — ci.yml:21-24, 38-41
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] Gate steps in order `npm ci` -> `npm test` -> `npx tsc --noEmit` -> `npm run build` — ci.yml:26,28,30,32; fail-fast, no `continue-on-error`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: [x] Parallel `audit` job with `npm audit --audit-level=high` — ci.yml:34-45, no `needs`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: [x] New-file-only scope — diff vs main: `.github/workflows/ci.yml` (+45) plus change artifacts only; no `src/`, `package.json`, or gate templates touched
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.7
- **Do**: Confirm: [x] YAML validity — parses clean via the `yaml` package; jobs `gates`, `audit`
- **Observe**: behaves as described
- [ ] Pass
