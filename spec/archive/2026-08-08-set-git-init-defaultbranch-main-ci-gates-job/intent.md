# Set git init.defaultBranch=main in CI gates job

## Problem

The CI `gates` job (added in PR #62, git identity fixed in PR #64) still fails on tests that pass locally: `tests/cli-roadmap.test.ts` (16 of 18 failing) and `tests/cli-issue-backlog.test.ts` (13 of 28 failing). These tests create temporary repos via `metta install --git-init`. GitHub-hosted runners have no `init.defaultBranch` configured, so `git init` creates the repo on `master`. Metta's write guard in `src/cli/helpers.ts` refuses `metta issue`, `metta backlog`, and roadmap writes when the current branch is not the configured main branch (`main`), so the CLI exits with code 4 and the tests fail. Developer machines mask the bug because they set `init.defaultBranch=main` globally. Root cause was confirmed by an isolated-HOME simulation: 29 tests fail without the setting, all 46 pass with it.

## Proposal

Add one line to `.github/workflows/ci.yml`: append `git config --global init.defaultBranch main` to the existing "Configure git identity" step in the `gates` job, so every `git init` on the runner — including those performed by `metta install --git-init` inside tests — starts on `main` and satisfies the write guard.

## Impact

- `.github/workflows/ci.yml` — one line added to the `gates` job's "Configure git identity" step.
- CI-only behavior change: `tests/cli-roadmap.test.ts` and `tests/cli-issue-backlog.test.ts` go green on GitHub runners; the runner environment now matches typical developer git config.
- No source, test, or published-package changes; zero effect on local development.

## Out of Scope

- Making the tests set `init.defaultBranch` in their own temp git config (environment-independent hardening — separate change).
- Making `metta install --git-init` pass `--initial-branch` to `git init` (worthwhile hardening — separate change).
- Any changes under `src/` or `tests/`, including the write guard in `src/cli/helpers.ts`.
