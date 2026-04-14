# Summary: executor-agent-must-check-off

Added one rule to the metta-executor agent prompt (template + deployed copy byte-identical) instructing it to flip `- [ ]` → `- [x]` in `spec/changes/<change>/tasks.md` as part of each task's commit.

## Files changed
- `src/templates/agents/metta-executor.md`
- `.claude/agents/metta-executor.md`

## Review (3 reviewers, parallel)
- Correctness: PASS
- Security: PASS (prompt-only edit, no surface)
- Quality: PASS_WITH_WARNINGS → two non-blocking tweaks applied (tightened imperative voice, explicit reference to Deviation Rules section)

## Verification (3 verifiers, parallel)
- `npm test` / `npx vitest run`: 325/325 PASS
- `npx tsc --noEmit` + `npm run lint`: PASS, no diagnostics
- Goal-vs-intent check: 3/3 goals satisfied with file:line citations

## Behavioral verification
Next change to invoke metta-executor should land with tasks.md checkboxes flipped — organic confirmation. No code changes to test directly.

Downstream projects pick up the new prompt on their next `metta install`.
