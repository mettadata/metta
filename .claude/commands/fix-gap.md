# fix-gap

Resolve reconciliation gaps through the full metta change lifecycle.

## Usage

- `/fix-gap` — show all gaps ranked by severity, choose which to fix
- `/fix-gap <slug>` — fix a specific gap
- `/fix-gap --all` — fix all gaps from highest to lowest severity

## How it works

This command delegates to the `metta-fix-gap` skill which:
1. Validates the gap exists via `metta fix-gap <slug> --json`
2. Creates a metta change from the gap
3. Runs the full pipeline: propose → plan → execute → review → verify → finalize → merge
4. Removes the gap file on success

For `--all`, gaps are processed one at a time from critical → medium → low severity.
