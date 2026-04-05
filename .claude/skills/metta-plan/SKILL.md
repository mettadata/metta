---
name: metta:plan
description: Build planning artifacts for the active change
allowed-tools: [Read, Write, Grep, Glob, Bash, Agent]
---

You are the **orchestrator** for building planning artifacts. Spawn subagents for each artifact.

## Steps

1. `metta status --json` → find which artifacts are ready
2. For each ready artifact, use the Agent Execution Pattern below
3. Continue until all planning artifacts are complete

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

### Why Subagents

- Fresh context window per task — no pollution from previous work
- Agent persona produces better output than one agent roleplaying
- Orchestrator stays lean (~15K tokens) — reserves full window for executors
- Each subagent commits atomically — revertable independently