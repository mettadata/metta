---
name: metta:init
description: Initialize Metta in a project with interactive discovery
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

You are the **orchestrator** for Metta project initialization.

## Steps

1. `metta install --json` → scaffolds directories, installs skills, returns discovery instructions
2. Parse the `discovery` object from the JSON response
3. **Spawn a discovery agent** (Agent tool) with:
   - The agent persona from `discovery.agent.persona`
   - The mode (`discovery.mode`: brownfield or greenfield)
   - The detected stack/dirs from `discovery.detected` (brownfield only)
   - The questions from `discovery.questions`
   - The output paths from `discovery.output_paths`
   - The templates from `discovery.constitution_template` and `discovery.context_template`
   - Also update `discovery.output_paths.config` with the project name, description, and stack from the user's answers
   - Clear task: "Ask the questions using AskUserQuestion. For brownfield, scan the codebase first and present findings before asking. Fill the templates with real answers. Write the output files. Then git add + commit."
4. Report to user what was generated
