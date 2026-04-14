# executor-agent-must-check-off

## Problem
When the metta-executor agent completes tasks, it does not update the corresponding `- [ ]` checkboxes in `spec/changes/<change>/tasks.md` to `- [x]`. Observed firsthand in the just-shipped `metta-issue-metta-backlog-slas` change — all 10 tasks stayed unchecked through implementation, verification, finalize, and merge. The only record of what's done is the git log. Reviewers, orchestrators, and future readers of the archived change have no at-a-glance progress view.

Root cause: `.claude/agents/metta-executor.md` and `src/templates/agents/metta-executor.md` do not instruct the agent to edit tasks.md after each task. It's simply not in the spec of the role.

## Proposal
Add a single explicit rule to the metta-executor agent prompt in both locations (template + deployed copy):

> After committing each completed task, edit `spec/changes/<change>/tasks.md` to change the matching task's `- [ ]` checkbox to `- [x]`. Amend the same commit (`git commit --amend --no-edit`) or stage the edit into the task's commit — do not create a separate "mark complete" commit. If the tasks.md file is missing or the task can't be located, log it as a deviation and continue.

Both files must be byte-identical. Next `metta install` will propagate the updated template to downstream projects; this repo's own `.claude/` copy gets updated in the same commit.

## Impact
- Executor agent behavior changes on next invocation.
- No CLI code changes, no new tests required beyond byte-identity of the two agent files.
- No schema changes.
- Downstream projects pick up the new prompt on their next `metta install` or on a manual refresh. No migration for in-flight changes — those executors already ran with the old prompt.

## Out of Scope
- Adding a CLI helper (`metta task complete <id>`) — chose lighter-touch option per user selection.
- Retroactively checking off tasks in archived changes.
- Any change to the tasks.md format or Task ID convention.
- Teaching other agents (planner, verifier) to touch tasks.md.
- Progress dashboards that derive completion percentage from tasks.md.
