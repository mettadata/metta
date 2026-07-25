# Summary: when-starting-change-propose-quick-create-git-worktree

## What was built

`metta propose` and `metta quick` now create a git worktree for the feature branch instead of switching the main checkout in place, so other terminals can keep working on the main checkout in parallel.

## Implementation

- **New helper `src/util/git-worktree.ts`** — `setupChangeWorktree(projectRoot, changeName, gitConfig?)` returns `{ branch, worktree, mode, fallbackReason? }` with modes `created | attached | reused | fallback | skipped`, plus `ensureGitignoreEntry` for the worktree base dir. All git calls go through `execFile` (no shell interpolation).
- **`src/cli/commands/propose.ts` / `quick.ts`** — worktree is created after flag validation but before any change state is written; change state is then written via a CLI context rooted at the worktree, so the main checkout stays on main and stays clean. JSON output gains `worktree: <absolute path> | null`; human output reports the path, reuse, or fallback.
- **`src/schemas/project-config.ts`** — `GitConfigSchema` gains `worktree: { enabled: boolean = true, dir: string = '.metta/worktrees' }` (strict, defaulted — existing configs stay valid).
- **`src/schemas/change-metadata.ts`** — optional `worktree: string` field; persisted through `createChange` in the single validated `.metta.yaml` write (existing records without the field still validate).
- **`src/artifacts/artifact-store.ts`** — new `deriveChangeName()` (name needed before state exists) and optional `worktree` param on `createChange`.

## Behavior rules delivered

1. Gated by `git.enabled !== false` AND `git.worktree.enabled !== false`.
2. Worktree at `<projectRoot>/.metta/worktrees/<change-name>` (base dir configurable via `git.worktree.dir`), gitignored.
3. Graceful fallback to in-place `git checkout -b` when disabled or when `git worktree add` fails — including cleanup of the branch ref a failed `worktree add -b` leaves behind, so fallback never hits "branch already exists".
4. Idempotent collisions: existing branch → attach; existing worktree → reuse (reported in output).
5. No clean-tree precondition on the main checkout.
6. Main checkout never switches branches in worktree mode.

## Tests and gates

- New: `tests/git-worktree.test.ts` (16 tests, temp-dir git repos), `tests/cli-propose-worktree.test.ts` (6 end-to-end CLI tests), 9 schema cases in `tests/schemas.test.ts` including backward compatibility.
- `tests/helpers/cli.ts` gains `disableWorktrees(dir)`; 7 lifecycle suites that drive follow-up commands from the project root now exercise the fallback path, while worktree mode has dedicated coverage.
- Gates: `npm test` 1560 passed / 0 failed (92 files); `npx tsc --noEmit` clean; lint clean; build success.

## Out of scope (deferred per intent)

Worktree removal/pruning (`metta cleanup` implementation), automatic removal on ship/finalize, session `cd` hand-off, migration of in-flight changes, and changes to `git.enabled` semantics or `MergeSafetyPipeline`.
