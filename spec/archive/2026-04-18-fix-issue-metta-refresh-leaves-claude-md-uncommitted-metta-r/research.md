# Research: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## Decision: Use the existing `autoCommitFile` helper from `src/cli/helpers.ts`

### Approaches Considered

1. **Inline two-step pattern inspired by `finalize.ts` / `complete.ts`** (rejected)
   — `git add <path>` then `git diff --cached --quiet` with commit in the `.catch()`, wrapped in a bare try/catch. The `intent.md` and initial `spec.md` drafts pointed at this. It works, but it duplicates logic that already exists as a helper and does not check whether other tracked files are dirty (which risks sweeping unrelated changes into the refresh commit if the caller staged something earlier).

2. **Use `autoCommitFile(projectRoot, filePath, message)` helper** (selected)
   — Already exists at `src/cli/helpers.ts:75-120`. Single-file contract matches `runRefresh`'s output exactly (`result.filePath` is the one file to commit). Already handles: `git rev-parse --is-inside-work-tree` check, other-tracked-files-dirty guard, empty-commit guard, subprocess failure → structured `{ committed: false, reason }` result. Already used by `src/cli/commands/issue.ts`. Already unit-tested in `tests/auto-commit.test.ts` with a real git binary and temp-dir repo.

### Rationale

The helper is strictly more robust than the inline pattern — it refuses to commit when other tracked files are dirty, returning a structured reason instead of silently burying changes into the refresh commit. This matters for `metta refresh` because users frequently run it mid-workflow when other edits are in flight.

Using the helper also means the commit behavior is already covered by `tests/auto-commit.test.ts` (5 scenarios, real git). Our new tests only need to verify the wiring in `registerRefreshCommand` — one integration test against a temp git repo — rather than re-testing all the edge cases.

The spec.md currently describes the inline pattern in its requirement bodies. The design.md (next artifact) should supersede that with the helper-based approach and call out that the scenarios themselves remain valid — only the implementation primitive changes.

### Integration points confirmed

- **`runRefresh` signature** — currently `(projectRoot: string, dryRun: boolean): Promise<{ diff, written, filePath }>` at `src/cli/commands/refresh.ts:232`. The helper-based design lets us leave the signature untouched and call `autoCommitFile` from `registerRefreshCommand` after `runRefresh` returns. **This is cleaner than adding a `noCommit` parameter to `runRefresh`** — the flag only affects CLI wiring, not core refresh logic.
- **`--no-commit` flag** — add via Commander `.option('--no-commit', ...)` on the refresh command. Action handler reads `options.noCommit` and skips the `autoCommitFile` call when present.
- **Skill template interaction** — `src/templates/skills/metta-init/SKILL.md:155-158` manually runs `metta refresh && git add CLAUDE.md && git commit`. Once refresh auto-commits, the skill's own `git commit` becomes a spurious "nothing to commit" warning. **Fix: update the init skill to call `metta refresh --no-commit`** and keep its own commit (which uses a different message: `chore: generate CLAUDE.md from discovery`).
- **`src/templates/skills/metta-refresh/SKILL.md`** — document the auto-commit default and `--no-commit` opt-out.
- **Finalizer placeholder** — `src/finalize/finalizer.ts:121-122` has `const refreshed = false` for future wiring. Out of scope; add a one-line comment noting any future wiring must pass `--no-commit` equivalent.

### Test strategy

Follow the `tests/auto-commit.test.ts` style for the new integration test:
- `mkdtemp` + `git init --initial-branch=main` + seed commit helper.
- Write a minimal `spec/project.md` and `spec/specs/` structure.
- Invoke `runRefresh` then `autoCommitFile` (or the new CLI action) directly.
- Assert `git log --oneline` shows `chore(refresh): regenerate CLAUDE.md`.
- Separate tests for: `--no-commit` skips the commit, `git.enabled: false` / non-git dir → `autoCommitFile` returns `{ committed: false }` and command exits 0, double-run does not create a second commit.

### Artifacts Produced

None — decision is to reuse existing helper; no new contracts, schemas, or flows introduced.

### Risks carried forward to design/tasks

1. **`metta-init` skill update** is mandatory, not optional — without it, every `metta init` run prints a spurious git warning. Task list must include `src/templates/skills/metta-init/SKILL.md` as a file to edit.
2. **Test updates** — `tests/refresh.test.ts` and `tests/cli.test.ts` both call `runRefresh` directly. The helper-based design keeps `runRefresh`'s signature stable, so existing tests should not break; only new tests are added.
3. **Concurrency** — unguarded. Out of scope per issue text; document but do not fix.
