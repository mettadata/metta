# annotate-resolved-codemod-issue-won-t-fix-rationale

## Problem

The codemod issue was archived via `metta fix-issue --remove-issue`, but the archived file at `spec/issues/resolved/no-helper-codemod-for-bumping-test-fixtures-after-schema-mig.md` still has `Status: logged` (because the command moves the file without rewriting status). Readers browsing the resolved directory can't distinguish "fixed and shipped" from "closed as won't-fix" without reading prose.

## Proposal

Append a resolution note to the archived file documenting that it was closed as won't-fix with rationale: metta is language-agnostic; a TS-specific codemod belongs in separate tooling.

## Impact

- `spec/issues/resolved/no-helper-codemod-for-bumping-test-fixtures-after-schema-mig.md` — add `Status: closed (won't-fix)` and a `Resolution:` line

## Out of Scope

- Changing `metta fix-issue --remove-issue` to accept a `--reason` flag (that's a framework improvement worth a separate change)
- Any other resolved issue's annotations
