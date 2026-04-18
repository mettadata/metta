# Research: remove-git-commit-prose-planning-agent-bodies-forbid

## Decision: direct per-file edits

Docs-only change; all 8 files + 8 mirrors are already identified. No research branches.

## Exact edit locations (verified)

| File | Line | Current text |
|---|---|---|
| `src/templates/agents/metta-proposer.md` | 20 | `- When done, git add the file and commit: \`git commit -m "docs(<change>): create <artifact>"\`` |
| `src/templates/agents/metta-product.md` | 55 | `- Commit with: \`git add spec/changes/<change>/stories.md && git commit -m "docs(<change>): add user stories"\`` |
| `src/templates/agents/metta-architect.md` | 20 | `- When done, git add the file and commit: \`git commit -m "docs(<change>): create design"\`` |
| `src/templates/agents/metta-planner.md` | 20 | `- When done, git add the file and commit: \`git commit -m "docs(<change>): create tasks"\`` |
| `src/templates/agents/metta-researcher.md` | 20 | `- When done, git add the file and commit: \`git commit -m "docs(<change>): create research"\`` |
| `src/templates/agents/metta-reviewer.md` | 52 | `- When done: \`git add spec/changes/<change>/review.md && git commit -m "docs(<change>): code review"\`` |
| `src/templates/agents/metta-verifier.md` | 19 | `- Write results to summary.md and commit: \`git commit -m "docs(<change>): verification summary"\`` |
| `src/templates/agents/metta-executor.md` | 26 | `- As part of each task's commit, flip that task's \`- [ ]\` to \`- [x]\` in \`spec/changes/<change>/tasks.md\` and stage it with your code. Never a separate commit. If the task can't be located in tasks.md, log a deviation per the Deviation Rules above and continue.` |

## Replacement text

**For 7 planning-agent bodies** — replace the existing commit line with:
```
- When done, write the file to disk and return. The orchestrator commits after you return — do not run git.
```

Wording chosen to match the Group C skill rule verbatim (orchestrator-owned commits).

**For `metta-executor.md`** — replace the line 26 checkbox-flip instruction with:
```
- MUST NOT modify `spec/changes/<change>/tasks.md`. Task completion is signaled by the orchestrator's `metta complete implementation` call, not by marker edits. If you have a status update, include it in your final reply to the orchestrator.
```

Keep executor's other per-task commit authority intact (it still commits code atomically per task).

## Deployed mirrors

Confirmed via `diff -r src/templates/agents .claude/agents`: empty before edits. All 8 mirrors currently byte-identical to source. After each edit, `cp src/.../file.md .claude/.../file.md` to re-sync.

Enforcing test: `tests/agents-byte-identity.test.ts` — covers all nine agent file pairs.

## Out of scope (reaffirmed)

- `metta-discovery.md` — its commit instruction relates to `spec/project.md` + `.metta/config.yaml` during init, a different commit lifecycle per the metta-init skill. Untouched.
- Skill templates — already updated in Group C to declare the orchestrator-owned commits rule. No additional edits.

## Artifacts produced

None — all direct edits.
