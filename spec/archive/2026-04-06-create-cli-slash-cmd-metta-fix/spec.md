# Spec: metta fix-gap — Automated Gap Resolution Pipeline

**Change:** create-cli-slash-cmd-metta-fix  
**Date:** 2026-04-06  
**Status:** Draft

---

## Overview

This spec defines the behavior of `metta fix-gap`, a CLI command and slash command that drives a reconciliation gap through the complete metta change lifecycle and removes the gap file on success. It composes existing commands (`propose`, `plan`, `execute`, `next`, `verify`, `finalize`, `ship`) rather than reimplementing them.

All requirements use RFC 2119 keywords: MUST, MUST NOT, SHOULD, MAY.

---

## Definitions

- **Gap slug** — the basename of a gap file without the `.md` extension (e.g., `execution-engine-callback-errors`).
- **Gap file** — a markdown file at `spec/gaps/<slug>.md` readable by `GapsStore.show`.
- **Severity** — an ephemeral classification (`critical`, `medium`, or `low`) derived at runtime by scanning raw gap file content for keywords. Severity is NOT stored in the gap file.
- **Pipeline** — the ordered sequence of phases: propose → plan → execute → review (×3) → verify → finalize → ship.
- **Phase exit code** — the exit code returned by the CLI command for each pipeline phase. Zero indicates success; non-zero indicates failure.

---

## Requirement 1: Severity Parsing

The fix-gap command MUST derive a severity tier from the raw text content of each gap file before ordering gaps for `--all` processing.

### Rules

1. The scanner MUST read the full raw content of the gap file (not only the structured `Gap` interface fields parsed by `GapsStore.show`).
2. The scan MUST be case-insensitive.
3. If the content contains any of the keywords `P1`, `High`, `Critical`, or `Bug`, the severity MUST be classified as `critical`.
4. If no `critical` keyword is matched and the content contains any of the keywords `P2` or `Medium`, the severity MUST be classified as `medium`.
5. If no `critical` or `medium` keyword is matched, the severity MUST be classified as `low`. A missing or empty file content also resolves to `low`.
6. `critical` MUST take precedence over `medium`; `medium` MUST take precedence over `low`. A file containing both `High` and `Medium` MUST be classified as `critical`.
7. The `Gap` interface and the on-disk gap file format MUST NOT be extended with a `severity` field. Severity is ephemeral.

### Scenario 1.1: Critical keyword detected in bold markdown field

**Given** a gap file at `spec/gaps/execution-engine-callback-errors.md` containing the text `**Severity**: High`  
**When** the fix-gap severity scanner reads the file content  
**Then** the file MUST be classified as `critical`  
**And** the raw match MUST succeed regardless of surrounding markdown syntax (bold markers, colons, whitespace)

### Scenario 1.2: P1 keyword triggers critical classification

**Given** a gap file whose content includes the text `Priority: P1` anywhere in the document  
**When** the severity scanner processes it  
**Then** the file MUST be classified as `critical`

### Scenario 1.3: Medium classification when only P2 is present

**Given** a gap file whose content contains `P2` but does not contain `P1`, `High`, `Critical`, or `Bug`  
**When** the severity scanner processes it  
**Then** the file MUST be classified as `medium`

### Scenario 1.4: Low classification as default

**Given** a gap file at `spec/gaps/gap-validate-redundancy.md` whose content contains none of the keywords `P1`, `P2`, `High`, `Medium`, `Critical`, or `Bug`  
**When** the severity scanner processes it  
**Then** the file MUST be classified as `low`

### Scenario 1.5: Critical takes precedence when both critical and medium keywords appear

**Given** a gap file containing both `High` and `Medium` in its body text (e.g., "High severity, medium effort")  
**When** the severity scanner processes it  
**Then** the file MUST be classified as `critical`, not `medium`

---

## Requirement 2: Single Gap Fix — `metta fix-gap <slug>`

