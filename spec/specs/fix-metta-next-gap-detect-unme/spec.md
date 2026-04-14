# fix-metta-next-gap-detect-unme

## Requirement: next-skill-runs-ship

The  Claude Code skill MUST treat a  response from  the same way it treats  today — by invoking the ship step (either  or  depending on how the skill routes terminal actions). The skill body MUST NOT require additional user confirmation beyond the existing destructive-action prompt pattern.

### Scenario: skill advances from ship response
- GIVEN the  skill has just received a JSON response with
- WHEN the skill body executes the routing logic
- THEN the skill invokes the ship action and does not fall through to the "no active changes" branch or the propose prompt


## Requirement: next-command-advances-post-finalize

The  command MUST advance the workflow past finalize. When  contains no active changes and the current git branch is a metta change branch (matches ) with commits ahead of the default branch (), the command MUST return a ship action instead of prompting the user to propose a new change. The  output MUST emit  and exit 0. The human-readable output MUST say  and .

### Scenario: next after finalize on a metta branch
- GIVEN a repository with no active changes under , HEAD on branch , and commits ahead of
- WHEN the user runs
- THEN the JSON response has , , , , and the process exits 0

### Scenario: next on main with no active changes
- GIVEN a repository with no active changes and HEAD on branch
- WHEN the user runs
- THEN the JSON response has  as today, unchanged

### Scenario: next on a metta branch with no unmerged commits
- GIVEN a repository with no active changes, HEAD on , and zero commits ahead of
- WHEN the user runs
- THEN the JSON response has  (nothing to ship)

### Scenario: next when main branch is missing
- GIVEN a repository with no active changes, HEAD on , and no  branch in the repo
- WHEN the user runs
- THEN the command does not error, the JSON response falls back to , and no shell command is invoked that fails


## Requirement: next-skill-runs-ship

The  Claude Code skill MUST treat a  response from  the same way it treats  today — by invoking the ship step (either  or  depending on how the skill routes terminal actions). The skill body MUST NOT require additional user confirmation beyond the existing destructive-action prompt pattern.

### Scenario: skill advances from ship response
- GIVEN the  skill has just received a JSON response with
- WHEN the skill body executes the routing logic
- THEN the skill invokes the ship action and does not fall through to the "no active changes" branch or the propose prompt
