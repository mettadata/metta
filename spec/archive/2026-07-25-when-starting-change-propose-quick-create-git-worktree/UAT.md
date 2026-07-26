# UAT: when-starting-change-propose-quick-create-git-worktree

- **Change**: when-starting-change-propose-quick-create-git-worktree
- **Generated**: 2026-07-25
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
Do not edit this document to make a step pass.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Worktree creation. When starting a change with git enabled, run `git worktree add <dir>/<change-name> -b metta/<name>` (or equivalent) instead of `git checkout -b`. The main checkout never changes branch.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Location. Worktrees live at `.metta/worktrees/<change-name>` inside the project root, gitignored, with the base directory configurable via a new `git.worktree.dir` config (default `.metta/worktrees`).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Config schema. Extend `GitConfigSchema` in `src/schemas/project-config.ts` with a `worktree` object: `{ enabled: boolean = true, dir: string = '.metta/worktrees' }`. The existing top-level `git.enabled !== false` guard is unchanged and still gates all git behavior, per the constitution constraint ("git.enabled controls commits, worktrees, and merge safety").
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Opt-out and graceful fallback. When `git.worktree.enabled` is `false`, or when worktree creation fails (e.g. unsupported git version, locked worktree metadata), fall back to the current in-place `git checkout -b` behavior instead of failing the command. The fallback is reported in command output.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: Order of operations. Reorder propose/quick so the branch + worktree are created first, then change state (`spec/changes/<name>/`, `.metta.yaml`, etc.) is written inside the worktree. The main checkout stays on main and stays clean.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.6
- **Do**: Confirm: Change record. Persist the worktree path on the change's `.metta.yaml`, validated by an updated Zod schema. `--json` output of propose and quick gains a `worktree` field: the absolute worktree path, or `null` when running in fallback/in-place mode.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.7
- **Do**: Confirm: Collision handling (idempotent).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.8
- **Do**: Confirm: Dirty main checkout. No stash or clean-tree requirement — `git worktree add` works regardless of the main checkout's dirty state, and this change must not introduce a cleanliness precondition.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.9
- **Do**: Confirm: Ship compatibility. Because the main checkout remains on main, `metta ship` continues to merge the named branch into main via `MergeSafetyPipeline` in the project root exactly as today. This change only records the worktree path so a future `metta cleanup` can remove orphaned worktrees.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

`metta propose` and `metta quick` now create a git worktree for the feature branch instead of switching the main checkout in place, so other terminals can keep working on the main checkout in parallel.

#### Step 2.1
- **Do**: Confirm: Gated by `git.enabled !== false` AND `git.worktree.enabled !== false`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: Worktree at `<projectRoot>/.metta/worktrees/<change-name>` (base dir configurable via `git.worktree.dir`), gitignored.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: Graceful fallback to in-place `git checkout -b` when disabled or when `git worktree add` fails — including cleanup of the branch ref a failed `worktree add -b` leaves behind, so fallback never hits "branch already exists".
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: Idempotent collisions: existing branch → attach; existing worktree → reuse (reported in output).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: No clean-tree precondition on the main checkout.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: Main checkout never switches branches in worktree mode.
- **Observe**: behaves as described
- [ ] Pass
