---
name: metta:propose
description: Start a new change with Metta
argument-hint: "<description of what you want to build>"
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for a new spec-driven change. You manage the workflow; subagents do the work.

## Steps

1. `metta propose "$ARGUMENTS" --json` → creates change on branch `metta/<change-name>`
2. For each artifact, use the Agent Execution Pattern below
3. After **implementation** completes, **spawn 3 metta-reviewer agents in parallel** (fan-out — single message):
   - Agent 1 (subagent_type: "metta-reviewer"): "You are a **correctness reviewer**. Check logic errors, off-by-one, edge cases, spec compliance."
   - Agent 2 (subagent_type: "metta-reviewer"): "You are a **security reviewer**. Check OWASP top 10, XSS, injection, secrets."
   - Agent 3 (subagent_type: "metta-reviewer"): "You are a **quality reviewer**. Check dead code, naming, duplication, test gaps."
   - Merge results into `spec/changes/<change>/review.md` and commit.
   - If any critical issues: spawn metta-executor to fix, then re-review
4. For **verification**: spawn a **metta-verifier** (subagent_type: "metta-verifier") that:
   - Runs `npm test`, `npm run lint`, `npx tsc --noEmit`
   - Reads the spec and checks each Given/When/Then scenario has a passing test
   - If any gate fails: spawn a metta-executor to fix, then re-verify
   - Writes verification results to summary.md
5. When `all_complete: true`:
   a. `metta finalize --json --change <name>` → runs gates, archives, merges specs
   b. `git checkout main && git merge metta/<change-name> --no-ff -m "chore: merge <change-name>"`
5. Report to user what was done

## Critical: You MUST verify, finalize, and merge

- Do NOT skip verification — a metta-verifier agent MUST run gates and confirm spec compliance
- Do NOT stop after the last artifact — finalize + merge must happen
- If metta finalize fails gates, spawn a metta-executor to fix, then retry

## Agent Execution Pattern

For each artifact, you act as the **orchestrator** — lean context, no implementation. You spawn a subagent to do the work.

### Per-Artifact Loop

1. `metta instructions <artifact> --json --change <name>`
   → Returns: agent.persona, agent.tools, template, output_path, context
2. **Spawn a subagent** (Agent tool) with the right metta agent type based on the artifact (intent/spec→metta-proposer, research→metta-researcher, design→metta-architect, tasks→metta-planner, implementation→metta-executor, verification→metta-verifier):
   - The agent persona from the instructions response
   - The template and output_path
   - Any context from previous artifacts
   - Clear task: "Write <output_path> following this template. Fill ALL sections with real content. Then git commit."
3. When the subagent completes:
   `metta complete <artifact> --json --change <name>`
   → Returns: next artifact to build, or all_complete: true
4. Repeat with next artifact

### Subagent Prompt Template

When spawning subagents, include this in the prompt. Use subagent_type: "metta-proposer" for intent/spec artifacts.

"You are: {agent.persona}

Write the file {output_path} following this template:
{template}

Context from previous artifacts:
{read the files from spec/changes/<change>/}

Rules:
- Fill in ALL sections with real, specific content — no placeholders
- When done, run: git add {output_path} && git commit -m 'docs(<change>): create <artifact>'
- For implementation tasks, use conventional commits: feat(<change>): <description>
- For specs, use RFC 2119 keywords (MUST/SHOULD/MAY) and Given/When/Then scenarios"
