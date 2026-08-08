# Review — fix-metta-guard-edit-worktree-blind

Three parallel reviewers (correctness, security, quality). Iteration 1, 2026-08-08.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS_WITH_WARNINGS |

No critical issues. Core fix confirmed correct by all three: target-rooted probe, allowlist re-rooting, `resolveProjectRoot` non-escaping walk, collision handling, byte-identical hook/template parity (asserted by test), all gates green.

## Warnings (merged, deduplicated)

### Flagged by multiple reviewers — fixed in follow-up commits
1. **Symlink physical/logical path mismatch fail-open** (security, correctness) — `git rev-parse --show-toplevel` returns the physical path while the target path is logical; under a symlinked session path every in-root edit hits the outside-root early allow. Fix: realpath the nearest existing ancestor before comparison, both hook copies. (`.claude/hooks/metta-guard-edit.mjs:105`, template identical)
2. **Machine-specific absolute worktree path persisted to `.metta.yaml`** (all three) — `getChange` injects the runtime host path; `updateChange`/`markArtifact` then persist it. Fix: keep injected value transient — strip before write. (`src/artifacts/artifact-store.ts:134-151,305-318`)
3. **Collision warning emitted from library core + wrong text for worktree-vs-worktree collisions** (quality) — move stderr emission to CLI layer; correct message. (`src/artifacts/artifact-store.ts:159-163,181`)
4. **`resolveProjectRoot` inconsistent normalization across branches** (quality) — return `resolve`d value on all paths. (`src/cli/helpers.ts:52-58`)

### Accepted / deferred (documented, not blocking)
- **Main-checkout unlock via aggregation** (all three) — with root-level status now truthful, any active worktree change allows main-checkout edits (hook asks only "active change at this checkout root"). Follows the intent's derive-from-CLI design; documented in summary.md. Deferred: hook could require a change hosted at the probed root itself. Surfaced to user for sign-off.
- **Root-invoked `metta instructions`/`context`/`complete` for worktree-hosted changes build paths from the main root** (correctness) — metadata resolves but `changePath` points at the main checkout; silent wrong-path emission. Pre-existing command-layer gap beyond this change's scope (5 command files); logged as a follow-up issue.
- **Custom `git.worktree.dir` not aggregated** (security, executor note) — discovery covers the default `.metta/worktrees` only; documented in summary.md and intent out-of-scope.
- **Hook test shim doesn't exercise real status aggregation** (correctness) — the main-checkout block test would invert under real aggregation with an active worktree change; consistent with the accepted-consequence item above.
- **`finalize_lock_stale` read from main root never sees worktree lock** (correctness) — minor status inaccuracy for root-invoked status of worktree-hosted changes.
- **Non-string `file_path` crash → exit 1 fail-open** (security suggestion) — pre-existing; cheap typeof guard included in fix pass.
- **Windows cwd-hijack in child spawn / nested planted-repo guard domain** (security suggestions) — advisory tier; Windows out of scope per intent.
- **Double worktree scan per update op** (quality) — bounded by worktree count; perf follow-up only.
