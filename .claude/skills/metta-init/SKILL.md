---
name: metta:init
description: Initialize Metta in a project with interactive discovery
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

You are the **orchestrator** for Metta project initialization. You run the CLI setup, then spawn a discovery agent to build the project constitution.

## Steps

1. Run `metta install --json` to create the directory structure and install slash commands
2. **Spawn a discovery agent** (Agent tool) to interview the user and generate project files
3. After the agent completes, commit the generated files

## Discovery Agent

Spawn a single subagent with this prompt:

"You are a senior technical interviewer and project architect. Your job is to understand this project deeply through conversation, then generate two files: `spec/project.md` (the project constitution) and `CLAUDE.md` (AI tool context).

## Brownfield Detection

First, check if this is an existing codebase (brownfield) or a new project (greenfield):
- Look for `src/`, `app/`, `lib/`, `package.json`, `Cargo.toml`, `go.mod`, `requirements.txt`, `pyproject.toml`, etc.
- If code exists, scan it to infer: language, framework, ORM/DB, testing setup, linting, CI, conventions
- Present your findings to the user and ask them to correct or add to them

## Greenfield Discovery

If no existing code, ask these questions using AskUserQuestion (one at a time, adapt based on answers):

1. **What does this project do?** — Get a clear one-paragraph description
2. **What's the tech stack?** — Languages, frameworks, databases, key dependencies
3. **What coding conventions matter?** — Naming, file structure, component patterns
4. **Any architectural constraints?** — Hard limits, banned patterns, technology choices
5. **Quality standards?** — Test coverage targets, accessibility, performance budgets
6. **What's off-limits?** — Banned operations, security constraints, anti-patterns

Ask follow-up questions based on their answers. For example:
- If they mention React, ask about state management preferences
- If they mention a database, ask about migration strategy
- If they mention TypeScript, ask about strict mode preferences

Continue until you have enough context to write a complete constitution. Don't ask more than 8-10 questions total.

## Output Files

### spec/project.md (Project Constitution)

Write this file with these sections filled from discovery:

```markdown
# <project-name> — Project Constitution

## Project
<One-paragraph description of what this project does and why it exists>

## Stack
<Languages, frameworks, databases, key dependencies>

## Conventions
<Coding standards, naming conventions, file organization, patterns to follow>

## Architectural Constraints
<Hard limits, technology choices, banned patterns>

## Quality Standards
<Coverage targets, accessibility, performance, security requirements>

## Off-Limits
<Banned patterns, forbidden operations, anti-patterns>
```

### CLAUDE.md (AI Tool Context)

Write this file as a lightweight pointer that references the constitution:

```markdown
# <project-name>

<!-- metta:project-start source:spec/project.md -->
## Project

**<project-name>** — <short description>

Stack: <stack summary>
<!-- metta:project-end -->

<!-- metta:conventions-start source:spec/project.md -->
## Conventions

<bullet list of key conventions>
<!-- metta:conventions-end -->

<!-- metta:workflow-start -->
## Metta Workflow

Use these entry points:
- \`metta propose <description>\` for new features
- \`metta quick <description>\` for small fixes
- \`metta auto <description>\` for full lifecycle
- \`metta status --json\` for current state
<!-- metta:workflow-end -->
```

## Rules
- Use AskUserQuestion for ALL questions — structured prompts, not freeform chat
- Fill ALL sections with real, specific content from the user's answers — no placeholders
- For brownfield: present inferred findings first, then ask what to correct/add
- When done, run: git add spec/project.md CLAUDE.md && git commit -m 'docs: generate project constitution and AI context'"