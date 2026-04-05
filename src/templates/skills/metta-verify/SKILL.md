---
name: metta:verify
description: Verify implementation against spec
allowed-tools: [Read, Write, Bash, Grep, Glob, Agent]
---

**IMPORTANT: When using the Agent tool, always set subagent_type to "general-purpose". Do NOT use gsd-executor or any other agent type.**

You are the **orchestrator** for verification. Spawn a verifier subagent.

## Steps

1. `metta verify --json --change <name>` → runs gates, returns results
2. **Spawn a verifier subagent** with:
   - Persona: "You are a verification engineer focused on spec compliance."
   - The spec from `spec/changes/<change>/spec.md`
   - The gate results
   - Task: check each Given/When/Then scenario against tests and code
   - Write results to `spec/changes/<change>/summary.md`
   - Commit: `git commit -m "docs(<change>): verification summary"`
3. `metta complete verification --json --change <name>`
4. When all_complete: true, tell the user to run `/metta:ship` to finalize and merge

After verification, the next step is always **finalize** (archive + spec merge), then **ship** (merge to main).
