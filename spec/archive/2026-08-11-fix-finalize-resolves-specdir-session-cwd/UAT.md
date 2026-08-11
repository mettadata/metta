# UAT: fix-finalize-resolves-specdir-session-cwd

- **Change**: fix-finalize-resolves-specdir-session-cwd
- **Generated**: 2026-08-11
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
- **Do**: Confirm: Resolve specDir from the change's host checkout (candidate solution 1 — the primary fix). Have `finalize.ts` derive the `Finalizer`'s specDir from the artifact store's per-change base dir for the named change (or pass the change's host root through), instead of `join(ctx.projectRoot, 'spec')` from the session cwd. All finalizer path joins — gates.yaml, `generateUat`'s `changeDir`, cleanup `rm` paths, reported `uatPath`/`tokensPath` — must then land in the same checkout the archive move operates on. This touches the `Finalizer` constructor contract; call sites and tests are updated accordingly.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Order writes so a failure cannot strand a half-archived change. Post-archive artifacts that can fail (gates.yaml) are written before the archive move or staged inside the change dir so the move sweeps them in — the same pattern UAT.md and TOKENS.md already use — so no code path can leave the change dir gone while a required archive artifact is missing.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Regression coverage: a test that hosts a change in a worktree, runs finalize with cwd at the main checkout root, and asserts (a) finalize succeeds, (b) gates.yaml lands in the worktree's archive dir, (c) the main checkout's `spec/archive/` is untouched, and (d) the reported `uatPath`/`tokensPath` point into the worktree.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Fixes the issue where `metta finalize --change <name>` run from the main checkout for a worktree-hosted change failed with ENOENT on `<main>/spec/archive/<name>/gates.yaml` and stranded the change half-archived.

#### Step 2.1
- **Do**: Confirm: src/cli/commands/finalize.ts — the Finalizer's specDir now comes from `await ctx.artifactStore.specDirFor(name)` (per-change, worktree-aware) instead of `join(ctx.projectRoot, 'spec')` (session cwd). The post-finalize auto-commit runs with `cwd: hostRoot` (`dirname(specDir)`) so the git add/commit targets the checkout that received the archive.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: src/finalize/finalizer.ts — gates.yaml is staged in the change dir via `artifactStore.writeArtifact()` before the archive move (same sweep pattern as UAT.md/TOKENS.md); the post-archive `writeFile` into `spec/archive/` is removed. All other path joins (generateUat changeDir, cleanup rm paths, uatPath/tokensPath) resolve correctly once specDir is host-resolved.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: src/artifacts/artifact-store.ts — `specDirFor(name)` made public.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: tests/finalizer.test.ts, tests/artifact-store.test.ts, tests/cli-finalize.test.ts — regression coverage: gates.yaml swept into the worktree archive; staging failure aborts pre-move with the change fully intact (no stranding); end-to-end finalize from the main checkout root over a real git worktree succeeds with all paths landing in the worktree and the main checkout untouched.
- **Observe**: behaves as described
- [ ] Pass
