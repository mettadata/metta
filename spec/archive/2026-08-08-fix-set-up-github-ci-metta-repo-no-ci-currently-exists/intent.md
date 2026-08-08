# fix-set-up-github-ci-metta-repo-no-ci-currently-exists

## Problem

The metta repo has no server-side CI. `.github/workflows/` does not exist (`.github/` contains only `dependabot.yml`), so every PR merges on the strength of locally run gates alone. Since PR #56 (commit 9379f0a70) made PR-based merging mandatory for every shipped change, there is an implicit expectation of server-side status checks that nothing actually backs: a PR whose author skipped or bypassed the local gate runner (tests, typecheck, lint, build under `src/templates/gates/`) merges to `main` with zero independent verification.

Affected parties: every contributor merging PRs (no safety net against broken `main`), and the future adoption of branch-protection required status checks, which is impossible until checks exist. The `github-actions` ecosystem entry in `.github/dependabot.yml:15` is also dead weight until a workflow exists for Dependabot to watch.

## Proposal

Add a single GitHub Actions workflow at `.github/workflows/ci.yml` that runs the same quality gates server-side on every `pull_request` and every `push` to `main`:

- One job on `ubuntu-latest` using `actions/setup-node` with Node 22 and npm caching (matching `engines.node >= 22` in `package.json`).
- Steps, in order: `npm ci`, `npm test` (vitest run), `npx tsc --noEmit` (typecheck/lint gate), `npm run build` (tsc + copy-templates).
- A second, parallel, non-blocking-by-severity job running `npm audit --audit-level=high` so dependency alerts surface on PRs without noise from low-severity findings.

This is candidate solution 1 plus the scoped audit job from candidate 2. The gate commands are intentionally the exact scripts already defined in `package.json:7`, keeping duplication between metta gate YAML and the workflow limited to invoking the same npm scripts.

## Impact

- New file only: `.github/workflows/ci.yml`. No source code, gate templates, or npm scripts change.
- PRs and pushes to `main` will begin reporting CI status checks; a red check signals a broken change even though merging is not yet mechanically blocked.
- `.github/dependabot.yml`'s existing `github-actions` ecosystem entry becomes active and will start proposing action version bumps.
- Local metta gate runner behavior is unchanged; CI is an independent second line of defense, not a replacement.

## Out of Scope

- Branch protection / required status checks and making `gh pr merge` respect them — a follow-up once CI is proven green.
- Generating the workflow from metta gate templates (single-source-of-truth abstraction) — premature for a single-repo need.
- Matrix builds across multiple Node versions or operating systems — the project pins Node >= 22; one runner suffices.
- Release, publish, or deployment automation of any kind.
- Changes to the local gate runner, gate YAML under `src/templates/gates/`, or npm scripts.
