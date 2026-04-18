# spec-metta-backlog-description-flag-whitelist-spec-issues

## Requirement: backlog-add-accepts-description-flag

Fulfills: US-1
`metta backlog add <title>` MUST accept an optional `--description <text>` flag. When present, the flag's value MUST be passed as the `description` argument to `BacklogStore.add()`. When absent, the description MUST default to the title (backward compatible). The stored backlog file's body MUST contain the provided description.

### Scenario: --description populates the body
- GIVEN a clean metta project
- WHEN `metta backlog add "Dark mode" --description "Toggle in settings panel"` is executed
- THEN `spec/backlog/dark-mode.md` is created with its body containing `Toggle in settings panel`

### Scenario: flag absent — backward-compatible behavior
- GIVEN no `--description` is supplied
- WHEN `metta backlog add "Dark mode"` runs
- THEN the resulting file's description equals the title `Dark mode`


## Requirement: guard-hook-whitelists-issue-and-backlog-dirs

Fulfills: US-2
`src/templates/hooks/metta-guard-edit.mjs` ALLOW_LIST MUST permit Edit/Write operations under `spec/issues/` and `spec/backlog/` even when no active metta change exists. The existing `spec/project.md` and `.metta/config.yaml` allow-list entries MUST remain. Writes to paths outside this allow-list continue to be blocked as before.

### Scenario: issue file Edit allowed without active change
- GIVEN no active metta change and no allow-listed exact path match
- WHEN a tool call targets `spec/issues/some-slug.md` via Edit/Write/MultiEdit/NotebookEdit
- THEN `metta-guard-edit.mjs` exits 0

### Scenario: backlog file Edit allowed without active change
- GIVEN no active metta change
- WHEN a tool call targets `spec/backlog/some-slug.md`
- THEN `metta-guard-edit.mjs` exits 0

### Scenario: non-whitelisted path still blocked
- GIVEN no active metta change
- WHEN a tool call targets `src/cli/commands/foo.ts`
- THEN `metta-guard-edit.mjs` exits 2 (blocks the write)


## Requirement: metta-backlog-skill-uses-description-flag

Fulfills: US-3
`src/templates/skills/metta-backlog/SKILL.md` MUST document and use the `--description` flag in its `metta backlog add` invocation. The skill MUST NOT instruct the orchestrator to Edit `spec/backlog/<slug>.md` after create. The deployed mirror at `.claude/skills/metta-backlog/SKILL.md` MUST remain byte-identical.

### Scenario: skill template references --description
- GIVEN the skill template file
- WHEN grepped for `--description`
- THEN the flag usage appears in the add instruction

### Scenario: post-add Edit workaround removed
- GIVEN the skill template file
- WHEN grepped for instructions to Edit `spec/backlog/`
- THEN zero matches are returned

### Scenario: deployed mirror byte-identical
- GIVEN the edited source template
- WHEN diffed against `.claude/skills/metta-backlog/SKILL.md`
- THEN the diff is empty
