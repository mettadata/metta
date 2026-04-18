# Summary: remove-git-commit-prose-planning-agent-bodies-forbid

## Problem

Two drifts after Group C landed:
1. All 7 planning-agent bodies still told the agent to `git add` + `git commit`, contradicting the Group C skill rule that orchestrator owns planning/review/verification commits.
2. `metta-executor.md` told the agent to flip `- [ ]` → `- [x]` markers in tasks.md, but planner writes `### Task N.N:` headings without checkboxes — executors improvised inconsistently.

## Solution

Docs-only sweep, 16 files touched (8 source + 8 mirrors):

- **7 planning-agent bodies** (proposer, product, architect, planner, researcher, reviewer, verifier) — replaced commit-line with: `"When done, write the file to disk and return. The orchestrator commits after you return — do not run git."`
- **metta-executor.md** — replaced checkbox-flip line with explicit prohibition: `"MUST NOT modify spec/changes/<change>/tasks.md. metta complete implementation is the sole completion signal."` Kept per-task atomic code-commit authority.
- **All 8 `.claude/agents/` mirrors** — byte-identical sync.

## Files touched

- `src/templates/agents/metta-{proposer,product,architect,planner,researcher,reviewer,verifier,executor}.md`
- `.claude/agents/metta-{proposer,product,architect,planner,researcher,reviewer,verifier,executor}.md`

## Resolves

- `metta-product-agent-body-still-instructs-git-commit-contradi` (minor)
- `tasks-md-completion-marking-convention-is-undefined-metta-pl` (minor)

## Cross-cutting verification

- `grep -En 'git add|git commit' src/templates/agents/metta-{proposer,product,architect,planner,researcher,reviewer,verifier}.md` → 0 matches
- `grep -rn 'flip.*\[x\]' src/templates/agents/` → 0 matches
- `diff -r src/templates/agents .claude/agents` → empty
- `npx vitest run tests/agents-byte-identity.test.ts` → 2/2 pass