The `metta fix-gap <slug>` command MUST resolve a single gap end-to-end by running the full pipeline and removing the gap file on success.

### Behavior

1. The command MUST call `GapsStore.exists(slug)` first. If the gap does not exist, it MUST print an error message of the form `Gap '<slug>' not found`, exit with code `4`, and MUST NOT create any change directory, branch, or artifact.
2. The command MUST read the gap via `GapsStore.show(slug)` to obtain `gap.title` and `gap.claim`.
3. The command MUST derive a change description from `gap.title` and `gap.claim` and invoke `metta propose --from-gap <slug> --discovery batch` as the first pipeline phase.
4. The command MUST execute each subsequent phase in order: `metta plan`, `metta execute`, `metta next` (three cycles), `metta verify`, `metta finalize`, `metta ship --branch metta/<change-name>`.
5. If all phases succeed (zero exit codes), the command MUST call `GapsStore.remove(slug)` to delete `spec/gaps/<slug>.md`.
6. After removing the gap file, the command MUST commit the deletion with the message `chore(<slug>): gap resolved`.
7. The command MUST exit with code `0` after a successful full pipeline.
8. On any pipeline phase failure, the command MUST report which phase failed (e.g., `fix-gap failed at phase: verify`), MUST exit with the non-zero code from the failing phase, MUST NOT delete the gap file, and MUST leave the `metta/<change-name>` branch intact for manual recovery.

### Scenario 2.1: Gap resolved end-to-end successfully

**Given** a gap file exists at `spec/gaps/execution-engine-callback-errors.md`  
**And** all pipeline phases return exit code `0`  
**When** the user runs `metta fix-gap execution-engine-callback-errors`  
**Then** the command MUST execute phases in the order: propose → plan → execute → next (×3) → verify → finalize → ship  
**And** MUST call `GapsStore.remove('execution-engine-callback-errors')` after ship succeeds  
**And** MUST delete `spec/gaps/execution-engine-callback-errors.md` from disk  
**And** MUST commit the deletion with message `chore(execution-engine-callback-errors): gap resolved`  
**And** MUST exit with code `0`

### Scenario 2.2: Gap file not found — early exit, no side effects

**Given** no file exists at `spec/gaps/does-not-exist.md`  
**When** the user runs `metta fix-gap does-not-exist`  
**Then** the command MUST print `Gap 'does-not-exist' not found`  
**And** MUST exit with code `4`  
**And** MUST NOT create any change directory, branch, or artifact  
**And** MUST NOT invoke `metta propose` or any subsequent phase

### Scenario 2.3: Pipeline halts at failed phase, gap file preserved

**Given** a gap file exists at `spec/gaps/config-loader-gaps.md`  
**And** `metta verify` exits with a non-zero code during the pipeline  
**When** the user runs `metta fix-gap config-loader-gaps`  
**Then** the command MUST print `fix-gap failed at phase: verify`  
**And** MUST exit with the non-zero exit code from `metta verify`  
**And** MUST NOT delete `spec/gaps/config-loader-gaps.md`  
**And** MUST leave the `metta/<change-name>` branch intact

### Scenario 2.4: Discovery mode is batch, not interactive

**Given** a valid gap file exists  
**When** `metta fix-gap <slug>` invokes the propose phase  
**Then** the propose call MUST use `--discovery batch`  
**And** MUST NOT prompt the user with interactive discovery questions

---

## Requirement 3: Fix All Gaps — `metta fix-gap --all`

The `metta fix-gap --all` command MUST process all gaps in `spec/gaps/` sequentially, ordered from highest to lowest severity.

### Behavior

