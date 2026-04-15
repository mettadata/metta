---
name: metta:check-constitution
description: Check a change spec.md against the project constitution
allowed-tools: [Read, Bash, AskUserQuestion]
---

Thin wrapper over `metta check-constitution`. The CLI command owns all violation parsing, severity logic, and `violations.md` writes. Do NOT re-implement any of that here.

## Steps

1. **Resolve the change slug.**
   - If `$ARGUMENTS` contains `--change <name>`, use that slug directly.
   - Otherwise run `metta status --json` (Bash). If it reports an active change, default to that slug.
   - If no active change is found, use **AskUserQuestion** to collect the change slug from the user (free-form text input).

2. **Run the check.** Bash call:
   ```
   metta check-constitution --change <slug> --json
   ```

3. **On exit 0** (no blocking violations):
   - Echo: `No blocking violations`
   - Echo the `violations_path` from the JSON output.

4. **On exit 4** (blocking violations or error):
   - Echo the `violations_path` from the JSON output.
   - Surface each blocking violation from the JSON `violations` array (article, severity, evidence).
   - Tell the user verbatim:
     > Resolve by editing spec.md — fix each violation or add a justification to the `## Complexity Tracking` section (skip this section for `critical` severity — those are never justifiable).

5. **Never rewrite `violations.md` from this skill.** The CLI command is the sole writer of that file.
