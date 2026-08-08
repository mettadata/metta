# fix-automatic-token-recording-via-posttooluse-hook-remove

## Problem

Token usage tracking (shipped in `token-usage-tracking-finalize-report`, archived 2026-08-08) depends on a prose contract, not framework behavior. Lifecycle skills (`metta-execute`, `metta-plan`, `metta-verify`, `metta-next` — both the installed `.claude/skills/*/SKILL.md` copies and the `src/templates/skills/` sources) instruct the orchestrator: "After each subagent returns, record its reported token usage: `metta tokens record ...`". This has three structural weaknesses:

1. **Compliance-dependent.** Recording only happens if the orchestrating model remembers to run the command after every subagent return. A skipped call silently drops the record — the exact failure mode the TOKENS.md GAPS section exists to surface, but gaps today mean "the model forgot," not "something is broken."
2. **Approximate counts.** The recorded `--tokens` value is the subagent's self-reported number from its completion report — an estimate the model writes into prose — rather than the exact usage the harness measured for that run.
3. **Human/orchestrator in the loop for pure bookkeeping.** The end user's desired experience is to review `TOKENS.md` after a build; today that report is only as complete as the orchestrator's diligence across dozens of spawns.

Affected parties: metta end users reviewing per-change token spend (incomplete/inaccurate reports), skill authors (every lifecycle skill carries recording prose that bloats instructions), and the finalize report generator (`src/finalize/tokens-report-generator.ts`), whose GAPS output currently conflates model non-compliance with real coverage holes.

A known blocker compounds this: the guard-edit hook's worktree-blindness (observed 2026-08-08) shows that hooks resolving state from their invocation cwd do not correctly find the active change when work happens inside `.metta/worktrees/<change>/` — any recording hook must solve worktree-aware active-change resolution or it will misfile or drop records.

## Proposal

Make token recording deterministic framework behavior via a PostToolUse hook, then demote the prose contract. Scope:

1. **Research spike (gates the design).** Determine, against the installed Claude Code version, the exact PostToolUse payload shape for `Task`/`Agent` tool completions — specifically whether exact subagent token usage (e.g. a `usage` / `subagent_tokens` field) is exposed to hooks. Also confirm what identifying fields are available (subagent type, model, prompt/description) for mapping to `--task`, `--agent`, `--model`. The outcome decides the recording path: exact harness counts (preferred) or a documented fallback. If usage is not exposed at all, this change stops after the research finding is logged and the design is revisited — we do not ship a hook that records fabricated counts.
2. **New PostToolUse hook** at `.claude/hooks/metta-tokens-record.mjs` (mirroring the `metta-guard-bash.mjs` / `metta-session-mint.mjs` pattern: standalone `.mjs`, harness-executed, registered in `.claude/settings.json` and shipped as a template copied at build time, never inlined). On each Task-tool completion it extracts token usage from the hook payload and invokes `metta tokens record` itself. Hook failures MUST be non-blocking: a recording error never fails the Task tool call.
3. **Worktree-aware active-change resolution.** The hook (and/or `metta tokens record --change` auto-selection in `src/cli/commands/tokens.ts`) must resolve the correct change when the cwd is inside `.metta/worktrees/<change>/`, not just when it is the repo root. This fixes for the tokens path the same class of bug as the guard-edit worktree-blindness.
4. **Dedupe strategy.** During the transition, both hook-recorded and prose-recorded entries may exist for the same run. Define and implement deduplication (e.g. hook records carry a provenance/source marker in the `token_usage` record schema — a Zod schema change in `src/schemas/change-metadata.js` territory — and the report generator collapses duplicates preferring hook-sourced exact counts) so TOKENS.md never double-counts a run.
5. **Demote or remove skill prose.** Once the hook records reliably, remove (or reduce to a fallback note) the "run `metta tokens record` after each subagent returns" instruction from the four lifecycle skills and their `src/templates/skills/` sources, keeping installed copies and templates in sync.
6. **Repurpose the GAPS section** in `src/finalize/tokens-report-generator.ts`: with automatic recording, a gap means the hook missed a run — a hook-health indicator — and the report wording should say so.

## Impact

- **`src/cli/commands/tokens.ts`** — `metta tokens record` gains worktree-aware change resolution and likely a provenance/source option; existing invocation contract stays backward compatible for prose callers during transition.
- **`src/schemas/change-metadata.*` (`TokenUsageRecordSchema`)** — extended for dedupe/provenance; all writes remain Zod-validated per convention.
- **`.claude/hooks/` + `.claude/settings.json` + hook template sources** — new hook file and registration; must not interfere with existing guard hooks on the same events.
- **Lifecycle skills** (`metta-execute`, `metta-plan`, `metta-verify`, `metta-next` — installed and template copies) — recording prose demoted/removed; instruction size shrinks.
- **`src/finalize/tokens-report-generator.ts` / `src/finalize/finalizer.ts`** — dedupe-aware aggregation and reworded GAPS semantics; existing TOKENS.md consumers see the same report structure with more accurate numbers.
- **Behavioral change:** token counts shift from self-reported estimates to harness-measured values (if the payload exposes them) — historical records and new records will not be like-for-like comparable; the report should be able to distinguish them via provenance.
- **Tests** — new hook logic, resolution logic, schema change, and report dedupe each need test coverage per the 1:1 test-to-source convention.

## Out of Scope

- **Any direct hosted-model API usage** for fetching usage data — all measurement comes from the Claude Code hook payload, per the no-direct-API constraint.
- **Fixing the guard-edit hook's worktree-blindness itself** — that is its own issue; this change only makes the *tokens* path worktree-aware (shared resolution logic may be extracted, but repairing guard-edit behavior is not in scope).
- **Routing or budget enforcement based on token usage** — records remain report-data-only; nothing starts making decisions from them.
- **Backfilling or migrating historical `token_usage` records** in archived changes to the new schema/provenance model.
- **Tracking orchestrator/main-session token usage** — scope is subagent (Task tool) completions only.
- **Changing `artifact_tokens`** (context-size-vs-budget tracking) — unrelated mechanism, untouched.
- **Redesigning TOKENS.md's overall structure** — only the GAPS section semantics and dedupe-aware totals change.
