# Tasks: remove-git-commit-prose-planning-agent-bodies-forbid

## Batch 1: Agent body edits (parallel — all different files)

### Task 1.1: Strip git-commit prose from 5 simple planning-agent bodies
- **Files:** `src/templates/agents/metta-proposer.md`, `src/templates/agents/metta-architect.md`, `src/templates/agents/metta-planner.md`, `src/templates/agents/metta-researcher.md`, `src/templates/agents/metta-verifier.md`, plus the 5 corresponding `.claude/agents/*.md` mirrors.
- **Action:** In each of the 5 source files, replace the single line matching `- When done, git add the file and commit:` (or for verifier, `- Write results to summary.md and commit:`) with:
  ```
  - When done, write the file to disk and return. The orchestrator commits after you return — do not run git.
  ```
  Then `cp` each edited source file to its `.claude/agents/` mirror.
- **Verify:** `grep -En 'git add|git commit' src/templates/agents/metta-{proposer,architect,planner,researcher,verifier}.md` returns 0 matches. `diff -r src/templates/agents .claude/agents` (scoped to these 5 pairs) empty.
- **Done:** 10 files updated (5 source + 5 mirror), byte-identical within each pair.

### Task 1.2: Strip git-commit prose from metta-product and metta-reviewer (different template shapes)
- **Files:** `src/templates/agents/metta-product.md`, `src/templates/agents/metta-reviewer.md`, + 2 `.claude/` mirrors.
- **Action:** In `metta-product.md` replace the line `- Commit with: \`git add spec/changes/<change>/stories.md && git commit -m "docs(<change>): add user stories"\`` with the same replacement line as Task 1.1. In `metta-reviewer.md` replace `- When done: \`git add spec/changes/<change>/review.md && git commit -m "docs(<change>): code review"\`` with the same replacement line. Mirror to `.claude/`.
- **Verify:** `grep -En 'git add|git commit' src/templates/agents/metta-product.md src/templates/agents/metta-reviewer.md` returns 0. Mirrors byte-identical.
- **Done:** 4 files updated (2 source + 2 mirror).

### Task 1.3: Update metta-executor to forbid tasks.md modification
- **Files:** `src/templates/agents/metta-executor.md`, `.claude/agents/metta-executor.md`
- **Action:** In `src/templates/agents/metta-executor.md`, replace line 26 (the `- As part of each task's commit, flip that task's \`- [ ]\` to \`- [x]\`...` line) with:
  ```
  - MUST NOT modify `spec/changes/<change>/tasks.md`. Task completion is signaled by the orchestrator's `metta complete implementation` call, not by marker edits. If you have a status update, include it in your final reply to the orchestrator.
  ```
  Do NOT remove the executor's other per-task commit instructions — they still commit code atomically. Mirror to `.claude/`.
- **Verify:** `grep -En 'flip.*\[x\]|- \[ \]' src/templates/agents/metta-executor.md` returns 0. `grep 'MUST NOT modify' src/templates/agents/metta-executor.md` returns 1. Mirror byte-identical.
- **Done:** 2 files updated (source + mirror), executor can no longer touch tasks.md.

---

## Batch 2: Full gate suite (sequential — depends on Batch 1)

### Task 2.1: Write summary.md and run full gate suite
- **Files:** `spec/changes/remove-git-commit-prose-planning-agent-bodies-forbid/summary.md`
- **Action:** Summarize (problem, solution, 16 files touched, no code changes). Run `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`.
- **Verify:** All gates exit 0. Cross-cutting: (a) `grep -rn 'git add\|git commit' src/templates/agents/metta-{proposer,product,architect,planner,researcher,reviewer,verifier}.md` returns 0, (b) `grep -rn 'flip.*\[x\]' src/templates/agents/` returns 0, (c) `diff -r src/templates/agents .claude/agents` empty.
- **Done:** summary written; gates green; cross-cutting greps pass.
