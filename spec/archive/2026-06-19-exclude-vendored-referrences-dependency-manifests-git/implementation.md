# Implementation: exclude-vendored-referrences-dependency-manifests-git

## Summary

Removed the 21 vendored dependency manifest files under `referrences/` from the
git index (preserving them on disk), added `.gitignore` rules so they are never
re-committed, and introduced a scoped `.github/dependabot.yml`. This drops the
vendored manifests out of GitHub's dependency graph so the 208 false-positive
Dependabot alerts sourced from the reference projects auto-resolve, while the 3
genuine alerts for metta's own root dependencies remain visible.

No metta source code, runtime behavior, or root npm dependencies were changed —
this is a repository-configuration and git-index-only change.

## Refinement vs. intent

The intent proposed untracking the entire `referrences/` tree (~3529 files via
`git rm -r --cached referrences/`) and gitignoring the whole directory. The
implementation takes the more surgical approach that achieves the same alert
outcome with a far smaller index churn:

- Only the **21 dependency manifest files** are untracked, not the whole tree.
- `.gitignore` ignores only the manifest **patterns** under `referrences/`, not
  the directory.
- The **3508 non-manifest reference files** (source, docs, configs of the
  vendored projects) remain tracked and available in fresh clones.

Rationale: GitHub's dependency-graph scanner only reads dependency manifests
(`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`), so
removing just those manifests is sufficient to clear the 208 alerts. Keeping the
rest of the reference tree tracked avoids a 3500-file deletion in clones and
preserves the reference material in version control.

## Files changed

### `.gitignore` (modified)

Appended a block ignoring vendored reference dependency manifests so they cannot
be re-committed:

```
# Vendored reference projects — exclude their dependency manifests from the
# dependency graph so Dependabot does not raise alerts for code we don't ship.
referrences/**/package.json
referrences/**/package-lock.json
referrences/**/pnpm-lock.yaml
referrences/**/yarn.lock
```

### `.github/dependabot.yml` (new)

New file (creates the previously non-existent `.github/` directory) scoping
Dependabot version-update PRs to the root npm package and github-actions only,
on a weekly schedule with `open-pull-requests-limit: 10`. A header comment
documents why vendored manifests are excluded. This provides defense-in-depth:
Dependabot version updates only scan the declared `directory: "/"`, so any
future accidental re-commit of a vendored manifest will not be picked up.

### 21 manifest files removed from the git index (staged as deletions)

Removed via `git rm -r --cached` — files remain on disk, only the index entries
are deleted. Total: 65,873 lines removed across 21 files, 0 lines of source code.

Vendored project | Manifests untracked
--- | ---
`referrences/BMAD-METHOD/` | `package.json`, `package-lock.json`
`referrences/OpenSpec/` | `package.json`, `package-lock.json`, `pnpm-lock.yaml`
`referrences/claude-task-master/` | `package.json`, `package-lock.json`
`referrences/claude-task-master/apps/` | `cli/package.json`, `docs/package.json`, `extension/package.json`, `mcp/package.json`
`referrences/claude-task-master/packages/` | `ai-sdk-provider-grok-cli/package.json`, `build-config/package.json`, `claude-code-plugin/package.json`, `tm-bridge/package.json`, `tm-core/package.json`, `tm-profiles/package.json`
`referrences/get-shit-done/` | `package.json`, `package-lock.json`
`referrences/get-shit-done/sdk/` | `package.json`, `package-lock.json`

## Verification performed

1. **`git status --short`** — confirmed `.gitignore` modified (`M`),
   `.github/` and `spec/changes/` untracked (`??`), and exactly 21 manifest
   files staged as deletions (`D`). No unexpected files in scope.

2. **Staged diff stat** (`git diff --cached --stat -- referrences/`) —
   confirmed `21 files changed, 65873 deletions(-)`, no insertions.

3. **No manifests remain tracked** —
   `git ls-files referrences/ | grep -E 'package\.json$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$'`
   returns 0 entries.

4. **Non-manifest reference files preserved** — `git ls-files referrences/`
   (excluding manifest patterns) still reports **3508** tracked files, so the
   reference source material remains in version control.

5. **`.gitignore` patterns match** — `git check-ignore` confirms the patterns
   match representative manifests, e.g.
   `referrences/BMAD-METHOD/package.json`,
   `referrences/OpenSpec/pnpm-lock.yaml`,
   `referrences/get-shit-done/sdk/package-lock.json` (exit 0).

6. **`.github/dependabot.yml` is valid YAML** — parsed with the project's
   `yaml` library:
   `version: 2`, `updates` ecosystems `["npm", "github-actions"]`, both scoped
   to `directory: "/"`, weekly schedule. Parses without error.

7. **`npm run build`** — `tsc` + copy-templates completes cleanly. Confirms no
   metta source code was affected by the change.

## Expected outcome

Once this commit lands and GitHub re-scans the repository, the 208 false-positive
Dependabot alerts sourced from `referrences/` manifests resolve automatically
(their manifests are no longer in the dependency graph). The 3 genuine
dev-dependency alerts on metta's own root package (vitest/esbuild chain) remain
visible and actionable.

## Out of scope (unchanged)

- No physical deletion of `referrences/` files from disk.
- No conversion of `referrences/` to a git submodule.
- No changes to metta's root `package.json` / `package-lock.json` dependencies.
- No manual dismissal of the 208 alerts — they resolve automatically.
- No GitHub Actions CI workflow added; `.github/` exists solely for
  `dependabot.yml`.
