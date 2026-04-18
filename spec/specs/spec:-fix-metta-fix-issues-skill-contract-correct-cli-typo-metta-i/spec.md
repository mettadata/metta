# spec:-fix-metta-fix-issues-skill-contract-correct-cli-typo-metta-i

## Requirement: fix-issues-skill-uses-plural-issues-show

Fulfills: US-1
`src/templates/skills/metta-fix-issues/SKILL.md` MUST invoke `metta issues show <slug> --json` (plural noun form) at the validate step. The singular form `metta issue show` MUST NOT appear in any metta skill template under `src/templates/skills/` or the deployed mirror under `.claude/skills/`. The deployed mirror `.claude/skills/metta-fix-issues/SKILL.md` MUST remain byte-identical to the source template after the fix is applied.

### Scenario: validate step runs without error
- GIVEN an orchestrator invokes `/metta-fix-issues <slug>`
- WHEN it reads the validate step in `src/templates/skills/metta-fix-issues/SKILL.md`
- THEN the command shown is `metta issues show <slug> --json` (plural), and executing it returns the issue JSON payload with exit code 0

### Scenario: grep for singular form returns zero matches
- GIVEN the fix has been applied to the skill template and its deployed mirror
- WHEN a maintainer greps for `metta issue show` across `src/templates/skills/` and `.claude/skills/`
- THEN zero matches are returned


## Requirement: skills-describe-orchestrator-owned-commits

Fulfills: US-2, US-4
The five skill files that today carry a `MUST ... git commit` rule for subagents — `metta-fix-issues`, `metta-fix-gap`, `metta-auto`, `metta-next`, `metta-quick` — MUST contain the following commit-ownership paragraph verbatim: "The orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation." The old blanket rule "Every subagent MUST write files to disk and git commit — no exceptions" and the variant "Every subagent MUST write files to disk and git commit" and the fused rule "MUST write files, git commit, and call `metta complete` for each artifact" and the shorthand "MUST git commit after each step" MUST all be removed from every skill template and their deployed mirrors under `.claude/skills/`. The commit-ownership paragraph MUST be byte-identical across all five source files and their five deployed mirrors. `metta-propose` is exempt — it has no existing subagent-commit rule and therefore does not need the paragraph added.

### Scenario: grep for old rule returns zero matches
- GIVEN the six skill files have been updated and their deployed mirrors synced
- WHEN a maintainer greps for `Every subagent MUST write files to disk and git commit` across `src/templates/skills/` and `.claude/skills/`
- THEN zero matches are returned

### Scenario: all five files contain the new paragraph
- GIVEN the five updated skill files are read
- WHEN the commit-ownership section is inspected in each file
- THEN all five contain exactly the sentence "The orchestrator commits planning, review, and verification artifacts after each subagent returns. The executor subagent commits atomically per task during implementation."

### Scenario: pairwise diff of the paragraph across files is empty
- GIVEN the commit-ownership paragraph is extracted from each of the five source skill files
- WHEN the paragraphs are diffed pairwise
- THEN all diffs are empty, confirming byte-identical prose across all five files


## Requirement: metta-product-agent-has-bash-tool

Fulfills: US-3
`src/templates/agents/metta-product.md` frontmatter `tools:` array MUST include `Bash` alongside `Read` and `Write`. The deployed mirror `.claude/agents/metta-product.md` MUST remain byte-identical to the source template after the addition.

### Scenario: frontmatter parse shows Bash in tools list
- GIVEN `src/templates/agents/metta-product.md` has been updated
- WHEN the frontmatter `tools:` array is parsed
- THEN `Bash` is present alongside `Read` and `Write`

### Scenario: deployed mirror byte-identity check passes
- GIVEN the source template has been updated to include `Bash` in `tools:`
- WHEN `.claude/agents/metta-product.md` is compared byte-for-byte with `src/templates/agents/metta-product.md`
- THEN the two files are identical with no differences


## Requirement: deployed-skill-mirrors-stay-byte-identical

Fulfills: US-4
After editing the five source skill templates, all `.claude/skills/<name>/SKILL.md` deployed copies MUST remain byte-identical to their `src/templates/skills/<name>/SKILL.md` sources. Existing byte-identity tests in `tests/` that verify this invariant MUST pass unmodified — no test logic changes are permitted as part of this change.

### Scenario: diff between source templates and deployed mirrors returns empty
- GIVEN all six source skill templates have been updated and their deployed mirrors synced
- WHEN `diff -r src/templates/skills .claude/skills` is executed
- THEN the command exits with code 0 and produces no output

### Scenario: existing byte-identity tests remain green
- GIVEN the existing Vitest byte-identity tests (identified by grepping for `byte-identity` in `tests/`) are run against the updated files
- WHEN the test suite executes
- THEN all byte-identity assertions pass without any changes to test logic or test data
