# fix-metta-next-gap-detect-unme

## MODIFIED: Requirement: next-command-advances-post-finalize

The `metta next` command MUST advance the workflow past finalize. When `spec/changes/` contains no active changes and the current git branch is a metta change branch (matches `metta/<name>`) with commits ahead of the default branch (`main`), the command MUST return a ship action instead of prompting the user to propose a new change. The `--json` output MUST emit `{next: "ship", command: "metta ship", change: "<name>", branch: "metta/<name>"}` and exit 0. The human-readable output MUST say `Ready to ship: <change>` and `Next: metta ship`.

### Scenario: next after finalize on a metta branch
- GIVEN a repository with no active changes under `spec/changes/`, HEAD on branch `metta/example-change`, and commits ahead of `main`
- WHEN the user runs `metta next --json`
- THEN the JSON response has `next: "ship"`, `command: "metta ship"`, `change: "example-change"`, `branch: "metta/example-change"`, and the process exits 0

### Scenario: next on main with no active changes
- GIVEN a repository with no active changes and HEAD on branch `main`
- WHEN the user runs `metta next --json`
- THEN the JSON response has `next: "propose"` as today, unchanged

### Scenario: next on a metta branch with no unmerged commits
- GIVEN a repository with no active changes, HEAD on `metta/already-merged`, and zero commits ahead of `main`
- WHEN the user runs `metta next --json`
- THEN the JSON response has `next: "propose"` (nothing to ship)

### Scenario: next when main branch is missing
- GIVEN a repository with no active changes, HEAD on `metta/orphan`, and no `main` branch in the repo
- WHEN the user runs `metta next --json`
- THEN the command does not error, the JSON response falls back to `next: "propose"`, and no shell command is invoked that fails

## ADDED: Requirement: next-skill-runs-ship

The `/metta-next` Claude Code skill MUST treat a `next: "ship"` response from `metta next --json` the same way it treats `next: "finalize"` today — by invoking the ship step (either `/metta-ship` or `metta ship` depending on how the skill routes terminal actions). The skill body MUST NOT require additional user confirmation beyond the existing destructive-action prompt pattern.

### Scenario: skill advances from ship response
- GIVEN the `/metta-next` skill has just received a JSON response with `next: "ship"`
- WHEN the skill body executes the routing logic
- THEN the skill invokes the ship action and does not fall through to the "no active changes" branch or the propose prompt
