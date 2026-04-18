# Tasks: fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r

## Batch 1: Independent edits (all different files — parallel)

### Task 1.1: Add `--no-commit` flag and wire `autoCommitFile` in refresh.ts
- **Files:** `src/cli/commands/refresh.ts`
- **Action:** Add `import { autoCommitFile } from '../helpers.js'` to the import line that already brings in `outputJson`. In `registerRefreshCommand`, chain `.option('--no-commit', 'Skip auto-commit of regenerated CLAUDE.md')` onto the Commander command (after the existing `--dry-run` option). In the `.action()` handler, after `runRefresh` returns, declare `let commitResult: import('../helpers.js').AutoCommitResult | undefined` and, gated on `result.written && !options.noCommit`, call `commitResult = await autoCommitFile(projectRoot, result.filePath, 'chore(refresh): regenerate CLAUDE.md')`. In the JSON output block, add `committed: commitResult?.committed ?? false`, `commit_sha: commitResult?.sha`, and `commit_reason: commitResult?.reason` alongside existing fields. In the non-JSON output block, after the `'Refresh complete. Updated CLAUDE.md'` line, add: if `commitResult?.committed` is true, print `  Committed: ${commitResult.sha?.slice(0, 7)}`; else if `commitResult?.reason` is set, print `  Not committed: ${commitResult.reason}`. Leave `runRefresh` signature unchanged.
- **Verify:** `npx tsc --noEmit` exits 0 with no errors; `grep 'autoCommitFile' src/cli/commands/refresh.ts` matches; `grep 'no-commit' src/cli/commands/refresh.ts` matches.
- **Done:** `refresh.ts` compiles; Commander option `--no-commit` registered; `autoCommitFile` imported and called in action handler; commit result surfaced in both JSON and console output paths; `runRefresh` signature unchanged.

### Task 1.2: Update metta-refresh skill template
- **Files:** `src/templates/skills/metta-refresh/SKILL.md`
- **Action:** Append (or insert into the appropriate section) documentation stating that `metta refresh` automatically commits `CLAUDE.md` after writing it with the message `chore(refresh): regenerate CLAUDE.md`, and that `--no-commit` is the opt-out escape hatch for users who want to inspect the diff or stage the file themselves before committing. Preserve all existing purpose, invocation, and usage text verbatim.
- **Verify:** `grep 'chore(refresh): regenerate CLAUDE.md' src/templates/skills/metta-refresh/SKILL.md` matches; `grep -- '--no-commit' src/templates/skills/metta-refresh/SKILL.md` matches.
- **Done:** Skill file contains both the commit message string and the `--no-commit` flag string; existing content preserved.

### Task 1.3: Update metta-init skill template
- **Files:** `src/templates/skills/metta-init/SKILL.md`
- **Action:** Locate the line (around line 155-158) that calls `metta refresh` as part of the init flow. Change that call from `metta refresh` to `metta refresh --no-commit`. Keep the subsequent `git add CLAUDE.md && git commit -m "chore: generate CLAUDE.md from discovery"` line unchanged — init's own discrete commit must remain.
- **Verify:** `grep 'metta refresh --no-commit' src/templates/skills/metta-init/SKILL.md` matches; `grep -c 'metta refresh ' src/templates/skills/metta-init/SKILL.md` returns 1 (only the `--no-commit` form, not the bare form).
- **Done:** Init skill calls `metta refresh --no-commit`; init's own git commit line is intact; no spurious "nothing to commit" warning will be produced during `metta init`.

---

## Batch 2: Integration tests (depends on Batch 1)

### Task 2.1: Add integration test for auto-commit wiring
- **Files:** `tests/refresh-commit.test.ts` (new file)
- **Action:** Follow the style of `tests/auto-commit.test.ts` (real git binary, `mkdtemp` temp dirs, `git init --initial-branch=main`, `git config user.email/name`). Seed a minimal `spec/project.md` and at least one `spec/specs/<cap>/spec.md` so `runRefresh` produces meaningful output. Write the five scenarios below, each in its own `it()` block:
  1. **Happy path** — after `runRefresh` + `autoCommitFile`, `git log -1 --pretty=%s` equals exactly `chore(refresh): regenerate CLAUDE.md` and `git status --porcelain` shows `CLAUDE.md` is clean.
  2. **`--no-commit` skips commit** — call `runRefresh` alone (simulating `--no-commit`); assert `git log --oneline` is empty (no commits beyond the seed) and `git status --porcelain` shows `CLAUDE.md` as modified.
  3. **Non-git directory exits 0** — call `autoCommitFile` in a temp dir without `git init`; assert result is `{ committed: false, reason: 'not a git repository' }` and no exception is thrown.
  4. **No second commit on unchanged content** — run the happy path, then call `runRefresh` + `autoCommitFile` a second time; assert `git log --oneline | wc -l` equals the same count as after the first run.
  5. **Dirty unrelated tracked file — commit refused, write succeeds** — stage and commit an unrelated file, then edit it without committing; call `runRefresh` + `autoCommitFile`; assert `result.written === true` and `commitResult.committed === false` with a `reason` set; command exits 0.
- **Verify:** `npx vitest run tests/refresh-commit.test.ts` exits 0; all 5 `it()` blocks pass.
- **Done:** New test file exists; all 5 scenarios green; no modifications to existing test files.

---

## Batch 3: Full gate suite (sequential, depends on Batch 2)

### Task 3.1: Write summary.md and run full gate suite
- **Files:** `spec/changes/fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r/summary.md`
- **Action:** Write `summary.md` covering: the problem (refresh left CLAUDE.md uncommitted, silently contaminating unrelated commits); the solution (wire `autoCommitFile` in the refresh action handler, add `--no-commit` opt-out, update both skill templates); files touched (`src/cli/commands/refresh.ts`, `src/templates/skills/metta-refresh/SKILL.md`, `src/templates/skills/metta-init/SKILL.md`, `tests/refresh-commit.test.ts`); test coverage added (5 integration scenarios). Then run all gate commands: `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`.
- **Verify:** All four gate commands exit 0; `spec/changes/fix-issue-metta-refresh-leaves-claude-md-uncommitted-metta-r/summary.md` exists and is non-empty.
- **Done:** Summary written; TypeScript clean; full test suite green; lint clean; build artifact up-to-date.
