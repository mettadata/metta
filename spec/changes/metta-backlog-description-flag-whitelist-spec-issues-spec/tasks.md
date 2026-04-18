# Tasks: metta-backlog-description-flag-whitelist-spec-issues-spec

## Batch 1 (parallel, different files)

### Task 1.1: Add --description flag to backlog add command
- **Files:** `src/cli/commands/backlog.ts`
- **Action:** Add `.option('--description <text>', 'Full description body (defaults to title)')` to the `add` subcommand. In the action handler, compute `const description = options.description ?? title` and pass to `ctx.backlogStore.add(title, description, ...)`.
- **Verify:** `grep "'--description'" src/cli/commands/backlog.ts` returns 1; `npx vitest run tests/cli.test.ts` passes.
- **Done:** flag registered and wired.

### Task 1.2: Extend guard-hook allow-list with prefix match
- **Files:** `src/templates/hooks/metta-guard-edit.mjs`, `.claude/hooks/metta-guard-edit.mjs`
- **Action:** Add an `ALLOW_PREFIXES = ['spec/issues/', 'spec/backlog/']` array next to `ALLOW_LIST`. Inside the filePath check block, after the exact-match check, add `if (ALLOW_PREFIXES.some(p => relPath.startsWith(p) && relPath.endsWith('.md'))) process.exit(0)`. Mirror to `.claude/`.
- **Verify:** `grep 'ALLOW_PREFIXES' src/templates/hooks/metta-guard-edit.mjs` returns ≥ 1; `diff src/templates/hooks/metta-guard-edit.mjs .claude/hooks/metta-guard-edit.mjs` empty; `npx vitest run tests/metta-guard-edit.test.ts` passes.
- **Done:** prefix whitelist active; existing tests green.

### Task 1.3: Update metta-backlog skill template
- **Files:** `src/templates/skills/metta-backlog/SKILL.md`, `.claude/skills/metta-backlog/SKILL.md`
- **Action:** In the skill file, locate the `metta backlog add` invocation. Change from `metta backlog add "<title>"` (followed by a post-Edit instruction) to `metta backlog add "<title>" --description "<description>"`. Remove the post-Edit instruction paragraph that references `spec/backlog/<slug>.md`. Mirror to `.claude/`.
- **Verify:** `grep -- '--description' src/templates/skills/metta-backlog/SKILL.md` returns ≥ 1; `grep 'Edit spec/backlog' src/templates/skills/metta-backlog/SKILL.md` returns 0; `diff src/templates/skills/metta-backlog/SKILL.md .claude/skills/metta-backlog/SKILL.md` empty.
- **Done:** skill uses flag; no post-Edit workaround.

## Batch 2 (after Batch 1): Tests + summary + gate suite

### Task 2.1: Add CLI + hook tests
- **Files:** `tests/cli.test.ts`, `tests/metta-guard-edit.test.ts`
- **Action:** (a) In `tests/cli.test.ts`, add a new `it('metta backlog add --description populates the body')` that invokes the CLI with the flag in a temp repo and reads back the created file body. (b) In `tests/metta-guard-edit.test.ts`, add 3 cases: (i) Edit to `spec/issues/foo.md` exits 0, (ii) Edit to `spec/backlog/foo.md` exits 0, (iii) Edit to `src/foo.ts` still exits 2. Run both source + deployed hook forms as the file does today.
- **Verify:** `npm test` passes; all new cases pass.
- **Done:** tests green.

### Task 2.2: Summary + gate suite
- **Files:** `spec/changes/metta-backlog-description-flag-whitelist-spec-issues-spec/summary.md`
- **Action:** Summarize; run tsc/lint/test/build.
- **Verify:** all four gates pass.
- **Done:** summary written.
