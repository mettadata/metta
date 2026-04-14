# Tasks for metta-issue-metta-backlog-slas

## Batch 1 (independent, parallel-safe)

- [ ] **Task 1.1: Create `/metta-issue` skill (template + deployed copy)**
  - **Files**: `src/templates/skills/metta-issue/SKILL.md` (new), `.claude/skills/metta-issue/SKILL.md` (new)
  - **Action**: Write terse skill body per design.md. Frontmatter `name: metta:issue`. Body asks for description + severity via `AskUserQuestion` if missing, runs `metta issue "<desc>" --severity <level>`, echoes created path. Make both files byte-identical.
  - **Verify**: `diff src/templates/skills/metta-issue/SKILL.md .claude/skills/metta-issue/SKILL.md` produces no output.
  - **Done**: Scenarios S1, S2 (issue skill exists + deployed) covered structurally.

- [ ] **Task 1.2: Create `/metta-backlog` skill (template + deployed copy)**
  - **Files**: `src/templates/skills/metta-backlog/SKILL.md` (new), `.claude/skills/metta-backlog/SKILL.md` (new)
  - **Action**: Before writing, read `src/cli/commands/backlog.ts` and `src/backlog/backlog-store.ts` to confirm exact flags for `add`/`promote`. Body branches on list/show/add/promote via `AskUserQuestion`. Use `metta backlog list --json` to drive the promote picker. Make both files byte-identical.
  - **Verify**: `diff` produces no output; each of `list`, `show`, `add`, `promote` appears in the body.
  - **Done**: Scenarios S3, S4 covered structurally.

## Batch 2 (depends on nothing — can run parallel with Batch 1, but sequenced for clarity)

- [ ] **Task 2.1: Remove `metta idea` CLI command and wiring**
  - **Files**: `src/cli/commands/idea.ts` (delete), `src/cli/index.ts` (modify), `src/cli/helpers.ts` (modify)
  - **Action**: Delete `src/cli/commands/idea.ts`. Remove the import + registration line from `src/cli/index.ts`. Remove `IdeasStore` import, `ideasStore` field on `CliContext`, and the instantiation from `src/cli/helpers.ts`.
  - **Verify**: `grep -r "registerIdeaCommand\|IdeasStore\|ideasStore" src/cli/` returns nothing.
  - **Done**: Scenarios S5, S6 partially covered (command no longer registered).

- [ ] **Task 2.2: Delete idea store and barrel export**
  - **Files**: `src/ideas/` (delete dir), `src/index.ts` (modify)
  - **Action**: `rm -rf src/ideas/`. Remove line 10 barrel export from `src/index.ts`.
  - **Verify**: `ls src/ideas 2>&1` reports missing; `grep "ideas-store" src/index.ts` empty.
  - **Done**: Scenario S6 (store deleted) covered.

- [ ] **Task 2.3: Remove idea references from refresh pipeline**
  - **Files**: `src/cli/commands/refresh.ts`
  - **Action**: Delete line emitting `- metta idea <description>` bullet (line 150) and line emitting `[Ideas](spec/ideas/)` TOC row (line 178).
  - **Verify**: `grep "metta idea\|\[Ideas\]" src/cli/commands/refresh.ts` returns nothing.
  - **Done**: Scenario S8 (refresh no longer emits Ideas row) covered.

- [ ] **Task 2.4: Delete idea tests and remove idea assertions**
  - **Files**: `tests/ideas-store.test.ts` (delete), `tests/cli.test.ts` (modify)
  - **Action**: Delete `tests/ideas-store.test.ts`. Remove the `describe('metta idea', ...)` block from `tests/cli.test.ts`. Grep for any other `metta idea` or `ideas-store` references and remove those too.
  - **Verify**: `grep -r "ideas-store\|metta idea\|IdeasStore" tests/` returns nothing.
  - **Done**: Scenario S6 fully covered.

- [ ] **Task 2.5: Audit refresh tests for idea assertions**
  - **Files**: `tests/refresh.test.ts`
  - **Action**: Read the file. If any test asserts the presence of the `Ideas` row or `metta idea` bullet, update the expectations to reflect their absence. If no assertions touch that content, no change.
  - **Verify**: `npx vitest run tests/refresh.test.ts` passes.
  - **Done**: Refresh tests align with new output.

## Batch 3 (depends on Batch 1 + Batch 2)

- [ ] **Task 3.1: Add skill static-file tests**
  - **Depends on**: Tasks 1.1, 1.2, 2.4
  - **Files**: `tests/cli.test.ts`
  - **Action**: Add two `describe` blocks modelled on the existing `metta-next skill template` test. For each of issue and backlog: assert file exists at template path, template is byte-identical to deployed copy, body references required CLI substrings (for backlog, assert each of `list`, `show`, `add`, `promote`).
  - **Verify**: `npx vitest run tests/cli.test.ts -t "skill template"` passes for both new suites and the pre-existing ones.
  - **Done**: Scenarios S1–S4 covered by passing tests.

## Batch 4 (depends on all prior batches)

- [ ] **Task 4.1: Build and full test suite**
  - **Depends on**: 1.1, 1.2, 2.1–2.5, 3.1
  - **Files**: none (verification)
  - **Action**: `npm run build && npx vitest run`. Build must pass with zero TS errors (catches any missed `IdeasStore` reference). All tests must pass.
  - **Verify**: both commands exit 0.
  - **Done**: integration clean.

- [ ] **Task 4.2: Manual smoke of removed and retained commands**
  - **Depends on**: 4.1
  - **Files**: none (verification)
  - **Action**: Run `metta idea foo` — expect non-zero exit and Commander "unknown command" error (Scenario S5). Run `metta issue "test" --severity minor` in a throwaway tmp-dir metta project — expect success and a file in `spec/issues/`. Run `metta backlog list` — expect success (empty list is fine). Clean up tmp dir.
  - **Verify**: outputs match expectations; no unhandled exceptions.
  - **Done**: Scenario S5 confirmed end-to-end; retained commands intact.

- [ ] **Task 4.3: Regenerate CLAUDE.md**
  - **Depends on**: 4.1, 4.2
  - **Files**: `CLAUDE.md` (this repo)
  - **Action**: Run `metta refresh`. Commit the regenerated file in a separate commit if changes are present. This proves Scenario S8 against the live pipeline and keeps this repo's docs current.
  - **Verify**: `grep "metta idea\|\[Ideas\]" CLAUDE.md` returns nothing.
  - **Done**: Scenario S8 confirmed.

## Scenario Coverage

| Scenario | Tasks |
|---|---|
| S1: issue skill template exists | 1.1, 3.1 |
| S2: issue skill deployed byte-identical | 1.1, 3.1 |
| S3: backlog skill template covers all subcommands | 1.2, 3.1 |
| S4: backlog skill deployed byte-identical | 1.2, 3.1 |
| S5: `metta idea` no longer exists | 2.1, 4.2 |
| S6: idea store and tests deleted | 2.2, 2.4 |
| S7: idea refs removed from docs/templates | 2.3, 2.4 |
| S8: refresh omits Ideas row and bullet | 2.3, 4.3 |