1. The command MUST call `GapsStore.list()` to enumerate all gap slugs.
2. For each slug, the command MUST read the raw file content and classify severity per Requirement 1.
3. The command MUST sort gaps: `critical` first, then `medium`, then `low`. Within a tier, the command MUST preserve the filesystem order returned by `GapsStore.list()`.
4. The command MUST process each gap by invoking the same single-gap pipeline (Requirement 2), in severity-sorted order.
5. After each gap attempt, the command MUST print a progress line of the form `[N/M] <slug>: resolved` or `[N/M] <slug>: failed at phase: <phase>`.
6. If a gap's pipeline fails, the command MUST log the failure, MUST NOT delete that gap's file, and MUST continue to the next gap rather than aborting.
7. After all gaps have been attempted, the command MUST print a final summary of the form `Resolved: X / Failed: Y / Total: Z`.
8. If one or more gaps failed, the command MUST exit with a non-zero code. If all gaps resolved successfully, the command MUST exit with code `0`.
9. If `spec/gaps/` contains no `.md` files, the command MUST print `No gaps found.` and exit with code `0`.

### Scenario 3.1: Gaps processed in severity order

**Given** three gap files exist:  
- `spec/gaps/gap-validate-redundancy.md` — contains only `P3` (low)  
- `spec/gaps/execution-engine-callback-errors.md` — contains `High` (critical)  
- `spec/gaps/gap-context-004-instruction-generator-missing-test.md` — contains `Low` in its `Impact` section (low)  
**When** the user runs `metta fix-gap --all`  
**Then** the command MUST process `execution-engine-callback-errors` first  
**And** MUST process the two low-severity gaps after it  
**And** MUST NOT process any low-severity gap before the critical gap

### Scenario 3.2: Three gaps with distinct tiers — exact processing order

**Given** three gap files:  
- `spec/gaps/gap-a.md` contains `P3` (low)  
- `spec/gaps/gap-b.md` contains `High` (critical)  
- `spec/gaps/gap-c.md` contains `Medium` (medium)  
**And** all pipeline phases succeed for all three gaps  
**When** the user runs `metta fix-gap --all`  
**Then** processing order MUST be: `gap-b` (critical), `gap-c` (medium), `gap-a` (low)  
**And** the command MUST print `Resolved: 3 / Failed: 0 / Total: 3`  
**And** MUST exit with code `0`

### Scenario 3.3: No gaps found

**Given** `spec/gaps/` contains no `.md` files  
**When** the user runs `metta fix-gap --all`  
**Then** the command MUST print `No gaps found.`  
**And** MUST exit with code `0`

---

## Requirement 4: Failure Handling

When a gap fix fails mid-pipeline, the gap file MUST be preserved and the `--all` batch MUST continue to the next gap.

### Behavior

1. A pipeline failure is defined as any phase returning a non-zero exit code.
2. On failure, the failing phase name MUST be captured and reported.
3. The gap file for a failed gap MUST remain at `spec/gaps/<slug>.md` after the failure.
4. In `--all` mode, after a gap fails, the command MUST immediately attempt the next gap in the sorted order.
5. A failed gap MUST count toward the `Failed` total in the final summary.
6. The final exit code after `--all` MUST be non-zero if any gap failed.
7. A gap whose pipeline partially succeeded (e.g., propose and plan completed, execute failed) MUST leave the `metta/<change-name>` branch alive. The command MUST NOT attempt to clean up partial branches.

### Scenario 4.1: One gap fails in --all, remaining gaps continue

**Given** three gap files exist (critical, medium, low)  
**And** the critical gap's `execute` phase exits with a non-zero code  
**And** the medium and low gaps complete all phases successfully  
**When** the user runs `metta fix-gap --all`  
**Then** the command MUST log `[1/3] <critical-slug>: failed at phase: execute`  
**And** MUST continue to process the medium gap  
**And** MUST continue to process the low gap  
**And** MUST print `Resolved: 2 / Failed: 1 / Total: 3`  
**And** MUST NOT delete the critical gap's file  
**And** MUST exit with a non-zero code

### Scenario 4.2: Single-gap failure leaves branch intact for manual recovery

