# Tasks for fix-metta-next-gap-detect-unme

## Batch 1 (no dependencies)

- [ ] **Task 1.1: Implement ship-candidate detection in `metta next`**
  - **Files**: `src/cli/commands/next.ts`
  - **Action**: Add private `detectShipCandidate(root, baseBranch)` helper using `execFile` for `git symbolic-ref --short HEAD` and `git rev-list --count <base>..HEAD`. In the `changes.length === 0` branch, load config (`ctx.configLoader.load()`), resolve base branch (`config.git?.pr_base ?? 'main'`), call the helper, and emit the ship JSON/human response when non-null. Preserve the existing propose response otherwise.
  - **Verify**: `npm run build` passes. Manual smoke: on current branch `metta/fix-metta-next-gap-detect-unme` (ahead of main), run `node dist/cli/index.js next --json` and confirm `next: "ship"`.
  - **Done**: Scenario S1 (next after finalize on a metta branch) and S3 (no unmerged commits) behave correctly via manual smoke.

- [ ] **Task 1.2: Update `/metta-next` skill in both locations**
  - **Files**: `src/templates/skills/metta-next/SKILL.md`, `.claude/skills/metta-next/SKILL.md`
  - **Action**: Add a Rules bullet: `If `metta next` says "ship", run `/metta-ship` (or the returned command) to merge the branch to main`. Ensure both files are byte-identical after edit (template + deployed copy).
  - **Verify**: `diff src/templates/skills/metta-next/SKILL.md .claude/skills/metta-next/SKILL.md` produces no output.
  - **Done**: Scenario S5 (static skill-file test) will pass once Task 2.2 lands.

## Batch 2 (depends on Batch 1)

- [ ] **Task 2.1: Add CLI tests for post-finalize ship detection**
  - **Depends on**: Task 1.1
  - **Files**: `tests/cli.test.ts`
  - **Action**: Add a `describe('metta next post-finalize', ...)` block with the 4 scenarios from design.md Test Strategy: ship on `metta/example`, propose on clean `metta/*`, propose on main, propose when main is missing. Use the existing tmp-dir + git init fixture pattern from neighboring tests.
  - **Verify**: `npx vitest run tests/cli.test.ts -t "post-finalize"` — all 4 pass.
  - **Done**: Scenarios S1–S4 covered by passing tests.

- [ ] **Task 2.2: Add static skill-file test**
  - **Depends on**: Task 1.2
  - **Files**: `tests/cli.test.ts` (or a new small test file if that file grows unwieldy — use judgment)
  - **Action**: Add a test that reads both `src/templates/skills/metta-next/SKILL.md` and `.claude/skills/metta-next/SKILL.md`, asserts both contain the string `"ship"` in a Rules context, and asserts the two files are byte-identical.
  - **Verify**: `npx vitest run tests/cli.test.ts -t "metta-next skill"` passes.
  - **Done**: Scenario S5 covered.

## Batch 3 (depends on Batch 2)

- [ ] **Task 3.1: Full build + test + smoke**
  - **Depends on**: Tasks 2.1, 2.2
  - **Files**: none (verification only)
  - **Action**: `npm run build && npx vitest run`. Then on this branch run `node dist/cli/index.js next --json` and confirm the ship response fires. Switch to `main` briefly (`git stash` if dirty), run again, confirm propose response. Restore branch state.
  - **Verify**: Full suite green; manual smoke confirms both paths.
  - **Done**: Change ready to finalize.

## Scenario Coverage

| Scenario | Task |
|---|---|
| S1: next after finalize on a metta branch | 1.1 (impl) + 2.1 (test) |
| S2: next on main with no active changes | 2.1 |
| S3: metta branch with no unmerged commits | 1.1 (impl) + 2.1 |
| S4: main branch is missing | 1.1 (impl) + 2.1 |
| S5: skill runs ship (static file check) | 1.2 (impl) + 2.2 (test) |
