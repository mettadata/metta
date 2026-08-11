# fix-repo-wide-duplicate-requirement-scan

## Problem

Three capability specs carry legacy spec-merger duplication corruption — whole requirement blocks appended repeatedly by the pre-idempotency merger (the guard now at `src/finalize/spec-merger.ts:177` prevents new occurrences but does not repair old ones):

- `spec/specs/fix-issues-command/spec.md` — all 4 requirements (`fix-issue-cli-command`, `issues-store-archival`, `skill-template`, `cli-registration`) appear **3 times** each (441 lines; ~147-line block tripled)
- `spec/specs/install-init/spec.md` — 2 requirements (`init-command-drives-discovery`, `init-skill-invokes-init-command`) appear **2 times** each
- `spec/specs/user-stories/spec.md` — all 7 requirements (`Stories Artifact Phase in Standard Workflow`, `Stories Document Format`, `Stories Zod Schema and Parser`, `validate-stories CLI Command`, `Spec Parser Fulfills Field`, `Finalize Stories Gate`, `metta-product Agent`) appear **2 times** each (374 lines; ~187-line block doubled)

Diff verification confirms every duplicate copy is byte-identical to the first occurrence (differing only in trailing blank lines), so no content is at risk from deletion. Consequences of the corruption: inflated requirement counts in CLAUDE.md (fix-issues-command shows 78, install-init 20, user-stories 84), stale `spec.lock` hashes, ambiguous requirement lookups for any tooling that keys on requirement name, and wasted context tokens whenever these specs are loaded.

Anyone reading these specs — humans or the metta context engine — is affected. Same corruption family as the already-fixed `claude-statusline` and `adaptive-workflow-tier-selection` cases (issue logged during PR #76's repo-wide scan).

## Proposal

1. Dedupe each of the three spec files: keep the first occurrence of each `## Requirement:` block, delete the later byte-identical copies, and normalize trailing whitespace to a single trailing newline.
2. Regenerate `spec.lock` for each of the three capabilities so lock hashes match the repaired specs.
3. Run the refresh flow so CLAUDE.md's Active Specs requirement counts regenerate from the repaired specs.

## Impact

- `spec/specs/fix-issues-command/spec.md` + `spec.lock` — shrinks to 4 unique requirements
- `spec/specs/install-init/spec.md` + `spec.lock` — shrinks to 9 unique requirements
- `spec/specs/user-stories/spec.md` + `spec.lock` — shrinks to 7 unique requirements
- `CLAUDE.md` — Active Specs table requirement counts drop to the true values
- No TypeScript source changes; no behavior changes to the CLI

## Out of Scope

- Adding a duplicate-requirement detection gate (the issue suggests "consider pairing" — deferred to a separate change/backlog item to keep this a bounded data repair)
- Repairing any other spec files (the repo-wide scan found exactly these three remaining)
- Changes to `src/finalize/spec-merger.ts` — the idempotency guard already exists and is tested
