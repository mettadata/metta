# UAT: fix-repo-wide-duplicate-requirement-scan

- **Change**: fix-repo-wide-duplicate-requirement-scan
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
- **Do**: Confirm: Dedupe each of the three spec files: keep the first occurrence of each `## Requirement:` block, delete the later byte-identical copies, and normalize trailing whitespace to a single trailing newline.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Regenerate `spec.lock` for each of the three capabilities so lock hashes match the repaired specs.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Run the refresh flow so CLAUDE.md's Active Specs requirement counts regenerate from the repaired specs.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Resolves issue `repo-wide-duplicate-requirement-scan-run-during-fix` (legacy pre-idempotency spec-merger duplication in 3 capability specs).

#### Step 2.1
- **Do**: Confirm: `spec/specs/fix-issues-command/spec.md` — 441 → 147 lines. The 4-requirement block was tripled (copies at lines 3–149, 150–296, 297–441); kept the first copy. All three copies re-diffed byte-identical (modulo trailing blank lines) immediately before deletion. Now exactly 4 `## Requirement:` headings, zero duplicate names.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `spec/specs/install-init/spec.md` — 246 → 206 lines. Deleted lines 68–107, the contiguous second copies of `init-command-drives-discovery` and `init-skill-invokes-init-command`, after diff-verifying identity. Now exactly 9 headings, zero duplicates; block spacing (two blank lines) preserved.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: `spec/specs/user-stories/spec.md` — 374 → 187 lines. The 7-requirement block was doubled (lines 3–189, 190–374); kept the first copy after diff verification. Now exactly 7 headings, zero duplicates.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: Three `spec.lock` files — regenerated through the project's own code path (`parseSpec` + `SpecLockManager.update()`, executed via the built `dist/` modules after diff-confirming the relevant `src/` files are identical between checkouts). Results: fix-issues-command v12→v13, 12→4 entries; install-init v11→v12, 11→9 entries; user-stories v14→v15, 14→7 entries. Zero per-requirement hash mismatches against the first entries of the old locks — machine confirmation that no content changed.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: `CLAUDE.md` — regenerated via `metta refresh` (auto-committed by the CLI). Counts: fix-issues-command 78→26 (exactly 1/3, consistent with tripling), user-stories 84→42 (exactly 1/2), install-init →39 (previous row was stale, predating requirements added since the last refresh).
- **Observe**: behaves as described
- [ ] Pass

### Generation notes

- spec.md present but contains no scenarios; falling back to intent/summary
