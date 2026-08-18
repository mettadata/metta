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

Resolve `{change_root}` first: `metta status --json --change <name>` returns `worktree` — when non-null, that value is `{change_root}`; when null, the main checkout root is. Every path and git command below is anchored to `{change_root}` — never rely on the session cwd, which for a worktree-hosted change resolves to the wrong checkout.

1. `metta verify --json --change <name>` → runs gates, returns results
2. **Spawn a metta-verifier agent** (subagent_type: "metta-verifier") with:
   - The spec from `{change_root}/spec/changes/<change>/spec.md`
   - The gate results
   - Task: check each Given/When/Then scenario against tests and code
   - Write results to `{change_root}/spec/changes/<change>/summary.md`
   - Commit: `git -C "{change_root}" add "{change_root}/spec/changes/<change>/summary.md" && git -C "{change_root}" commit -m "docs(<change>): verification summary"`
3. Token recording is automatic — a SubagentStop hook records each subagent's harness-measured usage; do not run `metta tokens record` after subagent returns. Only if the hook is unavailable, record manually: `metta tokens record --task <artifact-or-task-id> --agent <subagent-type> --model <alias> --tokens <count> --change <name> --source prose`.
4. `metta complete verification --json --change <name>`
5. When all_complete: true, tell the user to run `/metta:ship` to finalize and merge

## If any gate fails or the verifier reports FAIL

Spawn a metta-executor to fix the failures, then re-verify from step 1. When the FAILing run's output was produced under a downgraded (non-`inherit`) model, before spawning the fix executor run `metta model-escalation record --task <id> --from <resolved-model> --to inherit --trigger verify_fail --change <name>`, then spawn the fix executor with the `model` parameter omitted (top-tier).

- If an executor or verifier STOP-reports a silent-write anomaly (Edit/Write success with no on-disk effect), escalate to the user with the report; never work around it via bash writes or orchestrator-performed writes.

After verification, the next step is always **finalize** (archive + spec merge), then **ship** (merge to main).
