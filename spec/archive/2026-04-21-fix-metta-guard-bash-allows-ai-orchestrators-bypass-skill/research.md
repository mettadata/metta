# Research: fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

## Decision: `context: fork` skill migration + `event.agent_type` verification + fail-closed fallback + audit log

Three axes investigated. Per-axis detail:

- [research-pretooluse-event-payload.md](research-pretooluse-event-payload.md) — what Claude Code hooks actually receive
- [research-skill-dispatch-alternatives.md](research-skill-dispatch-alternatives.md) — affected skills + alternative dispatches
- [research-audit-log-format.md](research-audit-log-format.md) — log schema, path, concurrency

### Axis 1 — PreToolUse event payload

**Confirmed fields on every hook event**: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, plus PreToolUse-specific `tool_name`, `tool_input`, `tool_use_id`. **Subagent-only**: `agent_id`, `agent_type`.

**Critical finding**: the Skill tool does NOT spawn a subagent by default — it injects instructions into the current session context. So `agent_type` is absent when a skill's Steps run inline, and the payload is indistinguishable from a direct orchestrator Bash call.

**BUT**: when a skill's frontmatter declares `context: fork`, the skill runs as a subagent with an isolated context window, and `event.agent_type` IS populated with the skill's name (e.g. `"metta-issue"`). This is a robust, non-forgeable caller-identity signal — the orchestrator cannot fake `agent_type` because it's set by the Claude Code runtime when the Agent tool dispatches the fork.

### Axis 2 — Skill dispatch alternatives

11 skills with 47 occurrences of `METTA_SKILL=1 metta <enforced-cmd>` across `.claude/skills/` and `src/templates/skills/` (trees byte-identical). Enforced subcommands hit: `issue`, `fix-issue`, `propose`, `quick`, `complete`, `finalize`.

Five alternatives scored. Key observations:
- **Alt 5 ($CLAUDE_ENV_FILE + SessionStart hook)** was the researcher's top pick, but on reflection it's flawed: it would make `process.env.METTA_SKILL === '1'` true on the hook for the WHOLE session, meaning the orchestrator's own direct Bash calls would also pass through. That effectively disables the guard.
- **Alt 1 (dispatcher wrapper `.mjs`)** — forgeable.
- **Alt 2 (session lock file)** — forgeable with effort.
- **Alt 3 (Node direct import)** — brittle.
- **Alt 4 (`METTA_INTERNAL` + allowlist)** — forgeable.

All five user-space alternatives are forgeable because the orchestrator and the skill Steps both run inside the same session context window with identical authority.

**The only non-forgeable signal is `event.agent_type`** — and it requires skill migration to `context: fork`.

### Axis 3 — Audit log format

Schema finalized: `{ ts, verdict, subcommand, third, skill_hint, reason, event_keys }`.
- `ts` = `new Date().toISOString()` (matches metta's existing timestamp convention).
- `event_keys = Object.keys(event)` — serves as forward observability for payload evolution.
- **No raw command** — privacy concern (commands may contain issue descriptions, proposal titles with sensitive context).
- Log path: `<projectRoot>/.metta/logs/guard-bypass.log`. Directory lazy-created via `mkdirSync({ recursive: true })`.
- `fs.appendFileSync` is atomic for writes under PIPE_BUF (4096 bytes) on POSIX local filesystems — each JSON line is ~300 bytes, safe under concurrent hook invocations.
- Retention: unbounded for now; future `metta cleanup` can consume `config.cleanup.log_retention_days`.

## Rationale

The three axes converge on one architecture:

1. **Skills that dispatch skill-enforced subcommands MUST run as subagents** (`context: fork` in frontmatter). This gives the hook a non-forgeable caller-identity signal via `event.agent_type`.
2. **The hook verifies caller identity before honoring any `METTA_SKILL=1` bypass for enforced subcommands**. If `event.agent_type?.startsWith('metta-')` is true AND the subcommand is enforced, allow. If the subcommand is enforced and the caller identity cannot be verified, block with exit 2 regardless of inline prefix.
3. **Every decision — allow, block, bypass-detected — writes one JSON line to `.metta/logs/guard-bypass.log`** so project owners get visibility and `event_keys` evolves as Claude Code's payload does.
4. **Non-enforced subcommands retain today's inline-bypass behavior** — we're not tightening commands that have no matching skill.

This closes the "zero shortcuts around the CLI" goal for the enforced subcommands because the orchestrator cannot fake `agent_type`. Skills that don't touch enforced subcommands don't need migration.

## Scope implications

- **Skill migration**: every skill in `.claude/skills/` and `src/templates/skills/` that dispatches an enforced subcommand gets a frontmatter edit adding `context: fork`. Both copies must stay byte-identical.
- **Hook edits**: add `SKILL_ENFORCED_SUBCOMMANDS` set, add caller-identity check, add audit log.
- **Tests**: unit tests for both the block-without-identity and allow-with-identity paths; integration tests with a mocked `agent_type` in the event payload.
- **Docs**: update `CLAUDE.md` to state that `/metta-<skill>` invocation is the only legitimate path for enforced subcommands (already says this; the hook now actually enforces it).

## Artifacts produced

- [research-pretooluse-event-payload.md](research-pretooluse-event-payload.md) — payload field audit, subagent detection mechanics.
- [research-skill-dispatch-alternatives.md](research-skill-dispatch-alternatives.md) — affected-skill inventory, 5-way dispatch comparison.
- [research-audit-log-format.md](research-audit-log-format.md) — log schema, path, concurrency, test approach.
