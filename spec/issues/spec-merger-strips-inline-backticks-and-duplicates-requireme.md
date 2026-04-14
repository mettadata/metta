# spec-merger strips inline backticks and duplicates requirements

**Captured**: 2026-04-14
**Status**: logged
**Severity**: high

## Symptoms
During `metta finalize --change split-metta-install-metta-init`, the merger produced `spec/specs/split-metta-install-metta-init/spec.md` with two bugs:

1. **Inline backticks stripped**: every `` `...` `` fence is removed from requirement text and scenario bullets, leaving incoherent sentences like `WHEN the user runs` with no subject.
2. **Requirements duplicated**: the 3 input requirements appear twice in the output (6 total, headers and scenarios all duplicated).
3. **Capability name**: the output directory is named after the change (`split-metta-install-metta-init`) rather than an existing or newly-declared capability. May be by design for changes that don't target a capability, but worth confirming.

## Input
`spec/changes/split-metta-install-metta-init/spec.md` — 3 requirements with `## MODIFIED:` / `## ADDED:` headers.

## Expected
- Backticks preserved verbatim.
- No duplicate headers/scenarios.
- Merged output cleanly matches source content.

## Impact
Blocks spec finalization for any change whose spec contains backticks (i.e. nearly all of them). Workaround: delete the broken `spec/specs/<change>/` output before re-finalizing.

## Affected
`src/spec/spec-merger.ts` (likely), tests under `tests/spec-merger.test.ts`.
