# Spec: remove-git-commit-prose-planning-agent-bodies-forbid

## ADDED: Requirement: planning-agent-bodies-have-no-git-commit-prose

**Fulfills:** US-1

The seven planning-agent template files — `src/templates/agents/metta-proposer.md`, `metta-product.md`, `metta-architect.md`, `metta-planner.md`, `metta-researcher.md`, `metta-reviewer.md`, `metta-verifier.md` — MUST NOT contain any instruction telling the agent to run `git add` or `git commit`. Commit responsibility belongs to the orchestrator per the Group C skill rule.

### Scenario: no git commands in planning-agent bodies

- GIVEN the seven planning-agent template files
- WHEN a maintainer runs `grep -En 'git add|git commit' src/templates/agents/metta-{proposer,product,architect,planner,researcher,reviewer,verifier}.md`
- THEN zero matches are returned

### Scenario: each body now instructs the agent to return without committing

- GIVEN each of the seven planning-agent bodies
- WHEN the instructions section is read
- THEN the file states that the orchestrator commits after the agent returns, not the agent itself

---

## ADDED: Requirement: executor-forbids-tasks-md-modification

**Fulfills:** US-2

`src/templates/agents/metta-executor.md` MUST contain an explicit prohibition against modifying `spec/changes/<change>/tasks.md`. It MUST NOT contain any instruction to flip `- [ ]` to `- [x]` or otherwise add completion markers. Task completion is signaled by the orchestrator's `metta complete implementation` call; executors keep their per-task atomic-commit authority for source code changes.

### Scenario: executor body forbids tasks.md edits

- GIVEN `src/templates/agents/metta-executor.md`
- WHEN the file is read
- THEN the file contains a line stating that executors MUST NOT modify `tasks.md`

### Scenario: executor body has no checkbox-flip instruction

- GIVEN `src/templates/agents/metta-executor.md`
- WHEN a grep for `flip.*\[x\]` or `- \[ \].*->.*\[x\]` is run on the file
- THEN zero matches are returned

---

## ADDED: Requirement: deployed-agent-mirrors-stay-byte-identical

**Fulfills:** US-3

After editing the eight source agent templates in `src/templates/agents/`, their deployed mirrors under `.claude/agents/` MUST remain byte-identical. The existing byte-identity test in `tests/agents-byte-identity.test.ts` MUST continue to pass without modification.

### Scenario: source vs deployed diff is empty

- GIVEN all agent-body edits have been applied to both source and deployed copies
- WHEN `diff -r src/templates/agents .claude/agents` is run
- THEN the command exits 0 with empty output

### Scenario: byte-identity test remains green

- GIVEN the updated agent files
- WHEN `npx vitest run tests/agents-byte-identity.test.ts` is run
- THEN all assertions pass
