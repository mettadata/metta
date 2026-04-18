# remove-git-commit-prose-planning-agent-bodies-forbid

## Problem

Two framework-consistency drifts after Group C landed:

1. **Agent bodies contradict skill prose** — Group C updated five skill templates to state: *"Planning-artifact subagents (proposer, researcher, architect, planner, product) write files only — they do not run git."* But every planning-agent body under `src/templates/agents/*.md` still tells the agent to `git add` + `git commit` its output. Tracked as `metta-product-agent-body-still-instructs-git-commit-contradi` (minor); same drift exists in proposer, researcher, architect, planner, reviewer, verifier.
2. **Undefined tasks.md marker convention** — `metta-executor.md` line 26 tells the agent to flip `- [ ]` → `- [x]` in tasks.md. But the planner writes `### Task N.N:` headings without checkboxes. Executors improvise: some append `[x]` to headings, some don't. Tracked as `tasks-md-completion-marking-convention-is-undefined-metta-pl` (minor).

## Proposal

Agent-body sweep (docs-only):

1. Remove or rephrase the `git add` / `git commit` lines in: `metta-proposer.md`, `metta-product.md`, `metta-architect.md`, `metta-planner.md`, `metta-researcher.md`, `metta-reviewer.md`, `metta-verifier.md`. Replace with: *"When done, write the file to disk and return. The orchestrator commits after you return — do not run git."*
2. In `metta-executor.md`:
   - Remove the checkbox-flip instruction entirely (line 26).
   - Add: *"MUST NOT modify `spec/changes/<change>/tasks.md`. Task completion is signaled by the orchestrator's `metta complete implementation` call, not by marker edits. If you have a status update, report it in your final message."*
   - Keep the per-task atomic-commit authority — executors still commit code changes per task.
3. Mirror every edit to `.claude/agents/` so deployed copies stay byte-identical.

`metta-discovery.md` stays unchanged — init has its own commit lifecycle distinct from the per-change commit-ownership rule.

## Impact

- 8 agent template files (7 planning + 1 executor) + their 8 `.claude/` mirrors = 16 files
- No code changes, no schema changes, no CLI changes
- Behavior change: planning subagents now legitimately do NOT commit. Existing orchestrators (skills) already expect to commit after the subagent returns, so no orchestration break.

## Out of Scope

- Changing the tasks.md file format (keep `###` headings)
- Any skill-template prose beyond what's already covered by Group C
- `metta-discovery.md` agent body
- CLI or runtime changes
