# Review — fix-root-invoked-instructions-context-complete-emit-main

Reviewed commits: `1c0ab28d9` (helper + tests), `476b2f939` (command rewiring + integration tests).
Three parallel reviewers (correctness, security, quality). Iteration #1.

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS_WITH_WARNINGS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS |

No critical findings. Two major findings, addressed as follows: security containment fixed in iteration #2; instruction-payload `output_path` logged as a follow-up issue (out of this change's intent scope, per the intent's own "log a follow-up issue rather than expanding" rule).

## Major findings

### 1. Unconstrained `worktree` metadata flows into filesystem paths and git cwd (Security) — FIXED in iteration #2
`src/cli/helpers.ts:76-81` — `resolveChangeRoot` is `metadata.worktree ?? projectRoot` with no containment check. The persisted `worktree:` field in a change's git-tracked `.metta.yaml` wins over the discovered host (`artifact-store.ts:145`) and is validated only as `z.string().optional()`. A crafted `.metta.yaml` could point git auto-commit cwd (`complete.ts:616-619`, `instructions.ts:196-204`) and emitted paths at an arbitrary directory — unintended cross-repo commits, artifact writes outside the project.
**Fix:** resolve the value and require containment under `<projectRoot>/.metta/worktrees/` via `path.relative` (not string prefix); fall back to `projectRoot` otherwise. Add tests.

### 2. Emitted `output_path` is still cwd-relative (Correctness) — FOLLOW-UP ISSUE
`src/context/instruction-generator.ts:133` — `output_path: 'spec/changes/<name>/<file>'` is relative and consumed by skills ("Write the file {output_path}"), so a main-root session driving a worktree-hosted change still writes artifacts into the main checkout. Out of this change's intent scope (Proposal covered `changePath`/`specDir`/git-cwd only, all delivered); the worktree-aware `metta complete` now fails loudly instead of validating the wrong tree, so the failure is no longer silent. Logged as follow-up issue.

## Minor findings

- `src/cli/commands/context.ts:57-62` (all three reviewers) — blanket `catch` swallows Zod/metadata-corruption errors, degrading to main-root resolution with a misleading not_found. **FIXED in iteration #2:** catch narrowed to not-found.
- Stale persisted absolute `worktree` path becomes load-bearing (correctness #2) — repo moves / cross-machine resume point paths at nonexistent dirs; pre-existing persistence contract, folded into the follow-up issue.
- `tests/cli-worktree-change-root.test.ts` — stories-valid gate re-rooting untested (correctness #4). **FIXED in iteration #2:** test added.
- Test title ambiguity at `tests/cli-worktree-change-root.test.ts:196` (quality) — **FIXED in iteration #2**.
- Comment placement imprecision `instructions.ts:68-69` (quality) — **FIXED in iteration #2**.
- Pre-existing: `complete.ts`/`instructions.ts` never `assertSafeSlug` the `--change` argument (security #4); TOCTOU existsSync patterns (security #3, pre-existing, no action). Folded into follow-up issue.
- Config-load parity caveat (correctness #5) — main-root invocation uses main's `.metta/config.yaml`; deliberate per intent, noted in code comment.

## Clean

- All path/cwd sites named in the intent verified re-rooted; non-worktree behavior provably byte-identical (`?? projectRoot` reduction).
- No new shell interpretation; git calls remain `execFile` with fixed argv.
- Helper pure, shared (no duplication), ESM/naming/test-isolation conventions all clean.
- 28/28 change tests passing; full suite 1771/1771 at implementation time.
