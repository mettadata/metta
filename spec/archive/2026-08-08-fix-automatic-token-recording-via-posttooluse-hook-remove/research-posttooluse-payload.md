# Research: PostToolUse hook payload for Agent/Task (subagent) completions

Change: `fix-automatic-token-recording-via-posttooluse-hook-remove`
Researched: 2026-08-08, against locally installed Claude Code **2.1.226** (`claude --version`), Linux.

## Findings

### 1. Tool name: it is `Agent`, not `Task`, in the installed version

Every subagent dispatch in local transcripts is a `tool_use` with `"name": "Agent"`, and the repo's own
`metta-guard-agent-dispatch.mjs` gates on `event.tool_name !== 'Agent'`. The public hooks reference no longer
lists a `Task` matcher example at all.[^1] Older Claude Code versions used `Task`; a matcher of `Task|Agent`
is the version-safe form.

### 2. PostToolUse payload shape (documented + locally observed)

Common fields on every hook event:[^1]

- `session_id`, `transcript_path` (main-session transcript), `cwd`, `hook_event_name`, `permission_mode`, `effort`
- `agent_id`, `agent_type` — present when the tool call fires **from inside** a subagent (this is the field
  `metta-guard-bash.mjs` already relies on for Tier-1 authorization)

PostToolUse-specific fields:[^1]

- `tool_name`, `tool_input`, `tool_use_id`, and the tool result (`tool_response`)

### 3. Critical behavioral fact: all Agent dispatches in this environment launch async

Scanning **every** transcript under `~/.claude/projects/` (all projects, Claude Code 2.1.177 → 2.1.226):

- **408** Agent tool results, **all** with `toolUseResult = { agentId, canReadOutputFile, description, isAsync: true, outputFile, prompt, resolvedModel, status: "async_launched" }`
- **Zero** synchronous completed Agent results anywhere.

So the PostToolUse event for `Agent` fires at **launch time**, and its `tool_response` is the launch receipt above —
**no token usage, no result text**. The subagent's actual completion arrives later as a synthetic
`<task-notification>` user message (`<task-id>`, `<tool-use-id>`, `<output-file>`, `<status>`, `<result>` — observed
verbatim in transcript `1313f31b-…jsonl`), which is a conversation message, not a hook event.

### 4. Token usage IS measured by the harness — but not delivered to PostToolUse in practice

Three grounded facts from string/schema extraction of the installed binary
(`/home/utx0/.local/share/claude/versions/2.1.226`):

a. **A synchronous completed Agent tool result schema exists** (Zod, offset ~278384404) and is rich:

   ```
   { agentId, agentType?, content: [{type:"text", text}], resolvedModel?, modelsUsed?,
     totalToolUseCount, totalDurationMs, totalTokens,
     usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens,
              server_tool_use, service_tier, cache_creation, inference_geo?, speed?, iterations? },
     toolStats?: { readCount, searchCount, bashCount, editFileCount, linesAdded, linesRemoved, … } }
   ```

   If an Agent call ever completed synchronously, PostToolUse `tool_response` would carry exact counts —
   but per finding 3, that path is never taken in this environment.

b. **The async task-notification includes usage** in 2.1.226: the notification body is built with
   `` `<usage><agent_count>${s}</agent_count>…<subagent_tokens>${a}</subagent_tokens><tool_uses>${l}</tool_uses><duration_ms>${c}</duration_ms></usage>` ``
   — exact harness-measured `subagent_tokens` exist, but they are injected into the model's conversation
   (`mode: "task-notification"`), **not** into any hook payload.

c. **SubagentStop hook input schema** (Zod, extracted from binary; the public docs page confirms the event but
   does not document the full schema[^1]):

   ```
   hook_event_name: "SubagentStop", stop_hook_active: boolean,
   agent_id: string, agent_transcript_path: string, agent_type: string,
   last_assistant_message?: string   // "Text content of the last assistant message before stopping"
   ```
   plus the common fields (`session_id`, `cwd`, `transcript_path`, …). **No token fields** — but
   `agent_transcript_path` points at the subagent's own JSONL transcript.

   A `TaskCompleted` hook event also exists in 2.1.226 (binary-only, undocumented): payload is
   `task_id, task_subject, task_description?, teammate_name?, team_name?` — no usage, no transcript path.

### 5. Subagent transcripts carry exact per-request usage

Subagent transcripts live at `~/.claude/projects/<project-slug>/<session-id>/subagents/agent-<agentId>.jsonl`
(verified locally; `agentId` equals the task-id from the launch receipt/notification). Every assistant record
carries the full API `message.usage`:
`input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation.{ephemeral_1h,5m}, server_tool_use, service_tier, iterations`,
plus `message.model`, and per-record `attributionAgent` / `attributionSkill` fields (e.g.
`"attributionAgent": "metta-researcher", "attributionSkill": "metta-fix-issues"`) that map directly to
`--agent` / `--task` semantics. `message.model` gives `--model` exactly.

The repo already has a working precedent for parsing this: `.claude/statusline/statusline.mjs` (and its template
at `src/templates/statusline/statusline.mjs`) reads transcript JSONL and computes context size from
`record.message.usage.input_tokens + cache_read_input_tokens + cache_creation_input_tokens` (lines 36–40).

### 6. Matcher syntax and PostToolUse output semantics

- Matcher is a tool-name string/regex: `"Agent"` (or `"Task|Agent"` for cross-version safety). SubagentStop
  entries take no tool matcher; filter inside the hook on `agent_type` if scoping to `metta-*` agents.[^1]