**Given** a gap file exists at `spec/gaps/state-store-gaps.md`  
**And** the `finalize` phase fails after `propose`, `plan`, `execute`, `next` (×3), and `verify` have all succeeded  
**When** the user runs `metta fix-gap state-store-gaps`  
**Then** the command MUST report `fix-gap failed at phase: finalize`  
**And** MUST NOT delete `spec/gaps/state-store-gaps.md`  
**And** the branch `metta/<change-name>` MUST still exist, preserving all work completed up to the point of failure  
**And** the user MUST be able to resume manually by running `metta finalize` on that branch

### Scenario 4.3: All gaps fail — exit code reflects total failure

**Given** three gap files exist  
**And** all three gaps fail at the `plan` phase  
**When** the user runs `metta fix-gap --all`  
**Then** the command MUST print `Resolved: 0 / Failed: 3 / Total: 3`  
**And** MUST exit with a non-zero code  
**And** all three gap files MUST remain on disk

---

## Requirement 5: Slash Command — `/metta:fix-gap`

A Claude slash command MUST exist at `.claude/commands/fix-gap.md` that provides the same gap resolution behavior accessible from within a Claude session.

### Behavior

1. The slash command file MUST be located at `.claude/commands/fix-gap.md`.
2. When invoked without arguments, the slash command MUST run `metta gaps list --json` to enumerate gaps, classify their severity, display a ranked table with columns `Severity`, `Slug`, and `Title`, and ask the user which gap(s) to fix before taking any action.
3. When invoked with a gap slug argument, the slash command MUST run `metta fix-gap <slug> --json` and stream the structured JSON output back into the conversation.
4. The slash command MUST NOT implement gap resolution logic independently. It MUST delegate entirely to `metta fix-gap` CLI invocations.
5. The slash command MUST include usage instructions explaining the `--all` flag as an option the user can pass.
6. The ranked table MUST sort rows from `critical` to `low`, with within-tier ordering matching the severity sort used by `--all`.

### Scenario 5.1: No-argument invocation displays ranked table and prompts user

**Given** five gap files exist in `spec/gaps/` with mixed severities (two critical, two medium, one low)  
**When** the user invokes `/metta:fix-gap` with no arguments in a Claude session  
**Then** the slash command MUST run `metta gaps list --json` to retrieve gaps  
**And** MUST display a ranked table sorted critical → medium → low  
**And** MUST ask the user which gap(s) to fix before running any pipeline  
**And** MUST NOT begin any `metta fix-gap` invocation until the user responds

### Scenario 5.2: Slug argument invokes CLI and streams JSON output

**Given** a gap file exists at `spec/gaps/gap-context-003-delta-strategy-unimplemented.md`  
**When** the user invokes `/metta:fix-gap gap-context-003-delta-strategy-unimplemented`  
**Then** the slash command MUST invoke `metta fix-gap gap-context-003-delta-strategy-unimplemented --json`  
**And** MUST stream the structured JSON result into the conversation  
**And** MUST NOT implement any fix logic in the slash command file itself

### Scenario 5.3: Slash command file is present at the correct path

**Given** the metta project has been initialized  
**When** the developer inspects `.claude/commands/fix-gap.md`  
**Then** the file MUST exist  
**And** MUST contain instructions for both the no-argument (interactive table) and slug-argument (direct fix) invocation modes

---

## Requirement 6: JSON Output — `--json` Flag

When `--json` is passed, `metta fix-gap` MUST emit structured JSON to stdout, one JSON object per invocation, covering the result of all gap processing.

### Behavior

1. When `--json` is passed with a single slug (`metta fix-gap <slug> --json`), the command MUST emit exactly one JSON object with the following top-level keys:
   - `gap` (string): the gap slug
   - `change` (string): the metta change name created by the propose phase
   - `phases` (array of objects): one entry per phase attempted, each with `phase` (string) and `status` (`"pass"` or `"fail"`)
   - `status` (string): `"resolved"` if the full pipeline succeeded, `"failed"` if any phase failed
   - `failed_phase` (string): the name of the failing phase, present only when `status` is `"failed"`; MUST be absent when `status` is `"resolved"`
