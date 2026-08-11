# UAT: fix-statusline-spec-duplicated-requirements

- **Change**: fix-statusline-spec-duplicated-requirements
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Dedupe `spec/specs/claude-statusline/spec.md`: delete the duplicated block (lines 257–510), keeping the H1 plus the single canonical copy of the 9 requirements.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Regenerate the claude-statusline `spec.lock` so its content hash matches the deduped spec.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Regenerate CLAUDE.md (refresh flow) so the Active Specs requirement count for claude-statusline reflects the deduped file.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Repo-wide duplicate scan (verification only): scan every `spec/specs/*/spec.md` for repeated `## Requirement:` names and report findings. If any other capability spec is corrupted, log it as a separate issue rather than expanding this change's blast radius.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Resolves issue `spec-specs-claude-statusline-spec-md-contains-a-full` (legacy spec corruption — duplicated requirements).

#### Step 2.1
- **Do**: Confirm: `spec/specs/claude-statusline/spec.md` — deleted the byte-identical duplicate block (former lines 257–510). File went from 510 lines / 18 `## Requirement:` headers to 256 lines / 9 headers. No requirement content was added, removed, or reworded.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `spec/specs/claude-statusline/spec.lock` — regenerated through `SpecLockManager.update()` + `parseSpec()` (the project's own lock path, run via tsx). New lock: version 19, 9 requirement entries (was 18 duplicated entries), hash `sha256:711b478bca16`. Per-requirement hashes unchanged, confirming content identity.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: `CLAUDE.md` — regenerated via `metta refresh`. claude-statusline requirement count corrected from 86 to 49 (count = MUST/SHALL keywords; the stale 86 predated PR #71's edits). Other sections refreshed as a side effect of the standard refresh flow (project, conventions, specs table, reference, workflow).
- **Observe**: behaves as described
- [ ] Pass
