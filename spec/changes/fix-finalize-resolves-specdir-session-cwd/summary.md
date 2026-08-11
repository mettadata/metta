# Summary: fix-finalize-resolves-specdir-session-cwd

## What changed

Fixes the issue where `metta finalize --change <name>` run from the main checkout for a worktree-hosted change failed with ENOENT on `<main>/spec/archive/<name>/gates.yaml` and stranded the change half-archived.

Commit `fe717be01` — `fix(finalize): resolve specDir from the change's host checkout, stage gates.yaml pre-archive` (6 files, +275/-18):

- **src/cli/commands/finalize.ts** — the Finalizer's specDir now comes from `await ctx.artifactStore.specDirFor(name)` (per-change, worktree-aware) instead of `join(ctx.projectRoot, 'spec')` (session cwd). The post-finalize auto-commit runs with `cwd: hostRoot` (`dirname(specDir)`) so the git add/commit targets the checkout that received the archive.
- **src/finalize/finalizer.ts** — gates.yaml is staged in the change dir via `artifactStore.writeArtifact()` *before* the archive move (same sweep pattern as UAT.md/TOKENS.md); the post-archive `writeFile` into `spec/archive/` is removed. All other path joins (generateUat changeDir, cleanup rm paths, uatPath/tokensPath) resolve correctly once specDir is host-resolved.
- **src/artifacts/artifact-store.ts** — `specDirFor(name)` made public.
- **tests/finalizer.test.ts**, **tests/artifact-store.test.ts**, **tests/cli-finalize.test.ts** — regression coverage: gates.yaml swept into the worktree archive; staging failure aborts pre-move with the change fully intact (no stranding); end-to-end finalize from the main checkout root over a real git worktree succeeds with all paths landing in the worktree and the main checkout untouched.

## Behavior changes

- Finalize for worktree-hosted changes now succeeds from any cwd; result paths (uatPath/tokensPath/archive) point into the worktree.
- A gates.yaml write failure now aborts finalize *before* archiving (exit 4, change intact, retryable) instead of after (stranded).
- Non-worktree changes and worktree-cwd runs are unchanged.

## Verification

- Full test suite: 2121/2121 passed (119 files)
- `npx tsc --noEmit`: clean
- `npm run lint`: clean

## Scope notes

- Gates and config still run against the session projectRoot per the intent's "path derivations only" scope; the broader worktree-blind gate/doc execution class is out of scope.
