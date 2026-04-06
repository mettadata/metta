# Gap: Parallel worktree merge order is not documented as a safety contract

**Module**: `src/execution/execution-engine.ts`, `src/execution/worktree-manager.ts`
**Discovered**: 2026-04-06
**Severity**: High

## Observation

In `executeBatchParallel`, after all tasks complete concurrently, worktrees are
merged back to the main branch by iterating `batch.tasks` in array order:

```ts
for (const task of batch.tasks) {
  const wt = worktrees.get(task.id)
  if (!wt) continue
  if (task.status === 'complete') {
    const mergeResult = await this.worktreeManager.merge(wt)
    ...
  }
  await this.worktreeManager.remove(wt)
}
```

The merge order is determined by task definition order in the plan. If two
tasks touch different files this is safe, but if file overlap was somehow
missed (e.g., due to dynamic file creation not declared in `files`), the
later merge will overwrite the earlier one's changes without conflict detection
at the file level.

The `WorktreeManager.merge` uses `--no-ff` which requires a clean working tree.
There is no verification that the main branch HEAD has not moved between worktree
creation and merge time (e.g., if another process commits during execution).

## Missing spec coverage

- The spec does not state what the merge order guarantee is
- The spec does not address the case where HEAD moves during parallel execution
- There is no test for concurrent worktree merges or merge ordering

## Recommended resolution

Add to the spec:

> The engine MUST merge parallel task worktrees in the order tasks appear in
> `BatchPlan.batches[n].tasks`. The merge of each worktree MUST complete before
> the next merge begins.

> If the repository HEAD has advanced since a worktree's `baseCommit` was
> recorded, the merge SHOULD still proceed; Git's merge machinery will detect
> and report any conflicts.

Consider adding a rebase-before-merge step as a merge-safety enhancement
(tracked separately in the merge-safety backlog).
