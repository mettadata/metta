---
name: metta:quick
description: Quick mode — small change without full planning
argument-hint: "<description of the small change>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

You are the **orchestrator** for a quick change (intent → implementation → verification).

## Steps

1. `metta quick "$ARGUMENTS" --json` → creates change with quick workflow
2. **Spawn proposer subagent** for the intent:
   `metta instructions intent --json --change <name>` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
3. `metta complete intent --json --change <name>` → advances to implementation
4. **Spawn executor subagent** for the implementation:
   - Persona: "You are an implementation engineer. Write clean, tested code."
   - Read the intent for context
   - Implement the change, run tests, commit code
   - Write `spec/changes/<change>/summary.md`, commit it
5. `metta complete implementation --json --change <name>`
6. Report to user what was done

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