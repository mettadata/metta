# exclude-vendored-referrences-dependency-manifests-git

## Problem

Maintainers of the `@mettadata/metta` npm package are receiving **208 false-positive Dependabot security alerts** sourced entirely from vendored reference projects stored under `referrences/`. These alerts — triggered by dependency manifests belonging to BMAD-METHOD, OpenSpec, claude-task-master, get-shit-done, and other reference projects — drown out any genuine alerts for metta's own root package. Because all 3529 files under `referrences/` are committed to git, GitHub's dependency-graph scanner treats every `package.json`, `package-lock.json`, and `pnpm-lock.yaml` found in those subdirectories as a metta dependency manifest and surfaces their vulnerable transitive dependencies as metta's own vulnerabilities.

The root cause has two parts:

1. `referrences/` is not listed in `.gitignore` and is not a git submodule. Every vendored manifest is a first-class tracked object in the repository index, so Dependabot's dependency-graph crawler sees 21 manifest files that it cannot distinguish from metta's root `package.json`.

2. There is no `.github/dependabot.yml` to restrict Dependabot version-update scanning to the root package directory. Without this file, Dependabot applies broad heuristics and will re-discover vendored manifests if any are ever re-committed.

The result is that real alerts for metta's own dependencies — which are the ones maintainers need to act on — are invisible behind the noise of 208 irrelevant vendor alerts. There is no `.github/` directory in the repository today.

## Proposal

Two concrete, sequenced changes are REQUIRED:

**1. Untrack `referrences/` from the git index while preserving files on disk.**

Run `git rm -r --cached referrences/` to remove all 3529 vendored files from git's object store without deleting them from the local working tree. The files remain available locally for reference. `referrences/` MUST then be appended to `.gitignore` so the directory is never re-committed, and the change is landed as a single commit. This is the primary fix: Dependabot's dependency graph is built from committed file content; once the manifests are untracked they are invisible to the scanner and the 208 alerts are resolved.

**2. Add `.github/dependabot.yml` scoped to the root npm package.**

Create `.github/dependabot.yml` with a single `package-ecosystem: npm` entry pointing to `directory: "/"` and a `schedule.interval: weekly`. The configuration MUST set `open-pull-requests-limit` to a sensible value (10 is the chosen default) to prevent alert storms on busy weeks. This config file serves two purposes: (a) it makes Dependabot version-update PRs explicit and scoped to metta's root `package-lock.json` only; (b) per GitHub documentation, Dependabot version updates only scan the declared `directory`, providing defense-in-depth against any future accidental re-commit of vendored manifests.

No changes to metta source code, runtime behavior, or existing npm dependencies are required. No changes to any existing spec, workflow, or skill are required.

## Impact

- **Git index**: a single commit removes 3529 tracked files from the repository index. This is a large diff by file count but zero diff by source-code content — no TypeScript, YAML, or spec files are touched. Clones and CI runners will see a smaller checkout. Fresh clones will NOT contain the `referrences/` tree; collaborators who need those files locally MUST keep them outside the git repository or obtain them separately.
- **`.gitignore`**: gains one line (`referrences/`). No other ignore rules are changed.
- **`.github/dependabot.yml`**: new file, ~10 lines. Creates the `.github/` directory, which did not previously exist. Any future GitHub Actions workflows added to `.github/workflows/` will not be affected.
- **Dependabot alerts**: the 208 false-positive alerts are expected to be resolved automatically once GitHub re-scans the repository after the commit lands. Genuine alerts for metta's root package dependencies will remain visible and unaffected.
- **Developer workflow**: the `referrences/` directory is still present on any developer machine that has already cloned the repository. Running `git status` will show the directory as untracked (ignored). No build step, npm script, or CI job reads from `referrences/`, so no automation breaks.

## Out of Scope

- Deleting the `referrences/` files from disk on any machine. The files are intentionally preserved locally via `--cached` flag; physical deletion is a separate operator decision.
- Converting `referrences/` into a git submodule. Submodule management is a distinct workflow change outside this fix.
- Adding Dependabot configuration for any ecosystem other than `npm` (e.g. GitHub Actions, Docker, Python pip). Only metta's root npm package is in scope.
- Modifying metta's actual dependencies (`package.json`, `package-lock.json` at root) or upgrading any dependency version.
- Suppressing or dismissing the 208 Dependabot alerts manually. They MUST resolve automatically once the vendored manifests are untracked.
- Adding any GitHub Actions CI workflow. `.github/` is created solely for `dependabot.yml`.
- Auditing or evaluating the security posture of the vendored reference projects themselves.
