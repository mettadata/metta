---
name: metta:init
description: Initialize Metta in a project with interactive discovery
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer, metta-researcher, metta-architect, metta-planner, metta-executor, metta-reviewer, metta-verifier, metta-discovery. Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for Metta project initialization.

## Steps

1. `metta init --json` → scaffolds directories, installs skills, returns discovery instructions
2. Parse the `discovery` object from the JSON response
3. **Spawn a metta-discovery agent** (subagent_type: "metta-discovery") with:
   - The agent persona from `discovery.agent.persona`
   - The mode (`discovery.mode`: brownfield or greenfield)
   - The detected stack/dirs from `discovery.detected` (brownfield only)
   - The questions from `discovery.questions`
   - The output paths from `discovery.output_paths`
   - The templates from `discovery.constitution_template` and `discovery.context_template`
   - Also update `discovery.output_paths.config` with the project name, description, and stack from the user's answers
   - Clear task: "Ask the questions using AskUserQuestion. For brownfield, scan the codebase first and present findings before asking. Fill the templates with real answers. Write the output files. Then git add + commit."

The .metta/config.yaml MUST use this exact schema (nested under project:):
```yaml
project:
  name: "<project name>"
  description: "<description>"
  stack: "<comma-separated stack>"
```
Do NOT write flat keys like `name:`, `description:`, `stack:` at the root level.

4. Report to user what was generated
