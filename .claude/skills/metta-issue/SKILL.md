---
name: metta:issue
description: Log an issue with root-cause analysis
allowed-tools: [Bash, AskUserQuestion, Read, Grep, Glob]
context: fork
agent: metta-skill-host
---

Log an issue to `spec/issues/` via the metta CLI, running a short root-cause analysis (RCA) session first so the issue carries evidence and candidate solutions.

## Steps

1. **Parse arguments.** Inspect the skill invocation. Extract a `--quick` flag if present and strip it from the input. Set `TITLE` to the remaining text (may be empty).

2. **Collect description.** If `TITLE` is empty, use `AskUserQuestion` with a single free-form question "What is the issue?"; set `TITLE` to the response.

3. **Collect severity.** Use `AskUserQuestion` with options `critical | major | minor` (default `minor`). Only ask if severity is not already supplied.

4. **`--quick` short-circuit.** If `--quick` was set in step 1, set `BODY="$TITLE"` and jump to step 7. Do NOT use `Read`, `Grep`, `Glob`, or `Bash` file/git inspection in this branch.

5. **RCA session** (default path). Investigate the symptom to build a structured analysis:
   - Use `Grep` and `Glob` to locate source files most relevant to the symptom.
   - Use `Read` on the 2–5 most relevant files.
   - Use `Bash` with `git log -20 --oneline -- <path>` for each relevant file to see recent history.
   - Trace the call path from the entry point to the failure site.
   - Compose `BODY` using this exact schema (stop when Evidence is solid — no hard file-read cap, but be efficient):
     ```
     ## Symptom
     <one paragraph describing the observed behavior>

     ## Root Cause Analysis
     <narrative explaining the probable cause>

     ### Evidence
     - `path/to/file.ts:LINE` — <one sentence explaining why this supports the RCA>

     ## Candidate Solutions
     1. **<Option>** — <one paragraph describing the approach>. Tradeoff: <drawback, risk, or cost>.
     ```
   - Constraints: section order is fixed (`## Symptom` → `## Root Cause Analysis` → `### Evidence` → `## Candidate Solutions`); between 1 and 3 Evidence items; between 1 and 3 Candidate Solutions; each solution MUST include a `Tradeoff:` clause.

6. **RCA-failure fallback.** If any tool call in step 5 fails, or if the evidence is insufficient to write a credible RCA, set `BODY` to this form instead:
   ```
   > RCA skipped: <one-sentence reason>

   <TITLE>
   ```
   No `## Root Cause Analysis` or `## Candidate Solutions` sections appear in this form. Issue capture MUST proceed.

7. **Write ticket.** Run:
   ```
   printf '%s' "$BODY" | METTA_SKILL=1 metta issue "$TITLE" --severity <level>
   ```
   The CLI auto-detects the piped stdin and uses `$BODY` as the issue body. The `$TITLE` argument becomes the issue title. After the CLI returns, echo the slug and path to the user (the CLI prints `Issue logged: <slug> (<severity>)` on success).

## Rules

- Never forward `--quick` to the CLI — it is a skill-side flag only. Filter it out before calling `metta issue`.
- Severity MUST be one of `critical`, `major`, `minor`. Do not invent other values.
- Always fall back via step 6 if RCA fails — never leave an issue unlogged.
- Never rewrite or read back `spec/issues/*.md` from this skill; the CLI owns that file.
- MUST NOT read files matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, or any file under a directory literally named `secrets/` during RCA. If the symptom appears to require such a file, state so in the `## Root Cause Analysis` section by name without citing contents.
