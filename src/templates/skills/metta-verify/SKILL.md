---
name: metta:verify
description: Verify implementation against spec
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: .claude/hooks/metta-session-mint.mjs metta-verify
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer (intent/spec), metta-researcher (research), metta-architect (design), metta-planner (tasks), metta-executor (implementation), metta-verifier (verification), metta-discovery (init). Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for verification. Spawn a verifier subagent.

## Steps

1. `metta verify --json --change <name>` → runs gates, returns results
2. **Spawn a metta-verifier agent** (subagent_type: "metta-verifier") with:
   - The spec from `spec/changes/<change>/spec.md`
   - The gate results
   - Task: check each Given/When/Then scenario against tests and code
   - Write results to `spec/changes/<change>/summary.md`
   - Commit: `git commit -m "docs(<change>): verification summary"`
3. After each subagent returns, record its reported token usage: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name>` — `--task` is the artifact or task id it worked, `--agent` is the `subagent_type` you spawned, `--model` is the model alias you passed to `Agent(...)` (use `inherit` when you omitted the `model` parameter), and `--tokens` is the token count from its completion report. This applies to every spawn — planner, executor, reviewer, and verifier alike.
4. `metta complete verification --json --change <name>`
5. When all_complete: true, tell the user to run `/metta:ship` to finalize and merge

## If any gate fails or the verifier reports FAIL

Spawn a metta-executor to fix the failures, then re-verify from step 1. When the FAILing run's output was produced under a downgraded (non-`inherit`) model, before spawning the fix executor run `metta model-escalation record --task <id> --from <resolved-model> --to inherit --trigger verify_fail --change <name>`, then spawn the fix executor with the `model` parameter omitted (top-tier).

After verification, the next step is always **finalize** (archive + spec merge), then **ship** (merge to main).
