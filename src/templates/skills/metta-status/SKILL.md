---
name: metta:status
description: Check current Metta change status
allowed-tools: [Read, Bash]
---

Run `metta status --json` and report results to the user.

If no changes active, suggest `/metta:propose` or `/metta:quick`.
If multiple changes, list them all with their status.
