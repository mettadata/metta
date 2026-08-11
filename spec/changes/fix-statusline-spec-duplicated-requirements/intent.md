# fix-statusline-spec-duplicated-requirements

## Problem

`spec/specs/claude-statusline/spec.md` contains two byte-identical copies of all 9 of its requirements — 18 `## Requirement:` headers across 510 lines, with the duplicate block starting at line 258. This is legacy corruption from the pre-idempotency spec merger: the file was born duplicated at finalize commit d04ea8481, before the idempotent-ADDED guard (14f66b6fb) landed in `src/finalize/spec-merger.ts`. The current merger returns `'noop'` for already-present requirement names, so the corruption cannot recur through the append path — but the existing file remains corrupted.

Who is affected:
- Anyone editing claude-statusline requirements must apply every edit twice (PR #71 had to patch both copies).
- CLAUDE.md reports an inflated requirement count for claude-statusline (86 instead of the true count), misleading contributors and tooling that reads the Active Specs table.
- The capability's `spec.lock` hashes the corrupted content, so any regeneration workflow perpetuates the duplication.

## Proposal

1. **Dedupe** `spec/specs/claude-statusline/spec.md`: delete the duplicated block (lines 257–510), keeping the H1 plus the single canonical copy of the 9 requirements.
2. **Regenerate the claude-statusline `spec.lock`** so its content hash matches the deduped spec.
3. **Regenerate CLAUDE.md** (refresh flow) so the Active Specs requirement count for claude-statusline reflects the deduped file.
4. **Repo-wide duplicate scan (verification only):** scan every `spec/specs/*/spec.md` for repeated `## Requirement:` names and report findings. If any other capability spec is corrupted, log it as a separate issue rather than expanding this change's blast radius.

## Impact

- `spec/specs/claude-statusline/spec.md` shrinks from 510 lines / 18 requirement headers to ~256 lines / 9 requirement headers. No requirement content is added, removed, or reworded — only the duplicate copy is deleted.
- `spec/specs/claude-statusline/spec.lock` is regenerated (hash change only).
- `CLAUDE.md` Active Specs table updates the claude-statusline requirement count.
- No TypeScript source, tests, or runtime behavior change.

## Out of Scope

- Fixing the spec merger — the idempotency guard already exists (`src/finalize/spec-merger.ts:177`); this is data cleanup only.
- Deduping other capability specs — the scan reports; any hits become separate issues.
- Adding a duplicate-requirement gate to the gate-runner (candidate solution 3 in the issue). Worth considering as a follow-up backlog item, but it adds gate surface and is not required to repair this file.
