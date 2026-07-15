# metta-issue-metta-backlog-slas

## Requirement: issue-slash-command

A  skill MUST exist at  and MUST be copied to  by the install pipeline. The skill MUST accept optional  and  arguments, prompt for any missing values via , and execute . The skill MUST report the path of the created issue file and exit. The skill frontmatter MUST declare .

### Scenario: issue skill template exists and invokes the right CLI
- GIVEN the repository at head
- WHEN a reader inspects
- THEN the file exists, its frontmatter declares , and the body references the  CLI command with the  flag

### Scenario: issue skill is deployed by install
- GIVEN a fresh project where  has just been run
- WHEN a reader inspects  in that project
- THEN the file is byte-identical to the template in


## Requirement: backlog-slash-command

A  skill MUST exist at  and MUST be copied to  by the install pipeline. The skill MUST support selection of the four subcommands , , , and . For , the skill MUST collect title, optional priority ( /  / ), and description via . For , the skill MUST first run  to surface available slugs, let the user pick one, then run . The skill frontmatter MUST declare .

### Scenario: backlog skill template exists and covers all subcommands
- GIVEN the repository at head
- WHEN a reader inspects
- THEN the file exists, its frontmatter declares , and the body documents each of , , , and  with the  CLI invocation

### Scenario: backlog skill is deployed by install
- GIVEN a fresh project where  has just been run
- WHEN a reader inspects  in that project
- THEN the file is byte-identical to the template in
