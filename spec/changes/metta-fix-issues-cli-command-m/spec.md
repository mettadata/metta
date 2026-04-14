# Spec: metta-fix-issues-cli-command-m

## ADDED: Requirement: fix-issue-cli-command

`metta fix-issue` MUST be implemented in `src/cli/commands/fix-issue.ts` mirroring the
four-branch structure of `fix-gap.ts`. It MUST use the issues-domain severity enum
(`critical | major | minor`) rather than the gaps-domain enum (`critical | medium | low`).
The command MUST accept an optional positional `[issue-slug]` argument plus options
`--all`, `--severity <level>`, and `--remove-issue <slug>`.

When no arguments are supplied the command MUST print usage instructions directing
the user to invoke the `/metta-fix-issues` skill for interactive selection. When a slug
is supplied the command MUST print issue details (title, severity, status, description)
and a delegate hint of the form
`metta execute --skill fix-issues --target <slug>`. When `--all` is supplied the
command MUST list all open issues sorted by severity (critical first, then major, then
minor), one line per issue formatted as
`[SEVERITY ] [STATUS] <slug padded> <title>`. When `--severity <level>` is combined
with `--all` the command MUST filter to only issues matching that level. When
`--remove-issue <slug>` is supplied the command MUST call `IssuesStore.archive(slug)`
then `IssuesStore.remove(slug)` and commit the changes with message
`fix(issues): remove resolved issue <slug>`.

All branches MUST honour the `--json` global flag, emitting structured JSON rather than
prose when set.

### Scenario: no-args prints usage

- GIVEN the user runs `metta fix-issue` with no additional arguments
- WHEN the command action executes
- THEN stdout contains the string `Usage: metta fix-issue` and references the
  `/metta-fix-issues` skill for interactive selection, and the process exits with code 0

### Scenario: single-slug prints details and delegate hint

- GIVEN an issue with slug `spec-merger-strips-inline-backticks` exists in
  `spec/issues/`
- WHEN the user runs `metta fix-issue spec-merger-strips-inline-backticks`
- THEN stdout includes the issue title, severity, and status, and includes the text
  `metta execute --skill fix-issues --target spec-merger-strips-inline-backticks`

### Scenario: single-slug not found exits non-zero

- GIVEN no issue file with slug `no-such-issue` exists
- WHEN the user runs `metta fix-issue no-such-issue`
- THEN stderr contains `no-such-issue` and the process exits with code 4

### Scenario: --all lists issues sorted severity-first

- GIVEN three issues exist with severities critical, minor, and major respectively
- WHEN the user runs `metta fix-issue --all`
- THEN stdout lists the critical issue first, the major issue second, the minor issue
  third, each line tagged with its severity in brackets

### Scenario: --all --severity filters to matching tier

- GIVEN issues with severities critical, major, and minor exist
- WHEN the user runs `metta fix-issue --all --severity critical`
- THEN stdout contains only the critical issue and does not mention the major or minor
  issues

### Scenario: --remove-issue archives and commits

- GIVEN an issue with slug `stale-issue` exists in `spec/issues/`
- WHEN the user runs `metta fix-issue --remove-issue stale-issue`
- THEN `spec/issues/resolved/stale-issue.md` exists, `spec/issues/stale-issue.md` does
  not exist, and a git commit with message
  `fix(issues): remove resolved issue stale-issue` has been created

---

## ADDED: Requirement: issues-store-archival

`IssuesStore` MUST gain two new methods:

```
archive(slug: string): Promise<void>
remove(slug: string): Promise<void>
```

`archive` MUST read `spec/issues/<slug>.md`, create `spec/issues/resolved/` if absent,
and write the identical content to `spec/issues/resolved/<slug>.md`. `archive` MUST
call `exists(slug)` first and MUST throw an error with a descriptive message if the
slug is not found in `spec/issues/`. `archive` MUST be idempotent: if
`spec/issues/resolved/<slug>.md` already exists the method MUST overwrite it without
error.

`remove` MUST delete `spec/issues/<slug>.md`. `remove` MUST succeed only when the file
exists at the issues path; it MUST throw if the file is absent (e.g., already removed).
Callers are expected to call `archive` before `remove`; `remove` does not verify the
presence of the resolved copy.

