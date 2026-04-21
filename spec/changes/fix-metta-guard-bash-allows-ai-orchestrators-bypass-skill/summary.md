# Summary: fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

Closes issue `metta-guard-bash-allows-ai-orchestrators-to-bypass-skill` (major, logged 2026-04-21). Orchestrators can no longer bypass the skill layer by prefixing `METTA_SKILL=1` inline on skill-enforced subcommands; the guard hook now requires a non-forgeable caller-identity signal (`event.agent_type.startsWith('metta-')`), which is only present when a skill runs in a forked subagent context.

## Deliverables

### New agent
1. **`src/templates/agents/metta-skill-host.md` + `.claude/agents/metta-skill-host.md`** (new, byte-identical) — minimal subagent that hosts a forked metta skill invocation with `Bash, AskUserQuestion, Read, Grep, Glob, Agent` tools. Added to `tests/agents-byte-identity.test.ts` parity array.

### Skill migration — 6 skills forked
2. `src/templates/skills/metta-issue/SKILL.md` + `.claude/skills/metta-issue/SKILL.md` — added `context: fork` + `agent: metta-skill-host`.
3. `src/templates/skills/metta-fix-issues/SKILL.md` + `.claude/skills/metta-fix-issues/SKILL.md` — same.
4. `src/templates/skills/metta-propose/SKILL.md` + `.claude/skills/metta-propose/SKILL.md` — same.
5. `src/templates/skills/metta-quick/SKILL.md` + `.claude/skills/metta-quick/SKILL.md` — same.
6. `src/templates/skills/metta-auto/SKILL.md` + `.claude/skills/metta-auto/SKILL.md` — same.
7. `src/templates/skills/metta-ship/SKILL.md` + `.claude/skills/metta-ship/SKILL.md` — same.

All pairs verified byte-identical via `diff -q`.

### Guard hook update
8. **`src/templates/hooks/metta-guard-bash.mjs` + `.claude/hooks/metta-guard-bash.mjs`** (byte-identical):
   - Added `SKILL_ENFORCED_SUBCOMMANDS = {issue, fix-issue, propose, quick, auto, ship}` and `SKILL_HINT_MAP`.
   - Added `isTrustedSkillCaller(event)` checking `event.agent_type?.startsWith('metta-')`.
   - Modified offender-finding: enforced subcommands require BOTH `inv.skillBypass` AND `isTrustedSkillCaller(event)`; otherwise block with exit 2.
   - Added `appendAuditLog(event, verdict, inv, reason)` writing JSON lines to `<cwd>/.metta/logs/guard-bypass.log` for every block and every observed inline bypass on non-enforced subcommands. Errors swallowed silently (audit never breaks the hook).
   - New stderr message for enforced-blocks naming the matching skill (`/metta-issue`, `/metta-fix-issues`, etc.) and the sentence "Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool."

### Tests
9. **`tests/metta-guard-bash.test.ts`** — extended helpers (`bashEvent` + `runHook` accept `agent_type` and `cwd`) and added 9 new cases covering: enforced block without agent_type; allow with `metta-skill-host`; allow with `metta-issue`; block with `other-agent`; legacy block; non-enforced inline bypass; allowed subcommand writes no log; audit log schema after block; audit log after allow-with-bypass. Runs against both source and deployed hook copies.
10. **`tests/cli-metta-guard-bash-integration.test.ts`** — added 3 end-to-end cases: main-session direct block, subagent-dispatched allow, audit log populated across flows. Existing 8 integration tests still pass (they use process-env bypass, not inline).
11. **`tests/agents-byte-identity.test.ts`** — `metta-skill-host` added to parity array.

### Documentation
12. **`CLAUDE.md`** — appended a paragraph under the "Forbidden" section documenting the new agent_type enforcement and audit log location.

## Verification state

- `npx tsc --noEmit` clean
- `npx vitest run` — 861/861 tests green across 60 files
- `diff -q` pairs byte-identical: agents/metta-skill-host.md, 6 SKILL.md pairs, metta-guard-bash.mjs
- Audit log populated as expected in tempDir during integration tests

## Non-goals honored

- No Claude Code harness changes (we work with what the platform provides).
- No changes to the `metta` CLI command surface — enforcement lives in the hook.
- No migration of past bypass occurrences; forward-only.
- No changes to the emergency bypass path (disable the hook in `.claude/settings.local.json` still works).
- No changes to the `process.env.METTA_SKILL === '1'` belt-and-suspenders path — it still exempts the hook process entirely when set (used by a few existing test harnesses).

## Residual risk

An orchestrator with Agent tool access could spawn `metta-skill-host` directly as a subagent and dispatch an enforced CLI call. This raises the bar significantly (multi-step vs single inline prefix) and the audit log surfaces any such attempts for review. Accepted as residual — a perfect fence would require harness-level changes outside metta's control.
