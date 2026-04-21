# Correctness Review

**Verdict**: PASS_WITH_WARNINGS

## Summary

All four round-1 FAIL findings are resolved: `SKILL_ENFORCED_SUBCOMMANDS` now has the 6 spec-mandated entries with `complete`/`finalize` intentionally retained under `BLOCKED_SUBCOMMANDS`; the unified "Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands" advisory now fires unconditionally for any enforced-subcommand block (including bare `metta issue`); the audit-log schema emits exactly the 8 spec-mandated fields (`ts`, `verdict`, `subcommand`, `third`, `agent_type`, `skill_bypass`, `reason`, `event_keys`); and project-root resolution uses `event.cwd ?? process.cwd()` per the updated spec. Source and deployed hooks are byte-identical (`diff -q` clean). All 92 guard-suite tests across `metta-guard-bash.test.ts`, `cli-metta-guard-bash-integration.test.ts`, and `agents-byte-identity.test.ts` pass. Remaining issues are documentation drift in `design.md` (not a runtime or spec-compliance problem).

## Findings

### Critical

None. All four round-1 Critical findings are resolved.

- R1 finding 1 (missing `finalize`/`complete`): spec.md:5 now mandates exactly the 6 entries `{issue, fix-issue, propose, quick, auto, ship}`; hook at `src/templates/hooks/metta-guard-bash.mjs:38-40` and `.claude/hooks/metta-guard-bash.mjs:38-40` matches exactly. spec.md:5 documents the `complete`/`finalize` rationale (orchestrator-called, would require forking the orchestrator itself).
- R1 finding 2 (stderr advisory not fired for bare `metta issue`): `src/templates/hooks/metta-guard-bash.mjs:169-179` now routes any offender with `SKILL_ENFORCED_SUBCOMMANDS.has(offender.sub)` through the unified-advisory branch unconditionally. `tests/metta-guard-bash.test.ts:270-279` now asserts the advisory is present on bare `metta issue "foo"` — satisfies the scenario at spec.md:7-10.
- R1 finding 3 (audit-log schema drift): spec.md:35-45 now lists 8 fields matching the implementation (`skill_hint` dropped; `agent_type` and `skill_bypass` added). Hook at `src/templates/hooks/metta-guard-bash.mjs:109-118` emits exactly those 8 keys. `tests/metta-guard-bash.test.ts:309-321` asserts on all 8 fields; `tests/cli-metta-guard-bash-integration.test.ts:198-210` parses `verdict`, `subcommand`, `agent_type` consistent with the new schema.
- R1 finding 4 (`import.meta.url` ancestor walk): spec.md:32 now specifies "`<root>` is `event.cwd` when present in the PreToolUse payload, else `process.cwd()`". Hook at `src/templates/hooks/metta-guard-bash.mjs:107` matches exactly.

### Warnings

- `spec/changes/fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill/design.md:15` still states `SKILL_ENFORCED_SUBCOMMANDS` contains `issue, fix-issue, propose, quick, auto, ship, finalize, and complete` (8 entries). This is stale relative to the corrected spec.md:5 (6 entries). Runtime is correct; documentation should be reconciled in a follow-up.
- `spec/changes/fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill/design.md:84-106` still prescribes an 8-entry `SKILL_ENFORCED_SUBCOMMANDS` and an `ENFORCED_SKILL_MAP` with entries for `finalize` and `complete`. Stale relative to the reduced scope.
- `spec/changes/fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill/design.md:62-78` claims `metta-fix-issues`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-ship` "dispatch `metta complete`/`metta finalize` ... All enforced. After fork, all pass the `agent_type.startsWith('metta-')` check." Since `complete`/`finalize` are no longer enforced, these subcommands now pass via the pre-existing inline `METTA_SKILL=1` bypass path, not via the agent-identity path. Semantically equivalent outcome (no regression for those skills), but the prose misstates the mechanism.
- `spec/changes/fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill/design.md:160-172` still documents the 7-field audit-log shape including `skill_hint`. Stale relative to the corrected spec.md:35-45 and the implementation. Consider either regenerating design.md or adding a trailing "Amendments" note.
- `src/templates/hooks/metta-guard-bash.mjs:152-162` audit-log write on the `!offender` branch writes a single `allow_with_bypass` entry for the first non-enforced bypassed invocation in a multi-invocation chain. spec.md:32 says "Every time the guard … observes an inline `METTA_SKILL=1` prefix on a non-enforced subcommand … the hook MUST append exactly one JSON line." Literal reading supports the current one-per-event behavior because the spec phrases it as "exactly one JSON line"; however, if the intent was one-per-invocation for chains like `METTA_SKILL=1 metta refresh && METTA_SKILL=1 metta init`, the implementation under-logs. Pre-existing from round 1; flagged again as a residual clarification item, not a regression.

### Notes

- Byte-identity check: `diff -q src/templates/hooks/metta-guard-bash.mjs .claude/hooks/metta-guard-bash.mjs` exits 0 with no output. Satisfies spec.md:77-84.
- Test suite: `npx vitest run tests/metta-guard-bash.test.ts tests/cli-metta-guard-bash-integration.test.ts tests/agents-byte-identity.test.ts` reports 92/92 passing, 3/3 test files passing. User's "88 guard-suite tests" appears to reference a narrower selection; total green regardless.
- `SKILL_HINT_MAP` at `src/templates/hooks/metta-guard-bash.mjs:43-50` correctly carries only the 6 enforced entries, aligned with the reduced scope. No stale `finalize`/`complete` entries would produce misleading skill hints.
- `process.env.METTA_SKILL === '1'` unconditional early exit preserved at `src/templates/hooks/metta-guard-bash.mjs:134`, matching spec.md:21.
- `isTrustedSkillCaller` at `src/templates/hooks/metta-guard-bash.mjs:99-101` still matches `agent_type` prefix `metta-` as intended by design.md (intentionally broad so any current or future `metta-*` agent passes).
- All six SKILL.md pairs plus `metta-skill-host.md` agent pair remain byte-identical (verified in `tests/agents-byte-identity.test.ts` and the broader parity suite; tests green).
- Recommend a follow-up doc-only commit to reconcile `design.md` scope-reduction drift (or archive it as-is with a "see spec.md for authoritative constants" pointer) so future readers aren't misled by the 8-entry / `ENFORCED_SKILL_MAP` / `skill_hint` references.
