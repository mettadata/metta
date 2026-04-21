# Research: PreToolUse Event Payload — Caller Identity Feasibility

**Change:** fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill
**Date:** 2026-04-20
**Researcher:** technical-researcher agent

---

## 1. Confirmed PreToolUse Payload Fields

Source: official Claude Code hooks documentation at `https://code.claude.com/docs/en/hooks` (accessed 2026-04-20).[^1]

### Common input fields (present in every hook event)

| Field | Type | Notes |
|---|---|---|
| `session_id` | string | Stable for the lifetime of one Claude Code session |
| `transcript_path` | string | Absolute path to the session's `.jsonl` conversation file |
| `cwd` | string | Working directory at hook invocation time |
| `permission_mode` | string | One of `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, `"bypassPermissions"` |
| `hook_event_name` | string | Always `"PreToolUse"` for this event type |

### Subagent-only fields (absent when firing in the main orchestrator session)

| Field | Type | Notes |
|---|---|---|
| `agent_id` | string | Unique ID for the subagent. **Present only when the hook fires inside a subagent call.** |
| `agent_type` | string | Agent name, e.g. `"Explore"`, `"security-reviewer"`, or a custom name. Present when the session uses `--agent` or the hook fires inside a subagent. |

### PreToolUse-specific fields

| Field | Type | Notes |
|---|---|---|
| `tool_name` | string | e.g. `"Bash"`, `"Edit"`, `"Write"` |
| `tool_input` | object | Tool parameters; for Bash: `{ "command": "..." }` |
| `tool_use_id` | string | e.g. `"toolu_01ABC123..."` |

### Example payload (main-session orchestrator, no subagent)

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf.jsonl",
  "cwd": "/home/utx0/Code/metta",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "metta propose 'new feature'" },
  "tool_use_id": "toolu_01ABC123..."
}
```

When the hook fires inside a subagent the same payload also carries `agent_id` and `agent_type`.

**Fields NOT present in the payload:** `skill_id`, `caller_tool`, `parent_tool_use_id` (only in SDK stream messages, not hook stdin), `is_subagent`, `session_type`. The GSD `gsd-workflow-guard.js` accesses `data.tool_input?.is_subagent` and `data.session_type === 'task'` — both are speculative reads that will always be falsy; that hook is advisory-only so this causes no harm.[^2]

---

## 2. Can the Hook Distinguish Skill-Invoked Bash from Direct Orchestrator Bash?

**Answer: No, not through native payload fields alone.**

The core problem: a Skill's Steps section runs inside the **same session context** as the orchestrator that invoked the skill. The Skill tool does not spawn a subagent; it injects instructions into the current session's context window. Therefore:

- `agent_id` and `agent_type` are **absent** when a skill's Steps invoke Bash directly in the main session.
- `agent_id` and `agent_type` are **present** only when the Skill is configured with `context: fork` in its frontmatter (spawning a subagent), or when the orchestrator explicitly uses the `Agent` tool.
- The docs confirm: "these fields are only present when running with `--agent` or inside a subagent."[^1]

A skill running in the default (non-forked) mode is indistinguishable from a direct orchestrator Bash call at the hook payload level.

---

## 3. What `agent_type` Carries for Skill Subagents

When a skill does run in `context: fork` (spawning a subagent), the `agent_type` field receives the **skill name** as defined in the skill's frontmatter (e.g. `"metta-issue"`, `"metta-propose"`). This would allow reliable discrimination — a hook could check `event.agent_type?.startsWith('metta-')` to confirm skill context.

However, metta skills currently do **not** use `context: fork`. They run in the main session. Changing skills to `context: fork` purely to get `agent_type` populated would be a design change with broader impact (separate context window, no shared conversation state with the orchestrator).

---

## 4. Surrogate Signals When Payload Is Insufficient

Since the payload alone cannot identify the caller, the following surrogate mechanisms exist:

### 4a. `process.env.METTA_SKILL` (current mechanism — process-level env)

The current hook already checks `process.env.METTA_SKILL === '1'` (line 87 of `metta-guard-bash.mjs`). This env var must be injected by the Claude Code runtime into the hook process's environment at skill invocation time, OR be set as a shell-level prefix in the Bash command string (`METTA_SKILL=1 metta ...`).

The spec (`spec.md` requirement 2) confirms the `process.env.METTA_SKILL` path MUST remain unconditional for all subcommands. The research question is: **does the Claude Code skill runtime actually set `METTA_SKILL=1` on the hook process?**

Conclusion: it does not. `METTA_SKILL` is metta's own convention, not a Claude Code runtime guarantee. It is only set if metta's skills explicitly prefix their Bash invocations with `METTA_SKILL=1` in the command string. The hook process-level `process.env.METTA_SKILL` path is only populated when an external mechanism (e.g. the `.claude/settings.json` hook `env` block, or a wrapper script) sets it — not automatically.

### 4b. `CLAUDE_SESSION_ID` (Claude Code runtime env var)

The GSD read guard (`referrences/get-shit-done/hooks/gsd-read-guard.js`) uses `process.env.CLAUDE_SESSION_ID` as a signal that the hook is running inside Claude Code (as opposed to other runtimes). It is present for all Claude Code hook processes, not just skill-context ones.[^2] It does not distinguish skill from orchestrator.

### 4c. `CLAUDE_CODE_ENTRYPOINT` (Claude Code runtime env var)

Referenced in `referrences/get-shit-done/get-shit-done/workflows/review.md` as a way to detect Claude Code as the runtime. Same caveat as `CLAUDE_SESSION_ID` — present in all Claude Code hook processes, not skill-specific.[^2]