2. When `--json` is passed with `--all` (`metta fix-gap --all --json`), the command MUST emit exactly one JSON object with the following top-level keys:
   - `gaps` (array): one entry per gap attempted, each entry matching the single-slug schema above
   - `summary` (object): `{ resolved: number, failed: number, total: number }`
3. When a gap is not found and `--json` is passed, the command MUST emit `{ "error": { "code": 4, "type": "not_found", "message": "Gap '<slug>' not found" } }` and exit with code `4`.
4. When `--json` is active, the command MUST NOT emit any human-readable text to stdout. Structured JSON MUST be the sole stdout output. Diagnostic messages MAY be written to stderr.
5. The JSON output MUST be valid JSON parseable by `JSON.parse`.

### Scenario 6.1: Successful single-gap --json output

**Given** a gap file exists at `spec/gaps/gap-context-001-io-errors-swallowed.md`  
**And** all pipeline phases succeed  
**When** the user runs `metta fix-gap gap-context-001-io-errors-swallowed --json`  
**Then** the command MUST emit a JSON object where:  
- `gap` equals `"gap-context-001-io-errors-swallowed"`  
- `status` equals `"resolved"`  
- `phases` is an array containing one entry per phase, each with `"status": "pass"`  
- `failed_phase` is absent from the object  
**And** MUST exit with code `0`

### Scenario 6.2: Failed single-gap --json output includes failed_phase

**Given** a gap file exists at `spec/gaps/schemas-missing-negative-tests.md`  
**And** the `verify` phase fails  
**When** the user runs `metta fix-gap schemas-missing-negative-tests --json`  
**Then** the command MUST emit a JSON object where:  
- `status` equals `"failed"`  
- `failed_phase` equals `"verify"`  
- `phases` contains an entry for `verify` with `"status": "fail"`  
- `phases` entries for all phases before `verify` have `"status": "pass"`  
**And** MUST exit with a non-zero code

### Scenario 6.3: --all with --json emits a summary array

**Given** three gap files exist with one failing mid-pipeline  
**When** the user runs `metta fix-gap --all --json`  
**Then** the command MUST emit a single JSON object  
**And** the `gaps` array MUST contain three entries  
**And** the `summary` object MUST reflect the correct `resolved`, `failed`, and `total` counts  
**And** the command MUST NOT emit any non-JSON text to stdout

### Scenario 6.4: Not-found error with --json follows error schema

**Given** no file exists at `spec/gaps/nonexistent-gap.md`  
**When** the user runs `metta fix-gap nonexistent-gap --json`  
**Then** the command MUST emit `{ "error": { "code": 4, "type": "not_found", "message": "Gap 'nonexistent-gap' not found" } }`  
**And** MUST exit with code `4`

---

## Out of Scope

- **Parallel gap resolution.** `--all` processes gaps sequentially. Parallel execution via independent worktrees is deferred.
- **Interactive discovery during fix-gap.** The propose phase MUST use `--discovery batch`. Interactive AI questioning during `fix-gap` is not supported.
- **Gap prioritization beyond severity keywords.** Dependency ordering between gaps is not computed. The severity sort is keyword-based only.
- **Partial pipeline resumption via a `--resume` flag.** If `metta fix-gap` is interrupted, recovery is manual using individual metta commands on the surviving branch.
- **Creating or modifying gap files.** This command only reads and resolves existing gaps. Gap creation remains the responsibility of `metta reconcile` and `metta import`.
- **Modifying the `Gap` interface or `GapsStore` API.** The existing `show`, `list`, `remove`, and `exists` methods are sufficient. No new fields are added.
- **Automatic PR creation or remote push.** `metta ship` merges locally. Pushing to a remote or opening a pull request is out of scope.
- **Gap severity stored in gap file format.** The `.md` file format is not extended with a structured `severity` field.
- **`metta fix-gap` creating worktrees.** Worktree management is the responsibility of `metta propose`. `fix-gap` delegates to `propose --from-gap`.
