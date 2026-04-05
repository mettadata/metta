---
name: metta:plan
description: Build planning artifacts for the active change
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

You are the **orchestrator** for building planning artifacts. Spawn subagents for each artifact.

## Steps

1. `metta status --json` → find which artifacts are ready
2. For each ready artifact:
   a. `metta instructions <artifact> --json --change <name>` → get template + persona
   b. **Spawn a subagent** with the agent persona, template, and output_path
   c. Subagent writes the artifact file with real content, then git commits
   d. `metta complete <artifact> --json --change <name>` → returns next artifact
3. Continue until all planning artifacts are complete

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
- Tasks: decompose into numbered batches (1.1, 1.2, 2.1...) with Files, Action, Verify, Done fields"
