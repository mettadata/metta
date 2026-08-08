# Set up GitHub CI for the metta repo — no CI currently exists (.github/workflows/ absent), so PRs merge on local gates only. Since PR-based shipping is now enforced for every change (PR #56), the gates (vitest tests, tsc typecheck, lint, build) should also run server-side on every PR and push to main via GitHub Actions, giving an independent check the PR merge can rely on. Scope: a workflow file running npm ci, npm test, npx tsc --noEmit, npm run build on Node 22; possibly npm audit for dependency alerts. Future option once CI is green: make gh pr merge respect required status checks.

**Captured**: 2026-08-08
**Status**: logged
**Severity**: minor

## Symptom
The metta repo has no server-side CI. `.github/workflows/` does not exist (`.github/` contains only `dependabot.yml`), so every PR — now mandatory for shipping since PR #56 enforced PR-based ship flow — merges on the strength of locally run gates alone. Nothing independent of the developer's machine verifies that tests, typecheck, and build pass before a PR lands on main.

## Root Cause Analysis
CI was never set up because the project bootstrapped with metta's own local gate runner (tests, typecheck, lint, build gates under `src/templates/gates/`) as the sole quality mechanism, and shipping was originally a direct local merge to main. Commit 9379f0a70 (PR #56) changed the ship flow to PR-based merging, which created an expectation of server-side status checks that was never backed by an actual workflow. The building blocks are already in place: `package.json` defines CI-ready scripts (`test` = `vitest run`, `lint` = `tsc --noEmit`, `build` = `tsc && npm run copy-templates`), the engine pins Node >= 22, and `dependabot.yml` already watches the `github-actions` ecosystem in anticipation of workflows that do not exist. The gap is purely the missing workflow file plus, optionally, branch protection wiring so `gh pr merge` respects required checks.

### Evidence
- `.github/dependabot.yml:15` — a `github-actions` package-ecosystem entry exists, but `.github/workflows/` is absent, so there are no actions to update and no CI runs on PRs or pushes.
- `package.json:7` — `scripts` already define `test`, `lint` (`tsc --noEmit`), and `build` with `engines.node >= 22`, so a workflow can invoke them directly without new tooling.
- `src/templates/gates/` — `tests.yaml`, `typecheck.yaml`, `lint.yaml`, `build.yaml` run only through metta's local gate runner; since PR-based shipping became mandatory (9379f0a70), no server-side equivalent guards the merge.

## Candidate Solutions
1. **Single `ci.yml` workflow** — Add `.github/workflows/ci.yml` triggered on `pull_request` and `push` to `main`, one job on `ubuntu-latest` with `actions/setup-node` (Node 22, npm cache): `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run build`. Minimal, matches the local gates one-for-one, and Dependabot already covers action version bumps. Tradeoff: gate definitions are duplicated between metta gate YAML and the workflow, so the two can drift silently.
2. **CI workflow plus `npm audit` job** — Same as option 1 with a parallel job running `npm audit --audit-level=high` for dependency alerts on every PR. Tradeoff: audit findings frequently have no actionable fix upstream, so the job either goes red on noise (blocking merges) or is made non-blocking and gets ignored.
3. **Generate the workflow from metta gate templates** — Teach metta to emit/refresh `ci.yml` from the same gate definitions the local runner uses, making CI and local gates share one source of truth. Tradeoff: meaningful engineering effort for a single-repo need today; premature abstraction until a second consumer exists.

Future option once CI is green: enable branch protection with required status checks so `gh pr merge` cannot land a failing PR.
