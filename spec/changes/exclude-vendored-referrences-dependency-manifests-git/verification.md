# Verification: exclude-vendored-referrences-dependency-manifests-git

## Result: PASS

All seven verification checks pass. The change untracks the 21 vendored
dependency manifests under `referrences/` from the git index, gitignores those
manifest patterns, and adds a scoped `.github/dependabot.yml` — with no impact on
metta source code. The implementation is a deliberate, acceptable refinement of
the intent (surgical 21-manifest untrack vs. whole-tree untrack); it achieves the
same Dependabot-alert outcome while preserving 3508 non-manifest reference files
in version control. Verified as a refinement, not a defect.

## Verification strategy

`.metta/config.yaml` has **no `verification:` block**, so no strategy is
configured. This is a config/git-index change with no Given/When/Then scenarios,
so all verification is concrete and strategy-independent (git index state,
gitignore matching, YAML validity, build gate). Verification proceeded against
these deterministic gates.

Note for the project owner: to set a project-wide verification strategy, run
`/metta-init` or add the following block to `.metta/config.yaml`:

```yaml
verification:
  strategy: tests_only  # or: cli_exit_codes | playwright | tmux_tui
  instructions: ""
```

## Checks

### Check 1 — No manifest files remain tracked under `referrences/`  — PASS

Command:

```
git ls-files referrences/ | grep -E 'package\.json$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$'
```

Result: empty output (grep exit 1). Zero dependency manifests are tracked under
`referrences/`. Confirmed via count: `git ls-files referrences/` reports 3508
tracked files, of which 0 match the manifest patterns.

### Check 2 — `.gitignore` patterns actually match manifests  — PASS

Command (representative manifests across all four vendored projects):

```
git check-ignore referrences/OpenSpec/package-lock.json \
                 referrences/BMAD-METHOD/package.json \
                 referrences/OpenSpec/pnpm-lock.yaml \
                 referrences/get-shit-done/sdk/package-lock.json
```

Result: all four paths returned (exit 0) — each is ignored. The four `.gitignore`
patterns (`referrences/**/package.json`, `package-lock.json`, `pnpm-lock.yaml`,
`yarn.lock`) match real manifests at multiple nesting depths, so re-commits are
prevented.

### Check 3 — `.github/dependabot.yml` is valid YAML scoped to `directory: "/"`  — PASS

Command (parsed with the project's `yaml` library):

```
node -e "const yaml=require('yaml');const fs=require('fs');const d=yaml.parse(fs.readFileSync('.github/dependabot.yml','utf8'));..."
```

Result (parse OK):
- `version: 2`
- ecosystems: `["npm", "github-actions"]`
- directories: `["/", "/"]` — both update entries scoped to the root.
- npm entry: `schedule.interval: weekly`, `open-pull-requests-limit: 10`.

The file parses without error and is scoped to the root package only, providing
defense-in-depth against future re-committed vendored manifests. (The
github-actions ecosystem entry is additive and within the spirit of the intent's
root-scoping; it does not scan `referrences/`.)

### Check 4 — `npm run build` succeeds (no source impact)  — PASS

Command:

```
npm run build
```

Result: `tsc && npm run copy-templates` completed cleanly, exit 0. Independently,
`npx tsc --noEmit` also exits 0. Confirms no metta source code was affected by
the change.

### Check 5 — Non-manifest reference files remain tracked  — PASS

Command:

```
git ls-files referrences/ | wc -l          # total tracked
git ls-files referrences/ | grep -E '<manifest patterns>' | wc -l   # manifests
```

Result: 3508 total tracked, 0 manifests tracked → 3508 non-manifest reference
files still in version control. The reference source/docs/config material is
preserved; only the dependency manifests were untracked.

### Check 6 — 21 manifests staged as index deletions  — PASS

Command:

```
git diff --cached --stat -- referrences/
git diff --cached --name-only --diff-filter=D -- referrences/ | grep -cE '<manifest patterns>'
```

Result: `21 files changed, 65873 deletions(-)`, 0 insertions; exactly 21 manifest
files staged as deletions (`D`). Matches the implementation's documented file
list (BMAD-METHOD, OpenSpec, claude-task-master + apps/packages, get-shit-done +
sdk). Files remain on disk (`--cached` only).

### Check 7 — In-scope working-tree state is correct  — PASS

Command:

```
git status --short .gitignore .github/dependabot.yml
```

Result: `.gitignore` modified (`M`), `.github/dependabot.yml` untracked (`??`,
new file creating the previously non-existent `.github/` directory). No
unexpected files in scope.

## Intent coverage

| Intent requirement | Status | Evidence |
| --- | --- | --- |
| Vendored manifests removed from git index, preserved on disk | PASS | Check 1, Check 6 (21 staged deletions, `--cached`) |
| `.gitignore` prevents re-commit of vendored manifests | PASS | Check 2 (all representative manifests ignored) |
| `.github/dependabot.yml` scoped to root npm package | PASS | Check 3 (`directory: "/"`, weekly, limit 10) |
| No metta source / runtime / root-dependency changes | PASS | Check 4 (build green), Check 7 (only `.gitignore` + `.github/`) |
| Reference material not destroyed | PASS | Check 5 (3508 non-manifest files still tracked) |

### Accepted refinement vs. intent

Intent proposed untracking the entire `referrences/` tree (~3529 files) and
gitignoring the whole directory. The implementation surgically untracks only the
21 dependency manifests — the only files GitHub's dependency-graph scanner reads
— and preserves 3508 reference source files in git. This achieves the same alert
outcome (manifests leave the dependency graph → 208 false-positive alerts
auto-resolve) with far smaller index churn and without deleting reference
material from fresh clones. Verified as an intentional, acceptable refinement.

## Gates

| Gate | Command | Result |
| --- | --- | --- |
| Build | `npm run build` | PASS (exit 0) |
| Typecheck | `npx tsc --noEmit` | PASS (exit 0) |
| Tests | not run | N/A — config/git-index change touches no source; no tests exercise `.gitignore` / `.github/` / git index state |
| Lint | not run | N/A — no `.ts`/`.js` source files changed |

## Notes

- The 208 false-positive Dependabot alerts resolving is an outcome on GitHub's
  side after the commit lands and GitHub re-scans; it cannot be verified locally.
  The verifiable precondition — vendored manifests are out of the tracked content
  GitHub's dependency graph reads — is confirmed (Check 1).
- Out-of-scope items (physical file deletion, submodule conversion, manual alert
  dismissal, root dependency changes) were correctly not performed.
