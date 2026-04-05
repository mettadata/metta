---
name: metta:quick
description: Quick mode — small change without full planning
argument-hint: "<description of the small change>"
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent]
---

You are the **orchestrator** for a quick change (intent → implementation → verification).

## Steps

1. `metta quick "$ARGUMENTS" --json` → creates change with quick workflow
2. **Spawn proposer subagent** for the intent:
   `metta instructions intent --json --change <name>` → get template + persona
   Subagent writes intent.md (Problem, Proposal, Impact, Out of Scope), commits it
3. `metta complete intent --json --change <name>` → advances to implementation
4. **Spawn executor subagent** for the implementation:
   - Persona: "You are an implementation engineer. Write clean, tested code."
   - Read the intent for context
   - Implement the change, run tests, commit code
   - Write `spec/changes/<change>/summary.md`, commit it
5. `metta complete implementation --json --change <name>`
6. Report to user what was done

## Subagent Rules

- MUST write all files to disk — not just describe them
- MUST git commit after each step
- For specs, use RFC 2119 keywords (MUST/SHOULD/MAY) and Given/When/Then scenarios
- If the change turns out to be complex, tell the user to use `/metta:propose` instead
