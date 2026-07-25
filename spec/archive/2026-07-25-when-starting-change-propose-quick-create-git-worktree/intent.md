# when-starting-change-propose-quick-create-git-worktree

## Problem

When `metta propose` or `metta quick` starts a change today, it runs `git checkout -b metta/<name>` in place (`src/cli/commands/propose.ts:71-82`, `src/cli/commands/quick.ts:33-40`). This switches the single working checkout onto the feature branch, which means:

- **Developers lose their main checkout.** Any other terminal, editor, or long-running process pointed at the project root is silently moved onto the feature branch. Parallel work — reviewing main, running a dev server, starting a second unrelated change — is blocked until the in-flight change ships or the user manually juggles branches.
- **Change state is written before the branch exists.** `artifactStore.createChange` writes `spec/changes/<name>/` into the current checkout *before* the branch switch, so change scaffolding can land on the wrong branch or leave the main checkout dirty.
- **AI-orchestrated sessions and humans collide.** With instruction-mode workflows running inside Claude Code, the checkout the AI mutates is the same one the human is using. There is no isolation boundary between concurrent streams of work.

Everyone using metta on a real project with more than one concurrent activity is affected: internal developers dogfooding metta, and any future adopter running propose/quick while other terminals touch the same repo.

## Proposal

Change propose and quick to create a **git worktree** for the feature branch instead of only branching in place, so the main checkout stays on `main` and other terminals continue undisturbed.

Specifically:

1. **Worktree creation.** When starting a change with git enabled, run `git worktree add <dir>/<change-name> -b metta/<name>` (or equivalent) instead of `git checkout -b`. The main checkout never changes branch.
2. **Location.** Worktrees live at `.metta/worktrees/<change-name>` inside the project root, gitignored, with the base directory configurable via a new `git.worktree.dir` config (default `.metta/worktrees`).
3. **Config schema.** Extend `GitConfigSchema` in `src/schemas/project-config.ts` with a `worktree` object: `{ enabled: boolean = true, dir: string = '.metta/worktrees' }`. The existing top-level `git.enabled !== false` guard is unchanged and still gates all git behavior, per the constitution constraint ("git.enabled controls commits, worktrees, and merge safety").
4. **Opt-out and graceful fallback.** When `git.worktree.enabled` is `false`, or when worktree creation fails (e.g. unsupported git version, locked worktree metadata), fall back to the current in-place `git checkout -b` behavior instead of failing the command. The fallback is reported in command output.
5. **Order of operations.** Reorder propose/quick so the branch + worktree are created **first**, then change state (`spec/changes/<name>/`, `.metta.yaml`, etc.) is written **inside the worktree**. The main checkout stays on main and stays clean.
6. **Change record.** Persist the worktree path on the change's `.metta.yaml`, validated by an updated Zod schema. `--json` output of propose and quick gains a `worktree` field: the absolute worktree path, or `null` when running in fallback/in-place mode.
7. **Collision handling (idempotent).**
   - Branch `metta/<name>` already exists → attach the new worktree to the existing branch rather than erroring.
   - Worktree directory already exists for this change → reuse it and report the reuse in output.
8. **Dirty main checkout.** No stash or clean-tree requirement — `git worktree add` works regardless of the main checkout's dirty state, and this change must not introduce a cleanliness precondition.
9. **Ship compatibility.** Because the main checkout remains on main, `metta ship` continues to merge the named branch into main via `MergeSafetyPipeline` in the project root exactly as today. This change only records the worktree path so a future `metta cleanup` can remove orphaned worktrees.

Touched surfaces: `src/cli/commands/propose.ts`, `src/cli/commands/quick.ts`, `src/schemas/project-config.ts`, the change-state (`.metta.yaml`) schema, `--json` output shapes for propose/quick, `.gitignore` handling for the worktree dir, and matching tests (near 1:1 test-to-source ratio).

## Impact

- **`metta propose` / `metta quick`:** Default behavior changes from in-place branch checkout to worktree creation. Users' main checkout no longer switches branches when starting a change. Implementation work for a change now happens inside `.metta/worktrees/<change-name>` instead of the project root (when worktrees are enabled).
- **Change state location:** `spec/changes/<name>/` artifacts are created in the worktree, not the main checkout, so the main checkout no longer shows uncommitted change scaffolding after propose/quick.
- **`GitConfigSchema` and project config:** Gains a `worktree` sub-object with defaults; existing configs remain valid because both fields default (`enabled: true`, `dir: '.metta/worktrees'`).
- **Change `.metta.yaml` schema:** Gains a worktree-path field (Zod-validated); existing change records without the field must continue to validate.
- **`--json` consumers:** propose/quick JSON output gains a `worktree` field (path or `null`) — additive, but downstream parsers with strict shapes will see a new key.
- **`metta ship` / finalize:** Unchanged in behavior — merges still run in the project root because the main checkout stays on main. Ship gains a cleaner precondition (main checkout actually on main) rather than a new obligation.
- **`metta cleanup` stub:** Gains the data it needs (recorded worktree path) but its implementation is untouched.
- **Skills/instructions referencing branch checkout:** Any instruction text describing "checkout -b" behavior for propose/quick needs to reflect worktree semantics.

## Out of Scope

- **`metta cleanup` implementation.** Removing or pruning worktrees (including orphaned ones) is explicitly deferred; this change only records the worktree path so cleanup can act on it later.
- **Automatic worktree removal on ship/finalize/abandon.** Ship and finalize do not delete or prune the change's worktree in this change.
- **Session/terminal management.** No automatic `cd` into the worktree, no shell integration, no editor/IDE hand-off tooling.
- **Retrofitting existing in-flight changes.** Changes started before this lands are not migrated to worktrees.
- **Stash/clean-tree handling for the main checkout.** No stashing, no dirty-tree checks — worktree creation is independent of main checkout state by design.
- **Changes to the top-level `git.enabled` guard or `MergeSafetyPipeline`.** The existing git toggle semantics and merge-safety behavior are untouched.
- **Worktrees for non-change operations.** Import, refresh, fix-gap, and other commands keep their current git behavior.
- **Multi-worktree concurrency arbitration.** No locking or coordination between multiple simultaneous changes beyond git's own worktree semantics.
