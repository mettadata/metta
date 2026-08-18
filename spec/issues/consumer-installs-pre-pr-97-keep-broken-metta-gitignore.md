# Consumer installs pre-PR#97 keep broken .metta/.gitignore; install never migrates, doctor never reports

**Captured**: 2026-08-18
**Status**: logged
**Severity**: minor

## Symptom
Consumer projects installed before PR #97 retain a broken `.metta/.gitignore`. Verified on zeus: `/home/utx0/Code/zeus/.metta/.gitignore` contains `.metta/`-prefixed patterns (`.metta/state.yaml`, `.metta/local.yaml`, `.metta/logs/`, `.metta/state.lock`). Because the file lives inside `.metta/`, those patterns anchor to `.metta/.metta/...` and match nothing, and the file omits `scratch/`, `locks/`, and `worktrees/` entirely — so runtime state (scratch/, locks/, logs/, worktrees/, state.yaml) shows as untracked noise or risks being committed. Re-running `metta install` does not repair it.

## Root Cause Analysis
The template fix shipped in change fix-guard-edit-worktree-write-friction-caused-cross-repo (commits 285c262e3 and b82e77a10) corrected the pattern anchoring and added `scratch/`, but `metta install` writes `.metta/.gitignore` with the exclusive `wx` flag and swallows the resulting EEXIST, deliberately leaving any pre-existing file untouched. That preserves user customizations but also permanently preserves the known-broken pre-#97 template on every existing consumer install. There is no migration path: install never inspects existing content, and `metta doctor` has freshness checks for templates and dist but no check for `.metta/.gitignore` drift, so the breakage is invisible. Note the current template also omits `locks/` and `worktrees/` (worktree ignoring is handled separately via `ensureGitignoreEntry` on the project-root `.gitignore`), which the fix should reconcile.

### Evidence
- `src/cli/commands/install.ts:335` — `writeFile(..., { flag: 'wx' }).catch(() => {})` skips the write when `.metta/.gitignore` already exists, so pre-#97 installs never receive the corrected template.
- `src/cli/commands/install.ts:321` — comment documents the anchoring bug: a non-trailing-slash pattern like `.metta/state.yaml` inside `.metta/.gitignore` only matches `.metta/.metta/state.yaml`, i.e. nothing — exactly the pattern shape zeus has on disk.
- `src/cli/commands/doctor.ts:105` — doctor runs Template freshness and Dist freshness checks but has no `.metta/.gitignore` content check, so the drift is never reported.

## Candidate Solutions
1. **Idempotent migration in `metta install`** — on the existing-file path, parse the current `.metta/.gitignore`: rewrite known-broken `.metta/`-prefixed lines to their directory-relative forms, append any missing canonical entries (`state.yaml`, `local.yaml`, `logs/`, `state.lock`, `scratch/`, `locks/`, `worktrees/`), and preserve unrecognized user-added lines verbatim. Tradeoff: line-level rewriting of a user-owned file carries edge cases (comments, negation patterns, ordering) and needs careful tests to stay truly idempotent.
2. **Doctor check plus `--fix`** — add a `.metta gitignore` check to `metta doctor` that diffs the file against the canonical entry set and reports drift as warn, with the actual rewrite gated behind an explicit `doctor --fix` or install flag. Tradeoff: drift persists until the user acts, so the untracked-noise/commit risk remains for consumers who never run doctor.
3. **Sidestep via `.git/info/exclude` or root `.gitignore`** — stop relying on the nested `.metta/.gitignore` and instead have install ensure the entries in the project-root `.gitignore` (as `ensureGitignoreEntry` already does for worktrees), leaving the stale nested file harmless-but-inert. Tradeoff: does not clean up the confusing broken file, touches a user-visible root `.gitignore`, and splits ignore rules across two mechanisms.