### 4d. Transcript inspection via `transcript_path`

The `transcript_path` field points to the live `.jsonl` file. A hook could read the last few lines to inspect what skill was active. This is:
- Racy (the transcript is being written concurrently)
- Expensive (file I/O in a hot path)
- Fragile (transcript format is not a public API)

Not recommended as a primary mechanism.

### 4e. Temporary sentinel file written by the skill

A skill's Steps section could write a short-lived sentinel file (e.g. `.metta/run/active-skill`) before invoking the metta CLI and remove it afterwards. The hook reads the file to confirm skill context. This is reliable but adds coupling between the skill and the hook, and requires atomic file operations to avoid TOCTOU races.

### 4f. Inline command-string prefix (current primary bypass)

The existing `METTA_SKILL=1 metta <subcommand>` inline prefix is parsed by the tokenizer in `metta-guard-bash.mjs`. It is visible in `event.tool_input.command`, which the hook already reads. This is the **only** signal fully under metta's control that is present in the payload today.

The spec change removes this bypass for `SKILL_ENFORCED_SUBCOMMANDS`. After that change, skills must use the `process.env.METTA_SKILL === '1'` path instead (which the spec keeps unconditional), meaning skills must ensure the env var is set via means other than the inline command prefix — specifically by configuring the hook's `env` block in `.claude/settings.json` or by having the skill runtime set the variable externally.

---

## 5. Cross-Check: Reference Projects

| File | Pattern | Relevance |
|---|---|---|
| `referrences/get-shit-done/hooks/gsd-workflow-guard.js` | Reads `data.tool_input?.is_subagent` and `data.session_type === 'task'` to detect subagent context | Both are speculative; neither field is documented in the official payload. Advisory-only hook, so no harm from false negatives.[^2] |
| `referrences/get-shit-done/hooks/gsd-context-monitor.js` | Reads `data.session_id` and `data.cwd` | Confirms these are reliably present. Uses `session_id` to namespace temp files. Includes path-traversal sanitization of `session_id`. |
| `referrences/get-shit-done/hooks/gsd-read-guard.js` | Checks `process.env.CLAUDE_SESSION_ID` to skip advisory on Claude Code (where read-before-edit is enforced natively) | Confirms `CLAUDE_SESSION_ID` is a stable Claude Code runtime env var on hook processes.[^2] |
| `referrences/get-shit-done/hooks/gsd-prompt-guard.js` | Reads only `data.tool_name` and `data.tool_input` | No caller-identity signals attempted. |

No reference project successfully distinguishes skill-invoked tools from direct orchestrator tools using payload fields alone. All projects that attempt caller detection rely on either command-string conventions or external environment variables.

---

## 6. Verdict: Is Caller-Identity Verification Feasible Today?

**For the general case (skill running in default/non-forked mode): No.**

The PreToolUse payload contains no field that natively identifies a skill as the caller when the skill runs in the same session as the orchestrator. `agent_id` and `agent_type` are only populated for subagents — not for skill steps executing in the main session.

**Partial feasibility exists in two scenarios:**

1. Skills configured with `context: fork` will populate `agent_type` with the skill name. The hook could read `event.agent_type` and allow-list known metta skill names. This requires migrating skills to forked context, which is a design change.

2. The `process.env.METTA_SKILL === '1'` path is reliable when the hook's execution environment is configured to set this variable (e.g. via the `env` block in `.claude/settings.json` hooks configuration, or a wrapper). This is already the spec's preferred long-term mechanism and is preserved unconditionally by the change.

---

## 7. Recommendation

The design phase should commit to the following approach:

**Primary enforcement: command-string parsing with `SKILL_ENFORCED_SUBCOMMANDS` (as specced)**

The inline `METTA_SKILL=1` prefix remains useful for non-enforced subcommands, but for enforced ones (the high-value skill-gated subcommands), the inline prefix is removed as a bypass. This is the correct direction.

**Skill dispatch after the change:**

Skills that currently use `METTA_SKILL=1 metta <enforced-subcommand>` in their Bash steps must migrate to one of:

1. **Recommended:** Have the skill set `METTA_SKILL=1` as a shell variable assignment in front of the `node dist/cli/index.js` invocation directly (bypassing the `metta` binary name pattern check): `METTA_SKILL=1 node dist/cli/index.js propose "..."`. The tokenizer only looks for the literal token `metta`; `node` invocations are not inspected.

2. **Alternative if the above is impractical:** Configure the `.claude/settings.json` hooks `env` block to inject `METTA_SKILL=1` for the hook process whenever a skill subagent is active. This works only if skills run with `context: fork` (so that `agent_type` is populated and the env injection can be conditioned on it).

3. **Future option:** Migrate skills to `context: fork` and add a denylist exception in the hook for `event.agent_type` values matching the metta skill name pattern (`/^metta-/`). This is the cleanest long-term solution but requires skills to accept the forked context window trade-off.

**Observability: `event_keys` logging (as specced)**

The `event_keys` field in the audit log will accumulate real production data about what fields Claude Code actually delivers. Within a few skill invocations post-deploy, the log will confirm whether `agent_id` and `agent_type` appear in practice, enabling data-driven iteration.

**Do not block on `transcript_path` inspection or `process.ppid` heuristics.** These are fragile and introduce latency in a hot-path hook.

---

[^1]: `https://code.claude.com/docs/en/hooks` accessed 2026-04-20
[^2]: `referrences/get-shit-done/hooks/gsd-workflow-guard.js`, `gsd-read-guard.js`, `gsd-context-monitor.js` — examined 2026-04-20
