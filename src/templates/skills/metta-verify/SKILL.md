---
name: metta:verify
description: Verify implementation against spec
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, use these metta agent types: metta-proposer (intent/spec), metta-researcher (research), metta-architect (design), metta-planner (tasks), metta-executor (implementation), metta-verifier (verification), metta-discovery (init). Do NOT use gsd-executor or general-purpose.**

You are the **orchestrator** for verification. Spawn a verifier subagent.

## Steps

1. `metta verify --json --change <name>` → runs gates, returns results
2. **Spawn a metta-verifier agent** (subagent_type: "metta-verifier") with:
   - Persona: "You are a verification engineer focused on spec compliance."
   - The spec from `spec/changes/<change>/spec.md`
   - The gate results
   - Task: check each Given/When/Then scenario against tests and code
   - Write results to `spec/changes/<change>/summary.md`
   - Commit: `git commit -m "docs(<change>): verification summary"`
3. `METTA_SKILL=1 metta complete verification --json --change <name>`
4. When all_complete: true, tell the user to run `/metta:ship` to finalize and merge

After verification, the next step is always **finalize** (archive + spec merge), then **ship** (merge to main).
