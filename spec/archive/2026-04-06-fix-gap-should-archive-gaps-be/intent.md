# Intent: fix-gap should archive gaps before removal

**Change:** fix-gap-should-archive-gaps-be  
**Date:** 2026-04-06  
**Status:** Draft

---

## Problem

When `metta fix-gap --remove-gap <slug>` resolves a gap, it calls `GapsStore.remove(slug)`, which delegates directly to `StateStore.delete(join('gaps', '<slug>.md'))` — a raw `unlink` that permanently destroys the file. The gap's full analysis content (title, claim, evidence, impact, source, related spec, action) is lost at the moment of resolution.

There is no record that the gap ever existed, what problem it described, or what the resolution was. After `metta fix-gap --remove-gap` succeeds, `git log -- spec/gaps/<slug>.md` shows a deletion commit but the content is gone from the working tree and cannot be reviewed without digging through git history. By contrast, every completed *change* is preserved in `spec/archive/` with a date-prefixed directory — gaps get no equivalent treatment.

This creates two concrete problems:

1. **Audit loss.** Teams cannot review what gaps existed at a prior point in time without parsing git history. The gap's `evidence` and `impact` fields — which often contain debugging findings and affected code paths — are discarded exactly when they would be most useful as a postmortem record.

2. **Inconsistent lifecycle.** Changes are archived on completion (`spec/archive/<date>-<change-name>/`). Gaps are silently deleted. The asymmetry is surprising: a resolved gap is more historically significant than a draft artifact, yet artifacts are preserved and gaps are not.

---

## Proposal

Before `GapsStore.remove` unlinks a gap file, copy its content to `spec/archive/<date>-<slug>-gap-resolved.md`. This mirrors the naming convention already used for archived change directories (`spec/archive/2026-04-06-create-cli-slash-cmd-metta-fix/`) but uses a flat file rather than a subdirectory, because a resolved gap is a single markdown document rather than a multi-artifact collection.

### Changes required

**`src/gaps/gaps-store.ts` — add `archive()` method**

`GapsStore` gains a new `async archive(slug: string): Promise<string>` method that:
1. Reads the raw gap file content from `spec/gaps/<slug>.md` via `this.state.readRaw`.
2. Formats a date prefix as `YYYY-MM-DD` from `new Date()`.
3. Derives the archive filename: `<date>-<slug>-gap-resolved.md`.
4. Writes the content to `spec/archive/<date>-<slug>-gap-resolved.md` via `this.state.writeRaw`, creating `spec/archive/` if it does not exist.
5. Returns the archive path (relative to `specDir`) for use by the caller in output and git staging.

The `archive()` method does NOT delete the source file. Deletion remains the responsibility of the existing `remove()` method, which the caller invokes after `archive()` succeeds.

**`src/cli/commands/fix-gap.ts` — call archive before remove in `--remove-gap` branch**

In the `--remove-gap` handler (Branch 1, line 40–73), replace the direct `ctx.gapsStore.remove(slug)` call with a two-step sequence:
1. `await ctx.gapsStore.archive(slug)` — copy gap to archive.
2. `await ctx.gapsStore.remove(slug)` — delete the gap file.

The `git add` + `git commit` block that follows MUST stage both `spec/gaps/` (the deletion) and `spec/archive/` (the new archive file) so both appear in the same commit.

**`src/templates/skills/metta-fix-gap/SKILL.md` — update step 10**

The "Remove Gap" step (step 10) currently reads:

> `metta gaps remove <gap-slug> --json` → mark gap as resolved

Update to:

> `metta fix-gap --remove-gap <gap-slug> --json` → archive gap to `spec/archive/`, then delete from `spec/gaps/`

This ensures the skill's documented pipeline matches the new two-step behavior.

---

## Impact

**Developers:** Resolved gaps are preserved for retrospective review at `spec/archive/<date>-<slug>-gap-resolved.md`. No workflow changes are required — `metta fix-gap --remove-gap <slug>` continues to work identically from the caller's perspective; the archive step is transparent.

**`GapsStore` consumers:** The `remove()` method signature is unchanged. The new `archive()` method is additive. No existing callers break.

**Git history:** Archive commits now stage two paths (`spec/gaps/` and `spec/archive/`) in a single commit, giving reviewers a complete picture of gap closure in one diff.

**Skill pipeline:** The `metta-fix-gap` SKILL.md documents the archive step so orchestrators spawned from that skill produce the correct sequence.

