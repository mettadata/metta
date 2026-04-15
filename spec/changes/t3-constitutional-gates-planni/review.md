# Code Review: t3-constitutional-gates-planni

## Summary
Implementation is solid: severity handling, exit codes, overwrite semantics, spec-version resolution, and plan-skill integration all match the spec. Byte-identity of agent and skill pairs verified. A few minor correctness gaps around agent-error handling and `violations.md` on-error writes.

## Issues Found

### Critical (must fix)
- None.

### Warnings (should fix)
- `src/cli/commands/check-constitution.ts:139-149` — Scenario 10 / REQ-2.4 require that on agent failure (non-zero, timeout, unparseable) the command MUST NOT write `violations.md` with a zero-violations result. Current catch block exits 4 correctly, but because `checkConstitution` throws before `writeFile`, this is OK for provider errors; however if an unrelated failure occurs after the write it is still acceptable. Confirm provider's `generateObject` throws (not returns empty) on unparseable output — otherwise a malformed response could Zod-parse-fail inside provider and reach catch: fine. No code change needed if provider contract holds; document this assumption.
- `src/constitution/checker.ts:119-125` — `minor` violations set `justified = true` regardless of tracking entry. Harmless for exit logic, but semantically "minor" is advisory, not "justified". Consider a distinct `advisory` flag to avoid confusing the `violations.md` renderer (currently renderer only adds the Justified note for `major`, so no user-visible bug, just model smell).
- `src/cli/commands/check-constitution.ts:55-66` — `getSpecVersion` uses `HEAD:<path>` which returns the committed version, not the working-tree version actually being checked. If the user edits `spec.md` without committing and re-runs the gate, `spec_version` in frontmatter will silently point to the stale committed blob. Prefer `git hash-object spec.md` for a true content hash of what was checked.

### Suggestions (nice to have)
- `src/cli/commands/check-constitution.ts:16-18` — `escapeBackticks` replaces backticks with single quotes inside the inline-code span; this corrupts evidence containing backticks. Consider wrapping evidence in a fenced block or HTML-escaping instead.
- `src/constitution/complexity-tracking.ts:3` — `SECTION_REGEX` requires `## ` at column 0; OK, but won't match when preceded by frontmatter with no trailing blank line edge cases. Current usage is safe.
- `src/templates/skills/metta-plan/SKILL.md:20-27` — Integration placed correctly after all planning artifacts. REQ-3.4 (don't re-run research/design/tasks on re-entry) relies on step 1's `metta status` already reporting them complete — implicit but acceptable.
- Agent prompt (`metta-constitution-checker.md`) has strong injection defenses — good.

## Byte-identity verification
- `src/templates/agents/metta-constitution-checker.md` == `dist/...` == `.claude/agents/...` (sha256 `4a32bfe…`). PASS.
- `src/templates/skills/metta-check-constitution/SKILL.md` == `dist/...` (sha256 `ff23149…`). PASS.

## Verdict
PASS_WITH_WARNINGS
