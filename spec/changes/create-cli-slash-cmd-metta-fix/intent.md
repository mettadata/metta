# Intent: metta fix-gap — Automated Gap Resolution Pipeline

**Change:** create-cli-slash-cmd-metta-fix  
**Date:** 2026-04-06  
**Status:** Draft

---

## Problem

The `metta import` and `metta reconcile` commands produce gap files in `spec/gaps/`. As of 2026-04-06, the project has 20 such files representing real implementation defects — silent error swallowing, stub safety gates, unimplemented delta operations, and missing test coverage. Each gap is a markdown file parsed by `GapsStore` into a structured `Gap` object with `title`, `status`, `source`, `claim`, `evidence`, `impact`, and an `action` field.

Closing a gap currently requires manual choreography: a developer must read the gap file, formulate a change description, run `metta propose`, work through the full artifact pipeline (propose → plan → execute → review × 3 → verify × 3 → finalize → ship), then manually delete the gap file. This multi-step, error-prone process is why gaps accumulate rather than get resolved.

Three specific pain points drive this change:

1. **No triage order.** Nothing ranks gaps by severity before work begins. Severity signals exist in the gap files themselves (keywords `P1`, `High`, `Critical`, `Bug` → critical; `Medium`, `P2` → medium; `Low`, `P3` → low), but no tooling reads them.

2. **No pipeline entry point for gaps.** `metta propose` accepts `--from-gap <slug>` but does not automatically drive the change to completion — it stops after creating the change directory and branch. The caller must run every subsequent command by hand.

3. **No closure signal.** Nothing removes the gap file when a change succeeds. Gaps remain in `spec/gaps/` even after their issue is fixed, creating false debt.

There is also no Claude slash command (`/metta:fix-gap`) to invoke this workflow from within an AI-assisted coding session, forcing developers to context-switch to the terminal at every step.

---

## Proposal

Add two new CLI entry points and one slash command that drive a gap through the complete metta lifecycle and remove the gap file on success.

### CLI commands

#### `metta fix-gap <gap-name>`

Resolves a single gap end-to-end:

1. Read and parse the gap file at `spec/gaps/<gap-name>.md` via `GapsStore.show`.
2. Derive a change description from `gap.title` and `gap.claim`.
3. Call the propose pipeline with `--from-gap <gap-name>` — this creates `spec/changes/<change-name>/` and checks out branch `metta/<change-name>`.
4. Execute the full standard workflow in sequence: propose artifact, plan, execute, review (3 cycles), verify (3 cycles), finalize, ship.
5. On successful ship, call `GapsStore.remove(gap-name)` to delete `spec/gaps/<gap-name>.md` and commit the deletion.
6. On any pipeline failure, halt and report the failed phase; leave the gap file intact and the change branch alive for manual recovery.

#### `metta fix-gap --all`

Resolves all gaps in `spec/gaps/` sequentially, highest severity first:

1. Call `GapsStore.list()` to enumerate all gap slugs.
2. Read each gap via `GapsStore.show` and assign a severity tier by scanning the raw file content for severity keywords:
   - Keywords `P1`, `High`, `Critical`, `Bug` → `critical`
   - Keywords `Medium`, `P2` → `medium`
   - Keywords `Low`, `P3`, or no match → `low`
3. Sort gaps: `critical` first, then `medium`, then `low`; within a tier, preserve filesystem order.
4. Process each gap by calling the same single-gap pipeline above, in order.
5. After each gap, print a progress summary (`N of M gaps resolved`).
6. If a gap fails, log the failure and continue to the next gap rather than aborting the batch. At the end, report total resolved / failed / skipped counts.

### Severity detection contract

Severity is parsed from the raw markdown text of each gap file (not only from the structured `Gap` fields). The scanner MUST check the full raw content, case-insensitively, before falling back to `low`. The `Gap` interface does not need a `severity` field; severity is ephemeral metadata used only for ordering.

### Slash command: `/metta:fix-gap`

A Claude slash command stored at `.claude/commands/fix-gap.md`. When invoked without arguments it reads `spec/gaps/`, displays a ranked table (severity, slug, title), and asks the user which gap(s) to fix. When invoked with a gap slug it runs the fix pipeline for that gap. The slash command drives the same pipeline as the CLI by invoking `metta fix-gap <gap-name> --json` and streaming structured output back to the conversation.

### Pipeline integration points

The fix-gap pipeline composes existing commands rather than reimplementing them. Each phase maps to an existing CLI command:

| Phase | CLI command |
|---|---|
| Propose | `metta propose --from-gap <slug>` |
| Plan | `metta plan` |
| Execute | `metta execute` |
| Review | `metta next` (× 3 cycles) |
| Verify | `metta verify` |
| Finalize | `metta finalize` |
| Ship | `metta ship --branch metta/<change-name>` |
| Remove gap | `GapsStore.remove` + git commit |

### Error handling and recovery

- If a gap file does not exist, exit code 4 (`not_found`).
- If any pipeline phase returns a non-zero exit code, the fix-gap command exits with that code and prints which phase failed.
- The gap file is only removed after `ship` succeeds. A partial run leaves no stale state beyond the existing change branch, which is recoverable via standard metta commands.
- `--all` mode never deletes a gap file for a failed gap; it continues to the next gap.

---

## Impact

**Developers:** Closing a gap drops from 8+ manual commands to one (`metta fix-gap <slug>`). The `--all` flag can drain the entire gap backlog unattended, with severity ordering ensuring the highest-risk defects are fixed first.

**Project quality:** The 20 current gaps include critical defects (callback errors that falsely mark tasks as failed, stub merge-safety gates that allow broken branches to merge, silently swallowed I/O errors). Automating their resolution unblocks the merge-safety improvements tracked in the project feedback.

