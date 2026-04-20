# Research: RCA Skill Design for `/metta-issue` Upgrade

**Change:** upgrade-metta-issue-skill-run-short-debugging-session-before
**Date:** 2026-04-20
**Author:** metta-researcher

---

## Background and Grounding

The current `.claude/skills/metta-issue/SKILL.md` is 20 lines: collect description, collect severity, run `metta issue "<description>"`, echo the result. Allowed tools are `[Bash, AskUserQuestion]`. The spec requires this to become a debugging-first flow with structured H2 output piped via stdin to the CLI.

Three resolved issues illustrate the cost of shallow tickets today:

- `metta-complete-accepts-stub-placeholder-artifacts-on-intent-` — the fixer had to reconstruct what "no min-content check" meant from scratch; the ticket had no Evidence citations.
- `metta-ship-merged-a-branch-even-though-metta-finalize-failed` — one liner, zero call-path context.
- `metta-finalize-tests-gate-leaks-vitest-worker-processes-on` — this one was filed by an observer with deep context; it reads like a post-RCA ticket already (PPID, CPU figures, gate runner logic). That quality was accidental; nothing in the skill enforced it.

The `metta-researcher` agent persona confirms the project pattern: Read/Grep/Glob/Bash are standard investigative tools. A `metta-researcher` subagent already exists and carries those same tool grants plus WebSearch/WebFetch. The `metta-fix-issues` skill shows how a more elaborate skill can orchestrate subagents via the `Agent` tool.

---

## Approach 1: Inline RCA in the Skill

