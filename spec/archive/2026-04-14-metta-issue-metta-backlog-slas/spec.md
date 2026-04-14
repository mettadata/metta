# metta-issue-metta-backlog-slas

## ADDED: Requirement: issue-slash-command

A `/metta-issue` skill MUST exist at `src/templates/skills/metta-issue/SKILL.md` and MUST be copied to `.claude/skills/metta-issue/SKILL.md` by the install pipeline. The skill MUST accept optional `description` and `severity` arguments, prompt for any missing values via `AskUserQuestion`, and execute `metta issue <description> --severity <level>`. The skill MUST report the path of the created issue file and exit. The skill frontmatter MUST declare `name: metta:issue`.

### Scenario: issue skill template exists and invokes the right CLI
- GIVEN the repository at head
- WHEN a reader inspects `src/templates/skills/metta-issue/SKILL.md`
- THEN the file exists, its frontmatter declares `name: metta:issue`, and the body references the `metta issue` CLI command with the `--severity` flag

### Scenario: issue skill is deployed by install
- GIVEN a fresh project where `metta install` has just been run
- WHEN a reader inspects `.claude/skills/metta-issue/SKILL.md` in that project
- THEN the file is byte-identical to the template in `src/templates/skills/metta-issue/SKILL.md`

## ADDED: Requirement: backlog-slash-command

A `/metta-backlog` skill MUST exist at `src/templates/skills/metta-backlog/SKILL.md` and MUST be copied to `.claude/skills/metta-backlog/SKILL.md` by the install pipeline. The skill MUST support selection of the four subcommands `list`, `show`, `add`, and `promote`. For `add`, the skill MUST collect title, optional priority (`high` / `medium` / `low`), and description via `AskUserQuestion`. For `promote`, the skill MUST first run `metta backlog list --json` to surface available slugs, let the user pick one, then run `metta backlog promote <slug>`. The skill frontmatter MUST declare `name: metta:backlog`.

### Scenario: backlog skill template exists and covers all subcommands
- GIVEN the repository at head
- WHEN a reader inspects `src/templates/skills/metta-backlog/SKILL.md`
- THEN the file exists, its frontmatter declares `name: metta:backlog`, and the body documents each of `list`, `show`, `add`, and `promote` with the `metta backlog <subcommand>` CLI invocation

### Scenario: backlog skill is deployed by install
- GIVEN a fresh project where `metta install` has just been run
- WHEN a reader inspects `.claude/skills/metta-backlog/SKILL.md` in that project
- THEN the file is byte-identical to the template in `src/templates/skills/metta-backlog/SKILL.md`

## REMOVED: Requirement: idea-command

The `metta idea` CLI command and its supporting store MUST be removed. The following MUST NOT exist after this change: the `idea` command registration in `src/cli/index.ts`, the file `src/cli/commands/idea.ts` (if present as a standalone file), the directory `src/ideas/`, and the file `tests/ideas-store.test.ts`. CLI tests targeting `metta idea` in `tests/cli.test.ts` MUST be removed. References to `metta idea` or `spec/ideas/` MUST be removed from `src/templates/skills/*/SKILL.md`, workflow documentation, prompts, and the CLAUDE.md generation pipeline (so `metta refresh` no longer emits an Ideas row or an `idea` bullet).

### Scenario: idea CLI command no longer exists
- GIVEN the repository at head
- WHEN a user runs `metta idea foo` in any project
- THEN the command exits with an "unknown command" error from Commander and non-zero status

### Scenario: idea store and tests are deleted
- GIVEN the repository at head
- WHEN a reader looks for `src/ideas/`, `src/cli/commands/idea.ts`, and `tests/ideas-store.test.ts`
- THEN none of these paths exist

### Scenario: idea references removed from docs and templates
- GIVEN the repository at head
- WHEN a reader greps for `metta idea` or `spec/ideas` under `src/templates/`, `src/cli/commands/refresh.ts`, `README.md`, and active top-level docs (`QA-TEST-GUIDE.md`)
- THEN no matches are found except inside immutable historical records (`spec/changes/`, `spec/archive/`, the v0.1 build log at root `tasks.md`, and design proposals under `docs/proposed/`)

### Scenario: refresh no longer emits an Ideas row
- GIVEN a project where `metta refresh` is run after this change
- WHEN a reader inspects the generated `CLAUDE.md` Table of Contents
- THEN the `[Ideas](spec/ideas/)` row is absent and the Workflow "Organization" section does not list `metta idea`
