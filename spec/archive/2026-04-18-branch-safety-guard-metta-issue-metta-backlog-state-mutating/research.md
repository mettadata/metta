# Research: branch-safety-guard-metta-issue-metta-backlog-state-mutating

## Decision: shared assertOnMainBranch in helpers.ts

### Key findings

1. `ProjectConfig.git.pr_base` (`src/schemas/project-config.ts:28`) already holds the main branch name, default `'main'`. Read via `ConfigLoader`.
2. `currentBranch` precedent: `src/execution/worktree-manager.ts:200` shows the canonical `git branch --show-current` pattern. Reuse the shape in the new helper.
3. `autoCommitFile` in `src/cli/helpers.ts` already imports `execAsync` from `node:child_process` — reuse that import.
4. All three target commands construct `createCliContext()` which loads config. The helper receives the already-loaded `config.git.pr_base` value.
5. `issue.ts`, `backlog.ts:add`, `backlog.ts:done` all have standard Commander `.action()` handlers — straightforward to insert a guard line at the top of each.

### Helper sketch

```typescript
export async function assertOnMainBranch(
  projectRoot: string,
  mainBranchName: string,
  overrideBranch?: string,
): Promise<void> {
  // Non-git project → pass silently
  try {
    await execAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectRoot })
  } catch { return }

  const { stdout } = await execAsync('git', ['branch', '--show-current'], { cwd: projectRoot })
  const current = stdout.trim()

  if (current === mainBranchName) return
  if (overrideBranch && overrideBranch === current) return

  throw new Error(
    `Refusing to write: current branch '${current}' is not the main branch '${mainBranchName}'. ` +
    `Switch branches, or use --on-branch ${current} to override.`,
  )
}
```

### Call-site wiring

Each command's `.action(async (arg, options) => { ... })` gets:
```typescript
try {
  await assertOnMainBranch(ctx.projectRoot, ctx.config.git?.pr_base ?? 'main', options.onBranch)
} catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  if (json) outputJson({ error: { code: 4, type: 'branch_guard', message } })
  else console.error(message)
  process.exit(4)
}
```

Each command's `.option('--on-branch <name>', 'Acknowledge non-main branch and proceed')` is added alongside existing options.

### Test plan

In `tests/cli.test.ts`, add a describe block `'branch-safety guard'`:
- `initRepo` + checkout `main` → run `metta issue "x"` → expect success
- `git checkout -b metta/feature` → run `metta issue "x"` → expect exit 4 with "Refusing to write"
- Same branch + `metta issue "x" --on-branch metta/feature` → expect success
- Same branch + `metta backlog add "y"` → expect exit 4
- Same branch + `metta backlog done <slug> --on-branch metta/feature` → expect success (but need to first create the slug on main then switch)

Skip non-git case by pointing at a non-repo temp dir — just a single test that shows helper doesn't throw.

### Risks

- `pr_base` may be customized per project (e.g. `master` or `develop`). Helper must use that value, not hardcode `main`. Covered by `ctx.config.git?.pr_base ?? 'main'`.
- `git branch --show-current` returns empty string in detached-HEAD state. Treat empty as "not main" → refuse; user can use `--on-branch ''` if really needed, or just checkout a branch.
- Windows line endings in `stdout.trim()` — `.trim()` handles `\r\n`.
- Existing test harness in `tests/cli.test.ts` uses temp git repos; straightforward to exercise on both main and feature branches.

### Artifacts produced

None — direct code edits only.
