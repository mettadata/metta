# Summary: fix-three-deferred-review-followups

Closes three deferred review findings from `surface-time-token-budget-review-verifier-iteration-count` (Batch A) and `fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill`.

## Deliverables

1. **5 skill templates byte-identically updated** (both `.claude/skills/` and `src/templates/skills/` pairs) — removed the pre-loop `metta iteration record --phase review` call that was causing the first review round to be counted twice. Only the in-loop step (a) call remains. Files: `metta-propose`, `metta-quick`, `metta-fix-issues`, `metta-fix-gap`, `metta-auto`.
2. **`src/cli/commands/instructions.ts`** — added a status guard so `artifact_timings` / `artifact_tokens` are only stamped when the artifact status is `ready` or `in_progress` (no-op when already `complete`).
3. **`metta-guard-bash.mjs`** (both copies, byte-identical) — added `iteration` to `ALLOWED_SUBCOMMANDS`, documenting that the iteration-recording CLI is safe-by-default and doesn't need skill enforcement.

## Verification

- `diff -q` on all 6 pairs (5 skill + 1 hook) — clean
- `npx tsc --noEmit` — clean
- Targeted tests for `metta-guard-bash.test.ts`, `instructions-stamps-timings.test.ts`, `skill-iteration-record.test.ts` — 85/85 pass
