# Summary: executor-agent-must-check-off

Added one rule to the metta-executor agent prompt (template + deployed copy byte-identical) instructing it to flip `- [ ]` → `- [x]` in `spec/changes/<change>/tasks.md` as part of each task's commit.

## Files changed
- `src/templates/agents/metta-executor.md`
- `.claude/agents/metta-executor.md`

## Gates
- `npm run build` — PASS
- `npx vitest run` — 325/325 PASS

## Verification
- `diff src/templates/agents/metta-executor.md .claude/agents/metta-executor.md` — no output (byte-identical).
- Behavioral verification will happen organically: the next change to invoke metta-executor should land with checked tasks.md.

No code changes. No new tests required. Downstream projects pick up the new prompt on their next `metta install`.
