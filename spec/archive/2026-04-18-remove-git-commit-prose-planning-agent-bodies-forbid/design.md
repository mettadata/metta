# Design: remove-git-commit-prose-planning-agent-bodies-forbid

## Approach

Direct per-line edits in 8 source files + 8 deployed mirrors. No new code, no schema, no tests added.

## Components

- 7 planning-agent bodies in `src/templates/agents/` — replace commit-instruction line with orchestrator-owned language
- 1 executor body — replace checkbox-flip instruction with explicit prohibition on tasks.md modification
- 8 deployed mirrors in `.claude/agents/` — byte-identical sync

## Data Model

None.

## API Design

None.

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Subagent breaks because it can't commit | Orchestrator skills already expect to commit (Group C landed this). No orchestration break. |
| Deployed mirror drift | Sync after each edit; `diff -r` verification in summary step. |
| `tests/agents-byte-identity.test.ts` breaks | Edit source + mirror together. Test stays green. |
| Other commit prose elsewhere in agent bodies | Research surfaced exactly 9 matches (1 per agent); spot-checked. `metta-discovery` kept intentionally. |