---

## Out of Scope

- **Changing the gap file format.** The archived file is the gap file's content copied verbatim. No new fields (e.g., `resolved_at`, `resolution_summary`) are added to the gap markdown schema.
- **Adding status tracking to gaps.** Gap files remain stateless documents. A gap is either present in `spec/gaps/` (open) or absent (resolved). No `status: resolved` field or state transition is introduced.
- **Modifying the archive directory structure.** Resolved gaps are archived as flat `.md` files directly in `spec/archive/`. The existing subdirectory convention for change archives is not applied to gap archives.
- **Retroactively archiving already-removed gaps.** Gaps deleted before this change are not recovered from git history.
- **Automatic archive on `--all` batch resolution.** The `--all` branch in `fix-gap.ts` does not call `--remove-gap` directly; it delegates to the skill pipeline. The skill pipeline's step 10 is updated to reference the archive step, so future `--all` runs through the skill will archive correctly. No separate `--all` code path change is needed in `fix-gap.ts`.

---

## Given/When/Then Scenarios

### Scenario 1: `--remove-gap` archives the gap file before deletion

**Given** a gap file exists at `spec/gaps/execution-engine-resume-parallel.md` with non-empty `title`, `claim`, and `evidence` sections  
**When** `metta fix-gap --remove-gap execution-engine-resume-parallel` is run  
**Then**:
- A file is created at `spec/archive/2026-04-06-execution-engine-resume-parallel-gap-resolved.md`
- The content of the archive file is identical to the original gap file content
- `spec/gaps/execution-engine-resume-parallel.md` no longer exists on disk
- The git commit staged in the same operation includes both the deletion under `spec/gaps/` and the new file under `spec/archive/`
- The command exits with code 0

### Scenario 2: Archive is created before deletion — partial failure does not leave orphaned state

**Given** a gap file exists at `spec/gaps/schemas-missing-negative-tests.md`  
**And** `GapsStore.archive` succeeds (writes `spec/archive/2026-04-06-schemas-missing-negative-tests-gap-resolved.md`)  
**And** `GapsStore.remove` subsequently throws an `EACCES` error  
**When** `metta fix-gap --remove-gap schemas-missing-negative-tests` is run  
**Then**:
- The archive file remains at `spec/archive/2026-04-06-schemas-missing-negative-tests-gap-resolved.md`
- `spec/gaps/schemas-missing-negative-tests.md` still exists (remove failed)
- The command reports an error and exits with a non-zero code

### Scenario 3: `GapsStore.archive()` returns the archive path

**Given** `specDir` is `/project/spec` and today's date is `2026-04-06`  
**And** a gap exists at `spec/gaps/gap-validate-redundancy.md`  
**When** `gapsStore.archive('gap-validate-redundancy')` is called  
**Then** the method:
- Returns the string `archive/2026-04-06-gap-validate-redundancy-gap-resolved.md`
- Writes the file at `/project/spec/archive/2026-04-06-gap-validate-redundancy-gap-resolved.md`
- Does NOT delete `spec/gaps/gap-validate-redundancy.md`

### Scenario 4: `--remove-gap` on a non-existent gap does not create an archive file

**Given** no file exists at `spec/gaps/does-not-exist.md`  
**When** `metta fix-gap --remove-gap does-not-exist` is run  
**Then**:
- No file is created under `spec/archive/`
- The command prints `Gap 'does-not-exist' not found`
- The command exits with code 4

### Scenario 5: Archive directory is created if it does not exist

**Given** the `spec/archive/` directory does not exist  
**And** a gap file exists at `spec/gaps/gap-context-002-strategy-not-applied.md`  
**When** `metta fix-gap --remove-gap gap-context-002-strategy-not-applied` is run  
**Then**:
- `spec/archive/` is created with `mkdir({ recursive: true })`
- The archive file is written at `spec/archive/2026-04-06-gap-context-002-strategy-not-applied-gap-resolved.md`
- The command exits with code 0

### Scenario 6: JSON output includes archive path

**Given** a gap file exists at `spec/gaps/gap-loadworkflow-cache-not-tested.md`  
**When** `metta fix-gap --remove-gap gap-loadworkflow-cache-not-tested --json` is run  
**Then** the command emits a JSON object with:
- `"removed": "gap-loadworkflow-cache-not-tested"`
- `"archived": "spec/archive/2026-04-06-gap-loadworkflow-cache-not-tested-gap-resolved.md"`
