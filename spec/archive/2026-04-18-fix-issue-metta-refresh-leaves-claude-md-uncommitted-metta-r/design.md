# Design: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## Approach

Reuse the existing `autoCommitFile(projectRoot, filePath, message)` helper from
`src/cli/helpers.ts`, which already handles the not-a-repo, other-tracked-files-dirty,
and empty-commit guard cases. Add a `--no-commit` Commander option to
`registerRefreshCommand` and call `autoCommitFile` from the action handler after
`runRefresh` returns, gated on `result.written && !options.noCommit`. Update two skill
templates: `metta-refresh/SKILL.md` to document the new default and `metta-init/SKILL.md`
to pass `--no-commit` so init's own discrete commit is not pre-empted.

## Components

| Component | Responsibility |
|-----------|---------------|
| `src/cli/commands/refresh.ts` | Add `.option('--no-commit', ...)` to the Commander chain; call `autoCommitFile` in the action handler after `runRefresh` returns, gated on `result.written && !options.noCommit`; surface commit result via console/JSON output. |
| `src/cli/helpers.ts` | No changes. Used as-is; `autoCommitFile` and `AutoCommitResult` already exported. |
| `src/templates/skills/metta-refresh/SKILL.md` | Document that refresh auto-commits with `chore(refresh): regenerate CLAUDE.md` by default; document `--no-commit` as the opt-out escape hatch. |
| `src/templates/skills/metta-init/SKILL.md` | Change the refresh call at line ~155 from `metta refresh` to `metta refresh --no-commit` so the init skill's own `chore: generate CLAUDE.md from discovery` commit is not pre-empted. |
| `tests/refresh-commit.test.ts` (new) | Integration tests for commit wiring: happy path, `--no-commit` skips commit, non-git dir exits 0, double-run produces no second commit. Follows `tests/auto-commit.test.ts` style (real git binary, `mkdtemp` temp repo). |

## Data Model

No schema changes. `--no-commit` is a CLI-only boolean flag; it is never persisted
to `.metta/` state files or any YAML artifact.

## API Design

Commander option added to the refresh command chain:

```ts
.option('--no-commit', 'Skip auto-commit of regenerated CLAUDE.md')
```

Commander's `--no-foo` convention: `options.noCommit` is `false` when the flag is
absent (auto-commit on), `true` when `--no-commit` is supplied (auto-commit off).
No existing `--no-*` flags exist in this codebase; this is the first instance —
the convention is well-established in Commander v12 and confirmed via its docs.

Pseudocode for the updated `action()` handler in `registerRefreshCommand`:

```ts
.action(async (options) => {
  const json = program.opts().json
  const projectRoot = process.cwd()

  try {
    const result = await runRefresh(projectRoot, options.dryRun ?? false)

    let commitResult: AutoCommitResult | undefined
    if (result.written && !options.noCommit) {
      commitResult = await autoCommitFile(
        projectRoot,
        result.filePath,
        'chore(refresh): regenerate CLAUDE.md',
      )
    }

    if (json) {
      outputJson({
        status: options.dryRun ? 'dry_run' : result.written ? 'refreshed' : 'no_changes',
        file: result.filePath,
        diff: result.diff,
        committed: commitResult?.committed ?? false,
        commit_sha: commitResult?.sha,
        commit_reason: commitResult?.reason,
      })
    } else {
      // ... existing console output, plus:
      if (commitResult?.committed) console.log(`  Committed: ${commitResult.sha?.slice(0, 7)}`)
      else if (commitResult?.reason) console.log(`  Not committed: ${commitResult.reason}`)
    }
  } catch (err) { /* existing error handling */ }
})
```

`runRefresh` signature is unchanged: `(projectRoot: string, dryRun: boolean) => Promise<{ diff: string; written: boolean; filePath: string }>`.

## Dependencies

No new dependencies. `autoCommitFile` and `AutoCommitResult` are already exported
from `src/cli/helpers.ts` and imported in `src/cli/commands/issue.ts`. Commander is
already imported in `refresh.ts`. The `autoCommitFile` edge-cases are already covered
by `tests/auto-commit.test.ts`; new tests need only verify the wiring in the action handler.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| `metta-init` double commit — once refresh auto-commits CLAUDE.md, init's own `git commit -m "chore: generate CLAUDE.md from discovery"` would fail with "nothing to commit", printing a spurious warning on every `metta init` run. | Update `src/templates/skills/metta-init/SKILL.md` line ~155 to call `metta refresh --no-commit` and keep its own separate commit. This is mandatory, not optional. |
| Discovery-agent bypass — an AI agent calling `metta refresh` directly (not via the skill) will see the auto-commit fire without the `--no-commit` guard the init skill applies. | Skill CLAUDE.md instructions explicitly forbid calling CLI commands directly from AI orchestrator sessions; the risk is documented, enforcement is via convention. |
| Unguarded concurrency — two parallel `metta refresh` calls could race on the CLAUDE.md write and the `git add/commit` sequence. | Out of scope per issue text. Document here; do not fix. A future advisory lock on the file could address this. |