### Scenario: archive moves content to resolved directory

- GIVEN `spec/issues/some-issue.md` exists with content `# Some Issue\n`
- WHEN `issuesStore.archive('some-issue')` is called
- THEN `spec/issues/resolved/some-issue.md` exists and its content equals
  `# Some Issue\n`, and `spec/issues/some-issue.md` is unchanged

### Scenario: archive on missing slug throws

- GIVEN no file exists at `spec/issues/missing-slug.md`
- WHEN `issuesStore.archive('missing-slug')` is called
- THEN the method throws an error and `spec/issues/resolved/missing-slug.md` is not
  created

### Scenario: archive is idempotent when resolved copy already exists

- GIVEN `spec/issues/dup-issue.md` exists and `spec/issues/resolved/dup-issue.md`
  already exists from a prior call
- WHEN `issuesStore.archive('dup-issue')` is called again
- THEN the method resolves without error and `spec/issues/resolved/dup-issue.md`
  contains the current content of `spec/issues/dup-issue.md`

### Scenario: remove deletes the open issue file

- GIVEN `spec/issues/done-issue.md` exists
- WHEN `issuesStore.remove('done-issue')` is called
- THEN `spec/issues/done-issue.md` no longer exists

---

## ADDED: Requirement: skill-template

A skill template MUST exist at
`src/templates/skills/metta-fix-issues/SKILL.md` with YAML frontmatter field
`name: metta:fix-issues`. At build/deploy time, or via `metta install`, this file MUST
be copied byte-identical to `.claude/skills/metta-fix-issues/SKILL.md`.

The skill body MUST reference all four CLI invocation modes of `metta fix-issue`:

1. No-argument mode (interactive selection via `/metta-fix-issues`)
2. Single-issue pipeline (`metta fix-issue <slug>`)
3. Batch mode (`metta fix-issue --all [--severity <level>]`)
4. Removal (`metta fix-issue --remove-issue <slug>`)

The skill body MUST describe a propose-through-ship pipeline (propose → plan → execute →
review → verify → finalize → merge → remove-issue) modeled on the `metta-fix-gap` skill.
After the merge step the skill MUST instruct the orchestrator to call
`metta fix-issue --remove-issue <slug>`. The propose description pattern MUST be
`"fix issue: <slug> — <title>"`.

### Scenario: template file exists with correct frontmatter name

- GIVEN the repository has been checked out
- WHEN `src/templates/skills/metta-fix-issues/SKILL.md` is read
- THEN the YAML frontmatter contains exactly `name: metta:fix-issues`

### Scenario: deployed skill is byte-identical to template

- GIVEN `metta install` (or the build copy step) has been run
- WHEN the bytes of `src/templates/skills/metta-fix-issues/SKILL.md` and
  `.claude/skills/metta-fix-issues/SKILL.md` are compared
- THEN the two files are byte-identical

### Scenario: skill body references all four CLI invocation modes

- GIVEN `src/templates/skills/metta-fix-issues/SKILL.md` is read
- WHEN the content is searched for CLI mode markers
- THEN the text contains references to `fix-issue <slug>`, `fix-issue --all`,
  `fix-issue --remove-issue`, and the no-argument interactive-selection mode

---

## ADDED: Requirement: cli-registration

`metta fix-issue` MUST be registered in `src/cli/index.ts` by calling a
`registerFixIssueCommand(program)` function imported from
`./commands/fix-issue.js`. The command MUST appear in the output of `metta --help`
with a description matching `Fix one or more issues` (or equivalent wording).

### Scenario: command appears in --help output

- GIVEN the CLI is built and runnable
- WHEN the user runs `metta --help`
- THEN stdout includes the string `fix-issue` with a short description

### Scenario: registerFixIssueCommand is called in index.ts

- GIVEN `src/cli/index.ts` is read
- WHEN the file content is searched for the registration call
- THEN it contains `registerFixIssueCommand(program)` (or equivalent) and the
  import resolves to `./commands/fix-issue.js`