- PostToolUse **cannot block** the tool (it already ran). Exit `0` = success (stdout may carry optional JSON:
  `decision: "block"` + `reason` feeds an error back to Claude; `hookSpecificOutput.additionalContext` /
  `updatedToolOutput` are available). Exit `2` = non-blocking error, stderr shown to Claude. Any other exit =
  non-blocking error.[^1]
- For a pure bookkeeping hook the correct contract is: **always `process.exit(0)`, write nothing to stdout** —
  matching the intent's "recording error never fails the Task tool call" requirement. Same for SubagentStop
  (where a `decision: "block"` would force the subagent to continue — never emit it).

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-08-08. Schema details not on that page were extracted
      from the installed binary `/home/utx0/.local/share/claude/versions/2.1.226` and verified against local
      transcripts; binary-derived facts are version-specific and should be re-checked on Claude Code upgrades.

## Local grounding (files inspected)

- `/home/utx0/Code/metta/.metta/worktrees/fix-automatic-token-recording-via-posttooluse-hook-remove/.claude/settings.json` —
  hooks registered only for `PreToolUse` (`Edit|Write|NotebookEdit|MultiEdit` → guard-edit, `Bash` → guard-bash); no PostToolUse/SubagentStop entries yet, so a new event block will not collide with existing guards.
- `/home/utx0/Code/metta/.metta/worktrees/fix-automatic-token-recording-via-posttooluse-hook-remove/.claude/hooks/metta-guard-bash.mjs` —
  payload fields already relied on: `tool_name`, `tool_input.command`, `tool_input.run_in_background`, `agent_type`, `cwd`; stdin-JSON + exit-code pattern to mirror.
- `/home/utx0/Code/metta/.metta/worktrees/fix-automatic-token-recording-via-posttooluse-hook-remove/.claude/hooks/metta-guard-agent-dispatch.mjs` —
  confirms tool name `Agent` and `tool_input.subagent_type` availability; also documents the standalone-`.mjs`, no-shared-lib convention.
- `/home/utx0/Code/metta/.metta/worktrees/fix-automatic-token-recording-via-posttooluse-hook-remove/.claude/statusline/statusline.mjs` —
  existing transcript-JSONL usage-parsing pattern (lines 36–40, 86–87).
- `~/.claude/projects/**/*.jsonl` + `**/subagents/agent-*.jsonl` — 408 async launch receipts, 0 sync completions, subagent per-request `message.usage`, `<task-notification>` message shape.
- `/home/utx0/.local/share/claude/versions/2.1.226` — Zod schemas for sync Agent result, SubagentStop input, TaskCompleted input; task-notification `<usage>` builder.
- `claude --version` → `2.1.226 (Claude Code)`.

## Feasibility verdict

**Partially — but yes via SubagentStop.**

- A **PostToolUse hook on `Agent` cannot obtain token counts in this environment**: every dispatch returns
  `status: "async_launched"` and the payload carries no usage. (The sync-completion payload would carry exact
  `totalTokens`/`usage`, but that path is never exercised locally.)
- **Exact harness-measured counts are obtainable by a hook**: the `SubagentStop` hook receives
  `agent_transcript_path` + `agent_type`, and the subagent transcript contains exact per-request `usage`,
  `model`, and `attributionAgent`/`attributionSkill`. Summing assistant-record usage yields exact counts with
  no model self-reporting anywhere in the loop.

The intent's stop-condition ("if usage is not exposed at all, stop after logging the finding") is **not**
triggered: usage is not in the PostToolUse payload, but it is deterministically reachable from a hook payload
field without any API calls or prose compliance.

## Recommendation

**Option A (recommended): `SubagentStop` recording hook.**
`.claude/hooks/metta-tokens-record.mjs` registered under `SubagentStop`. Filter `agent_type` prefix `metta-`
(plus optionally record all agents with the type recorded). Parse `agent_transcript_path` (statusline.mjs
pattern), sum `message.usage` across assistant records (record the components — input / output / cache-read /
cache-create — so the report can choose a totals definition), take `--model` from `message.model`, `--agent`
from `agent_type`, `--task` from `attributionSkill`/`last_assistant_message`-derived context. Invoke
`metta tokens record … --source hook` with worktree-aware change resolution. Always exit 0.
*Pros:* exact counts; fires exactly once per subagent stop; payload field is in the installed version and
docs-acknowledged; consistent with existing standalone-`.mjs` hook and transcript-parsing patterns.
*Cons:* `agent_transcript_path`'s full schema is docs-underspecified (binary-verified only) — pin behavior with
a fail-silent guard and re-verify on CC upgrades; per-request summing double-counts cached context if the
report naively adds input tokens (a totals-definition decision for design, not a blocker).

**Option B: PostToolUse on `Task|Agent` handling both shapes.** Record exact usage when `tool_response` carries
it (sync shape), skip on `async_launched`. *Pros:* matches the change title; trivially safe. *Cons:* records
nothing in practice today (0% sync completions observed) — inadequate alone; acceptable only as a complement
to A.

**Option C: `TaskCompleted` hook + derived transcript path** (`<project>/<session_id>/subagents/agent-<task_id>.jsonl`).
*Cons:* event is undocumented (binary-only) and the path derivation is convention, not contract. Rejected.

**Option D: keep prose-recorded counts.** Status quo; retains all three structural weaknesses in the intent. Rejected as primary; keep temporarily as the dedupe-transition fallback already planned.

Recommend **A**, with the intent's item 2 amended from "PostToolUse hook" to "SubagentStop hook" (same file
name, registration site, non-blocking contract, and dedupe/provenance plan all carry over unchanged).
