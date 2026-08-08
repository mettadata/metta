---
name: metta:check-constitution
description: Check a change spec.md against the project constitution
allowed-tools: [Read, Write, Bash, Agent, AskUserQuestion]
---

Orchestrates the three-step constitution check: emit the check contract, spawn the `metta-constitution-checker` subagent to produce a verdict, then record the verdict. The CLI command owns all violation parsing, severity logic, and `violations.md` writes. Do NOT re-implement any of that here.

## Steps

1. **Resolve the change slug.**
   - If `$ARGUMENTS` contains `--change <name>`, use that slug directly.
   - Otherwise run `metta status --json` (Bash). If it reports an active change, default to that slug.
   - If no active change is found, use **AskUserQuestion** to collect the change slug from the user (free-form text input).

2. **Emit the check contract.** Bash call:
   ```
   metta check-constitution --change <slug> --json
   ```
   Capture `articles`, `spec_path`, `spec_content`, `instructions`, `output_path`, and `change_root` from the JSON output. `spec_path` and `output_path` are absolute paths — use them verbatim from any cwd; `change_root` is the checkout hosting the change. Exit `0` here only means the contract was produced — it is NOT a check result, and this skill must not report "no violations" from this step.

3. **Spawn the subagent.** Spawn `metta-constitution-checker` (Read-only tools) with a prompt built from the emitted contract: frame the constitution content in `<CONSTITUTION>...</CONSTITUTION>` tags (the `articles` lists), frame the spec content in `<SPEC path="...">...</SPEC>` tags (using `spec_path` and `spec_content`), and include the emitted `instructions` as the task framing. The subagent returns a single JSON object of the form `{"violations": [...]}`. Write that output **verbatim** to `output_path` (Write tool; create parent directories as needed).

4. **Record the verdict.** Bash call:
   ```
   metta check-constitution --change <slug> --record <output_path> --json
   ```

5. **On exit 0** (no blocking violations):
   - Echo: `No blocking violations`
   - Echo the `violations_path` from the JSON output.

6. **On exit 4** (blocking violations, malformed verdict, or error):
   - Echo the `violations_path` from the JSON output.
   - Surface each blocking violation from the JSON `violations` array (article, severity, evidence).
   - Tell the user verbatim:
     > Resolve by editing spec.md — fix each violation or add a justification to the `## Complexity Tracking` section (skip this section for `critical` severity — those are never justifiable).
   - Report the failure — never report success on exit 4. This includes the `verdict_validation_error` case (malformed or schema-invalid verdict file): surface the error message and do not claim the check passed.

7. **Never rewrite `violations.md` from this skill.** The CLI command is the sole writer of that file.