The skill itself (running in the orchestrator's context) performs RCA using Read, Grep, Glob, Bash. After investigation, it formats the structured markdown body in a local variable and pipes it to `metta issue "<title>"` via stdin.

No new agent definition required. No `Agent` tool call. The skill is purely linear instructions.

**Reliability of structured output**

High — the skill prompt is the only thing authoring the body. The orchestrator has the symptom description, the file reads, and the formatting instructions all in one context window. There is no handoff to parse. If the prompt specifies the exact H2 order and Evidence citation format clearly, the output schema is reliable without a post-validator in the happy path.

Failure mode: the orchestrator is also managing other work (e.g., running inside `metta-fix-issues`). Its context is already loaded. Competing instructions can dilute compliance with the schema. A well-isolated subagent context eliminates this risk.

**Token / latency cost (happy path)**

Low latency — no agent spawn overhead, no serialization round-trip. Token cost is paid once, in the existing session. File reads and git log output are consumed in-place. For a typical 3–5 file investigation with a 20-line git log, this is 2,000–6,000 tokens of investigation context, well within session limits.

**Fallback behavior**

The skill wraps RCA in a try-catch equivalent (explicit instruction: "if any tool call fails, skip to fallback"). The same code path that writes the body decides to write the fallback. No inter-agent communication needed. The fallback reason is immediately available from the failed tool result.

**Complexity of SKILL.md**

Medium — the skill grows from 20 lines to roughly 60–80 lines: one block for gather-description-and-severity, one block for the RCA session, one block for body assembly, one block for the CLI call, one block for fallback, one block for `--quick` short-circuit. It remains a single document with ordered steps. No separate agent file to maintain.

**Interaction with `AskUserQuestion`**

Clean. Steps 1–2 remain exactly as today (ask if no argument provided). RCA begins only after the description is confirmed. There is no context switch between the question and the investigation.

---

## Approach 2: Subagent-driven RCA

The skill spawns a dedicated `metta-issue-investigator` subagent (new agent definition) or reuses `metta-researcher`. The subagent receives the symptom description as its prompt, investigates, and returns a structured markdown body. The skill then pipes that body to `metta issue "<title>"`.

**Reliability of structured output**

Higher isolation, but the subagent must emit exactly the three H2 sections for the piping step to produce a valid ticket. If the subagent returns prose instead of markdown, the skill must detect and handle it. A post-validator in the skill (regex check for `## Symptom`) is straightforward but adds prose. The `metta-researcher` persona's rules say "write the file to disk and return" — that means the current researcher persona would write to a file path, not return the body inline, so the skill would need to read the file rather than receive the body directly.

Reusing `metta-researcher` as-is requires two extra steps: the skill must pass a unique output path, the subagent writes to it, and the skill reads it back. That is exactly the pattern used in `metta-fix-issues` for the Per-Artifact Loop (step 3) and Synthesize research (step 4). It works, but adds indirection.

Alternatively, a new `metta-issue-investigator` agent with `stdout`-style return could be defined, but nothing in the current project uses that pattern — agents consistently write files and return.

**Token / latency cost (happy path)**

Higher latency — agent spawn adds one round-trip. The subagent context is fresh (good for isolation) but the investigation context (symptom + files) must be reconstructed inside the subagent from scratch. Total tokens are similar; wall-clock time is noticeably higher for an operation the user is watching interactively.

**Fallback behavior**

More complex. The skill must detect subagent failure (non-zero return, missing output file, malformed body). The fallback reason may be opaque — "subagent returned nothing" is harder to surface than "git log returned exit 128". The skill needs an explicit check: "if the output file does not exist or the body does not contain ## Symptom, fall back to shallow".

**Complexity of SKILL.md**

Lower prose in the skill itself (offload RCA to the agent), but total system complexity is higher. A new agent file must be defined, tested conceptually, and maintained. The skill + agent together are longer than a single inline skill.

**Interaction with `AskUserQuestion`**

Awkward. The skill must complete the AskUserQuestion exchange before spawning the subagent (the subagent cannot call AskUserQuestion in the current agent architecture — none of the existing agents list it as an allowed tool). This means the skill orchestrates questions, then hands off to the subagent, then returns control to the skill to pipe the result. Three context switches for what is logically one flow.

---

## Approach 3: Hybrid (shallow pass in skill, subagent for complex cases)

The skill performs a quick 1–2 file read itself, and delegates to a subagent only when the symptom description exceeds some complexity threshold (length, keyword heuristics, explicit `--deep` flag).

**Reliability of structured output**

Lowest. Two code paths produce the body. The threshold logic is ambiguous. Edge cases (medium-complexity symptoms) produce inconsistent output depth. Testing the threshold in prose instructions is error-prone.

**Token / latency cost**

Unpredictable by design.

**Fallback behavior**

Two fallback paths — one for the inline branch, one for the subagent branch. Doubles the fallback logic.

**Complexity of SKILL.md**

Highest. The threshold logic, the two branches, the subagent coordination, and the two fallback paths all need explicit prose. The surface area for misinterpretation is large.

**Interaction with `AskUserQuestion`**

Same awkwardness as Approach 2 for the subagent branch, plus the threshold decision happens mid-flow.

**Assessment:** Hybrid is not recommended. It delivers inconsistency without a compensating benefit. The spec explicitly rejects hard bounds — "trust the AI to stop when done" — which means the complexity trigger is the AI's judgment, not a rule. If the AI judges complexity inline, that is just Approach 1.

---

## Comparative Summary

| Dimension | Approach 1 (Inline) | Approach 2 (Subagent) | Approach 3 (Hybrid) |
|-----------|--------------------|-----------------------|---------------------|
| Schema reliability (happy path) | High | Medium (file-read handoff) | Low (two paths) |
| Latency | Lowest | Higher (agent spawn) | Unpredictable |
| Fallback clarity | High (direct tool result) | Medium (file check) | Low (two paths) |
| SKILL.md complexity | Medium (~70 lines) | Low skill, new agent file | High |
| AskUserQuestion interaction | Clean (sequential) | Awkward (3 context switches) | Awkward |
| New files to maintain | 0 | 1 (agent definition) | 1+ |
| Consistent with existing skill patterns | Yes (metta-issue stays simple) | Partially (fix-issues uses subagents, but for planning, not investigation) | No |

---

## Recommendation: Approach 1 — Inline RCA

Inline RCA is the right choice for this specific skill for three reasons.

First, the skill is interactive. The user is waiting for the ticket to be logged. Subagent round-trips add latency that is immediately felt. `metta-fix-issues` can afford multi-agent orchestration because it is a long-running autonomous pipeline; `/metta-issue` is a short interactive command.

Second, the RCA session is logically inseparable from the symptom description. The same context window that received the `AskUserQuestion` answer holds the in-flight execution context that makes RCA possible. Moving investigation to a subagent means reconstructing that context from files; the inline approach exploits it directly.

Third, the existing pattern for short skills (see `metta-issue` today, `metta-quick`) is: one skill file, ordered steps, no subagents. Adding an investigator subagent would be the only skill in the project that spawns an agent for a user-facing interactive command (as opposed to a background planning pipeline).

The one real risk of Approach 1 is that an orchestrator already deep in `metta-fix-issues` might have a cluttered context when it invokes `/metta-issue` to log a side-observation. That risk is mitigated by the `--quick` escape hatch (the fixer can invoke `--quick` for trivial side-observations) and by the fallback rule (if RCA produces malformed output, the skill falls back to shallow).

---

## Proposed SKILL.md Structure (Ordered Steps)

The rewritten skill has seven logical steps arranged as a numbered list. The `--quick` short-circuit exits after step 2; the normal path continues through step 7.

```
Steps:
1. [Parse arguments] Check for --quick flag in $ARGUMENTS.
2. [Collect description] If description not in $ARGUMENTS, AskUserQuestion: "What is the issue?".
3. [Collect severity] If severity not in $ARGUMENTS, AskUserQuestion with options critical|major|minor (default minor).
4. [--quick short-circuit] If --quick was set: skip to step 7 using description as body verbatim.
5. [RCA session] Investigate: read relevant source files, check git log, trace call path.
   On any tool failure: record reason and jump to step 6 (fallback).
   On success: format body with the three H2 sections (see prompt snippet below).
6. [Fallback body] If RCA failed: body = "> RCA skipped: <reason>\n\n<description>".
7. [Write ticket] printf '<body>' | METTA_SKILL=1 metta issue "<title>" --severity <level>
   Echo the returned slug and path.
```

---

## RCA Prompt Snippet

The following instruction block, placed inside step 5 of the skill, reliably produces the required schema. Emphasis on the exact heading names and the citation format is load-bearing — omitting either produces free-form prose.

```
Investigate the symptom described above. When investigation is complete, write ONLY the
following markdown body — no preamble, no closing remarks:

## Symptom
<one paragraph: what was observed, when, and in which command or code path>

## Root Cause Analysis
<analysis of the most probable cause>

### Evidence
- `path/to/file.ts:LINE` — <one sentence explaining what this line shows>
(list 1–5 evidence items; always use the exact format `path/to/file:LINE`)

## Candidate Solutions
1. **<Option name>** — <description>. Tradeoff: <drawback or risk>.
2. **<Option name>** — <description>. Tradeoff: <drawback or risk>.
(list 1–3 options; each MUST have a Tradeoff clause)

Do not add any text before `## Symptom` or after the last candidate solution.
```

The phrase "write ONLY the following markdown body" plus the explicit section headers plus the `Tradeoff:` label on each candidate are the three constraints that, together, keep the output schema stable without a post-validator.

---

## Final SKILL.md Sketch

```markdown
---
name: metta:issue
description: Run RCA then log a structured issue to spec/issues/
argument-hint: "[--quick] <description>"
allowed-tools: [Read, Grep, Glob, Bash, AskUserQuestion]
---

Log an issue to `spec/issues/` via the metta CLI.
By default, runs a short root-cause-analysis session before writing the ticket.
Pass `--quick` to skip RCA and write only the symptom headline (today's behavior).

## Steps

1. **Parse flags** — check `$ARGUMENTS` for `--quick`. Strip it from the description before
   proceeding; never forward it to the CLI.

2. **Collect description** — if no description was provided, use `AskUserQuestion`:
   "What is the issue?" (free-form). Store as `TITLE`.

3. **Collect severity** — if not provided, use `AskUserQuestion` with options
   `critical | major | minor` (default `minor`).

4. **--quick short-circuit** — if `--quick` was set, set `BODY="$TITLE"` and jump to step 7.

5. **RCA session** — investigate the symptom:
   a. Use `Grep` and `Glob` to locate source files most relevant to `TITLE`.
   b. Use `Read` to read the 2–5 most relevant files (focus on the call path).
   c. Use `Bash` to run `git log -20 --oneline -- <relevant-paths>` for each file.
   d. Trace the call path from the entry point to the failure site.
   e. When investigation is complete, format `BODY` using ONLY this schema:

      ## Symptom
      <one paragraph: what was observed, when, in which command or code path>

      ## Root Cause Analysis
      <analysis of the most probable root cause>

      ### Evidence
      - `path/to/file.ts:LINE` — <one sentence explaining what this line shows>
      (1–5 items; format MUST be `path/to/file:LINE`)

      ## Candidate Solutions
      1. **<Option>** — <description>. Tradeoff: <drawback or risk>.
      (1–3 options; each MUST include a Tradeoff clause)

   Do not add any text before `## Symptom` or after the last candidate solution.

   On ANY tool failure (file not found, git error, etc.): record the failure reason
   and jump to step 6.

6. **Fallback** — if RCA failed: set `BODY` to:
   ```
   > RCA skipped: <reason>

   <TITLE>
   ```
   Do NOT include `## Root Cause Analysis`, `### Evidence`, or `## Candidate Solutions`.

7. **Write ticket** — run:
   ```
   printf '%s' "$BODY" | METTA_SKILL=1 metta issue "$TITLE" --severity <level>
   ```
   Echo the returned slug and file path to the user.
   The CLI prints: `Issue logged: <slug> (<severity>)`
   File lives at: `spec/issues/<slug>.md`

## Rules

- Never forward `--quick` to the CLI.
- Never invent severity values beyond `critical`, `major`, `minor`.
- Never rewrite or read back `spec/issues/*.md` from this skill; the CLI owns that file.
- Issue capture MUST succeed even if RCA fails — fallback is mandatory, not optional.
- RCA has no hard file-read limit or time bound; stop when you have sufficient evidence.
```

---

## Footnotes

No external URLs were required for this analysis. All grounding came from files in the repository.
