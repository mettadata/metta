# spec-branch-safety-guard-metta-issue-metta-backlog-state

## Requirement: assert-on-main-branch-helper

Fulfills: US-1, US-3
`src/cli/helpers.ts` MUST export an async function `assertOnMainBranch(projectRoot: string, mainBranchName: string, overrideBranch?: string): Promise<void>`. The helper MUST:

### Scenario: guard passes on main
- GIVEN HEAD is on `main`
- WHEN `assertOnMainBranch(projectRoot, 'main')` is called
- THEN it resolves without throwing

### Scenario: guard throws on feature branch without override
- GIVEN HEAD is on `metta/fix-foo`
- WHEN `assertOnMainBranch(projectRoot, 'main')` is called
- THEN it throws with a message containing both `metta/fix-foo` and `main`

### Scenario: override matching current branch passes
- GIVEN HEAD is on `metta/fix-foo`
- WHEN `assertOnMainBranch(projectRoot, 'main', 'metta/fix-foo')` is called
- THEN it resolves without throwing

### Scenario: override NOT matching current branch still throws
- GIVEN HEAD is on `metta/fix-foo`
- WHEN `assertOnMainBranch(projectRoot, 'main', 'some-other-branch')` is called
- THEN it throws (override must name the actual current branch)

### Scenario: non-git project passes silently
- GIVEN the project root is not a git repository
- WHEN `assertOnMainBranch(projectRoot, 'main')` is called
- THEN it resolves without throwing


## Requirement: issue-and-backlog-commands-use-branch-guard

Fulfills: US-1, US-2, US-3
`metta issue`, `metta backlog add`, and `metta backlog done` MUST call `assertOnMainBranch` at the start of their action handlers, using `config.git.pr_base` (or its default `'main'`) as the main branch name and `options.onBranch` as the override. Each command MUST register a `--on-branch <name>` CLI option. When the helper throws, the command MUST exit with code 4 and surface the error message to stderr (or as a JSON error when `--json` is set).

### Scenario: metta issue blocks on feature branch
- GIVEN HEAD is on a non-main branch
- WHEN `metta issue "something"` is invoked without `--on-branch`
- THEN the command exits with code 4 and stderr contains `Refusing to write`

### Scenario: metta backlog add blocks on feature branch
- GIVEN HEAD is on a non-main branch
- WHEN `metta backlog add "something"` is invoked without `--on-branch`
- THEN the command exits with code 4 and stderr contains `Refusing to write`

### Scenario: metta backlog done blocks on feature branch
- GIVEN HEAD is on a non-main branch
- WHEN `metta backlog done <slug>` is invoked without `--on-branch`
- THEN the command exits with code 4 and stderr contains `Refusing to write`

### Scenario: --on-branch override allows write
- GIVEN HEAD is on `metta/fix-foo`
- WHEN `metta issue "x" --on-branch metta/fix-foo` is invoked
- THEN the command proceeds and exits 0, creating the issue file

### Scenario: main branch path unchanged
- GIVEN HEAD is on `main` and no `--on-branch` is supplied
- WHEN any of the three commands is invoked
- THEN the command proceeds and exits 0 (guard is a no-op)