**Spec debt:** Gaps accumulate because the cost to close one exceeds the cost to leave it. Reducing that cost to a single command inverts the incentive.

**Slash command:** Developers working inside a Claude session can invoke `/metta:fix-gap` without switching to the terminal, keeping AI-assisted flow intact.

---

## Out of Scope

- **Parallel gap resolution.** Gaps are processed sequentially. Parallel execution would require independent worktrees per gap and conflict detection between concurrent spec merges. This is deferred.
- **Interactive discovery during fix-gap.** The propose phase will use `--discovery batch` mode, not the interactive AI questioning flow. Fix-gap assumes the gap file already contains sufficient context.
- **Gap prioritization beyond severity keywords.** Dependency ordering between gaps (e.g., fix a test helper before fixing the test that uses it) is not computed. The severity sort is best-effort.
- **Partial pipeline resumption.** If `metta fix-gap` is interrupted mid-pipeline, the user resumes by running the individual commands manually. A `--resume` flag for fix-gap is deferred.
- **Creating new gap files.** This change only reads and resolves existing gaps. Gap creation remains the responsibility of `metta reconcile` and `metta import`.
- **Modifying the `Gap` interface or `GapsStore`.** The existing `Gap` type and `GapsStore` methods (`show`, `list`, `remove`, `exists`) are sufficient. No new fields are added to the stored format.
- **Automatic PR creation.** `metta ship` merges the branch locally. Pushing to a remote or opening a pull request is outside the scope of this change.
- **Gap severity stored in gap files.** Severity remains a derived, ephemeral value computed at runtime from keyword scanning. The gap file format is not extended with a structured `severity` field.

---

## Given/When/Then Scenarios

### Scenario 1: Single gap resolved successfully

**Given** a gap file exists at `spec/gaps/execution-engine-callback-errors.md` with `Severity: High` in its content  
**When** the user runs `metta fix-gap execution-engine-callback-errors`  
**Then** the command:
- reads the gap file and constructs a change description
- runs propose → plan → execute → review → verify → finalize → ship in sequence
- calls `GapsStore.remove('execution-engine-callback-errors')` after ship succeeds
- deletes `spec/gaps/execution-engine-callback-errors.md` from disk
- commits the deletion with message `chore(execution-engine-callback-errors): gap resolved`
- exits with code 0

### Scenario 2: Gap file not found

**Given** no file exists at `spec/gaps/does-not-exist.md`  
**When** the user runs `metta fix-gap does-not-exist`  
**Then** the command:
- prints an error: `Gap 'does-not-exist' not found`
- exits with code 4
- does not create any change or branch

### Scenario 3: Pipeline failure halts single-gap run, gap file preserved

**Given** a gap file exists at `spec/gaps/config-loader-gaps.md`  
**And** the verify phase fails (a gate returns `fail` status)  
**When** the user runs `metta fix-gap config-loader-gaps`  
**Then** the command:
- reports `fix-gap failed at phase: verify`
- exits with a non-zero code
- does NOT delete `spec/gaps/config-loader-gaps.md`
- leaves the `metta/<change-name>` branch intact for manual recovery

### Scenario 4: `--all` processes gaps in severity order

**Given** three gap files exist:
- `spec/gaps/gap-validate-redundancy.md` — contains keyword `P3` (low)
- `spec/gaps/execution-engine-callback-errors.md` — contains keyword `High` (critical)
- `spec/gaps/gap-context-004-instruction-generator-missing-test.md` — contains keyword `Medium` (medium)  

**When** the user runs `metta fix-gap --all`  
**Then** the command processes gaps in the order:
1. `execution-engine-callback-errors` (critical)
2. `gap-context-004-instruction-generator-missing-test` (medium)
3. `gap-validate-redundancy` (low)

### Scenario 5: `--all` continues after one gap fails

**Given** three gap files exist (critical, medium, low)  
**And** the critical gap's execute phase fails  
**When** the user runs `metta fix-gap --all`  
**Then** the command:
- logs failure for the critical gap and continues
- processes the medium gap
- processes the low gap
- prints a final summary: `Resolved: 2 / Failed: 1 / Total: 3`
- exits with a non-zero code reflecting that at least one gap failed

### Scenario 6: Severity keyword detection — critical takes precedence

**Given** a gap file contains the text `**Severity**: High` in a bold markdown field  
**When** `metta fix-gap --all` scans the file for severity  
**Then** the file is classified as `critical` and sorted before any `medium` or `low` gap

### Scenario 7: Severity keyword detection — fallback to low

**Given** a gap file contains none of the keywords `P1`, `P2`, `P3`, `High`, `Medium`, `Low`, `Critical`, `Bug`  
**When** `metta fix-gap --all` scans the file  
**Then** the file is classified as `low`

### Scenario 8: Slash command displays ranked gap table

**Given** 5 gap files exist in `spec/gaps/` with mixed severities  
**When** the user invokes `/metta:fix-gap` with no arguments in a Claude session  
**Then** the slash command:
- runs `metta gaps list --json` to enumerate gaps
- displays a ranked table with columns: Severity, Slug, Title
- asks the user which gap(s) to fix before taking any action

### Scenario 9: `--json` output for single gap

**Given** a gap file exists and `metta fix-gap <slug> --json` is run  
**Then** the command emits a JSON object with keys:
- `gap`: the gap slug
- `change`: the metta change name created
- `phases`: array of `{ phase, status }` objects
- `status`: `"resolved"` or `"failed"`
- `failed_phase`: the phase name if `status` is `"failed"`, otherwise absent
