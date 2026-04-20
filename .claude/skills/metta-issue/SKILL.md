---
name: metta:issue
description: Log an issue
allowed-tools: [Bash, AskUserQuestion]
---

Log an issue to `spec/issues/` via the metta CLI.

## Steps

1. If `description` was not provided as a skill argument, use `AskUserQuestion` to collect it (single free-form question: "What is the issue?").
2. If `severity` was not provided, use `AskUserQuestion` with options `critical | major | minor` (default `minor`).
3. Run `METTA_SKILL=1 metta issue "<description>" --severity <level>` (shell-escape the description).
4. Echo the created slug and path to the user. The CLI prints `Issue logged: <slug> (<severity>)`; the file lives at `spec/issues/<slug>.md`.

## Rules

- Do not invent severity values beyond `critical`, `major`, `minor`.
- Never rewrite or read back `spec/issues/*.md` from this skill; the CLI owns that file.
