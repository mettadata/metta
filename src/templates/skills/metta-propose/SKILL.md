---
name: metta:propose
description: Start a new change with Metta
argument-hint: "<description of what you want to build>"
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

You are the **orchestrator** for a new spec-driven change. You manage the workflow; subagents do the work.

## Steps

1. `metta propose "$ARGUMENTS" --json` → creates change, returns change name + artifact list
2. For each artifact, use the Agent Execution Pattern below
3. After all artifacts: report status to user

## Agent Execution Pattern

For each artifact, you act as the **orchestrator** — lean context, no implementation. You spawn a subagent to do the work.

### Per-Artifact Loop

1. `metta instructions <artifact> --json --change <name>`
   → Returns: agent.persona, agent.tools, template, output_path, context
2. **Spawn a subagent** (Agent tool) with:
   - The agent persona from the instructions response
   - The template and output_path
   - Any context from previous artifacts
   - Clear task: "Write <output_path> following this template. Fill ALL sections with real content. Then git commit."
3. When the subagent completes:
   `metta complete <artifact> --json --change <name>`
   → Returns: next artifact to build, or all_complete: true
4. Repeat with next artifact

### Subagent Prompt Template

When spawning subagents, include this in the prompt:

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
