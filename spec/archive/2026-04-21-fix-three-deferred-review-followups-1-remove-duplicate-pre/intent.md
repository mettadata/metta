# fix-three-deferred-review-followups

## Problem

Three deferred review followups from recent metta changes remain unresolved. Each is low-risk and surgical:

1. **Double-counted first review iteration.** The five skill templates that own a review-fix loop — `metta-propose`, `metta-quick`, `metta-fix-issues`, `metta-fix-gap`, `metta-auto` — each emit `metta iteration record --phase review` in two places: once as a pre-loop "Before spawning reviewer agents, run: …" line, and again as the first in-loop step (step a). The intended design records **once per loop iteration**. The pre-loop line inflates the counter by +1 on every change and corrupts any analytics built on review-iteration counts. The same pre-loop preamble also appears on the verify side, but inspection shows it is **not** mirrored by an in-loop `iteration record --phase verify` step, so the verify preamble is not duplicated and should be preserved.

2. **Instructions command stamps timings for already-complete artifacts.** `src/cli/commands/instructions.ts` lines 89–111 unconditionally overwrite `artifact_timings[id]` and `artifact_tokens[id]` whenever `metta instructions <artifact>` is called. When a caller re-reads instructions for an artifact already marked `complete` (a valid read-only inspection), this silently stamps fresh token-budget and timing records onto a closed artifact. The spec intent is to only stamp when the artifact is still in progress (`ready` or `in_progress`).

3. **`metta iteration` falls through to the `unknown` block path.** `src/templates/hooks/metta-guard-bash.mjs` and its byte-identical pair at `.claude/hooks/metta-guard-bash.mjs` list `ALLOWED_SUBCOMMANDS` as `{status, instructions, progress, doctor, install}`. `iteration` is not listed, so a bare `metta iteration record …` call classifies as `unknown` and is blocked without a `METTA_SKILL=1` prefix — even though `iteration` is read-safe-ish instrumentation that skills call during their fan-out phases. The skill-enforced list already doesn't include `iteration`, so the only gap is the allow-list itself.

## Proposal

All three fixes are direct surface edits. No design ambiguity, no new tests required (existing hook tests and instructions tests cover the surface).

**Fix 1 — skill templates (10 files, 5 byte-identical pairs):**
- Delete the single line `   - Before spawning reviewer agents, run: \`METTA_SKILL=1 metta iteration record --phase review --change <name>\`` in each of these five pairs:
  - `src/templates/skills/metta-propose/SKILL.md` ↔ `.claude/skills/metta-propose/SKILL.md`
  - `src/templates/skills/metta-quick/SKILL.md` ↔ `.claude/skills/metta-quick/SKILL.md`
  - `src/templates/skills/metta-fix-issues/SKILL.md` ↔ `.claude/skills/metta-fix-issues/SKILL.md`
  - `src/templates/skills/metta-fix-gap/SKILL.md` ↔ `.claude/skills/metta-fix-gap/SKILL.md`
  - `src/templates/skills/metta-auto/SKILL.md` ↔ `.claude/skills/metta-auto/SKILL.md`
- Byte-identity between each template and its `.claude/` copy must be preserved.
- Verify side: confirmed NOT duplicated (no in-loop verify iteration-record step), so leave verify preamble untouched.

**Fix 2 — instructions.ts status guard:**
- In `src/cli/commands/instructions.ts`, wrap the stamp block (lines 89–111) so it only executes when the artifact's pre-invocation status is `'ready'` or `'in_progress'`. The status is already read at line 60 into `output.status` (or can be read from `metadata.artifacts[artifactId]`). Gate the entire stamp try-block — both `artifact_timings` and `artifact_tokens` writes — behind the check. Warning output and never-throw behavior preserved.

**Fix 3 — hook allow-list:**
- In both `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs`, add `'iteration'` as an entry in the `ALLOWED_SUBCOMMANDS` set (line 11–14). Byte-identity between the two files must be preserved.

## Impact

- **Skill templates:** Reviewer-loop iteration counters drop from 2 on first round → 1 on first round. Any downstream analytics reading `review_iterations` (e.g. the adaptive-workflow tier selection feature) gets corrected input.
- **instructions.ts:** Re-reading instructions for a completed artifact becomes a pure read; no silent state mutation on closed artifacts. Active (`ready` / `in_progress`) artifacts continue to get token/budget/timing stamps as before.
- **Hook:** `metta iteration record …` called without `METTA_SKILL=1` now classifies as `allow` instead of `unknown`. No security implication — `iteration` is counter-only and has no state-mutating side effect beyond incrementing a local per-change counter. The SKILL_ENFORCED list already excludes it.

No public API changes. No user-facing output changes. No schema changes.

## Out of Scope

- Changing the in-loop `iteration record` semantics (step a keeps firing once per review round — that is the design).
- Rewriting or consolidating the five skill templates (duplication between them is an existing organizing choice, unrelated to this fix).
- Adding new iteration phases or new hook allow-list entries beyond `iteration`.
- Backfilling historically inflated review-iteration counts on archived changes.
- Changing the verify-side preamble or the verify in-loop structure.
