---
name: metta:plan
description: Build planning artifacts for the active change
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer (intent/spec), metta-researcher (research), metta-architect (design), metta-planner (tasks), metta-executor (implementation), metta-verifier (verification), metta-discovery (init). Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for building planning artifacts. Spawn subagents for each artifact.

## Steps

1. `metta status --json` → find which artifacts are ready
2. For each ready artifact:
   a. `metta instructions <artifact> --json --change <name>` → get template + persona
   b. **Spawn a subagent** with the right metta agent type based on the artifact (research→metta-researcher, design→metta-architect, tasks→metta-planner), the agent persona, template, and output_path
   c. Subagent writes the artifact file with real content, then git commits
   d. `metta complete <artifact> --json --change <name>` → returns next artifact
3. Continue until all planning artifacts are complete
4. **Run constitution check:**
   After all planning artifacts are committed, run `metta check-constitution --change <name> --json` via Bash.
   - On exit 0: report "Constitution check passed" with the violations_path. Proceed to implementation.
   - On exit 4: read the JSON output's `violations` array. For each blocking violation (severity critical, OR major without justification), surface it to the user with the violations_path. Tell the user to either:
     (a) edit spec.md to eliminate the violation, or
     (b) for major severity only, add a `## Complexity Tracking` section (or append to existing) with a bullet `- <article>: <rationale>` justifying it. Critical violations are never justifiable — they must be removed.
   - Do NOT advance to implementation on exit 4. Halt and await user action.
   - On re-entry to this skill after user edits, the check re-runs automatically.

## Subagent Prompt

"You are: {agent.persona}

Write the file {output_path} following this template:
{template}

Read existing artifacts from spec/changes/<change>/ for context.

Rules:
- Fill in ALL sections with real, specific content — no placeholders
- When done, run: git add {output_path} && git commit -m 'docs(<change>): create <artifact>'
- Research: explore 2-4 approaches, recommend one, explain tradeoffs
- Design: reference spec requirements and research decisions
- Tasks: use checklist format with `- [ ] **Task 1.1: name**` followed by indented Files, Action, Verify, Done fields. Group into Batch sections."
