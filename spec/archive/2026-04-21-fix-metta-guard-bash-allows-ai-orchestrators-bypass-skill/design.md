# Design: fix-metta-guard-bash-allows-ai-orchestrators-bypass-skill

## Approach

The fix is a two-layer architecture that closes the inline-env-var bypass for the six skill-enforced subcommands while preserving backward compatibility for every other code path.

### Layer 1 — Skill migration to `context: fork`

The six skills that dispatch skill-enforced subcommands (`metta-issue`, `metta-propose`, `metta-quick`, `metta-auto`, `metta-fix-issues`, `metta-ship`) must each run as a Claude Code subagent by adding `context: fork` and `agent: metta-skill-host` to their frontmatter. When Claude Code forks a skill, it populates `event.agent_type` in the PreToolUse event with the agent name. Because `agent_type` is set by the Claude Code runtime — not by the command string the orchestrator writes — it is a non-forgeable caller-identity signal. An orchestrator operating outside any skill context cannot produce a PreToolUse event that carries `agent_type: 'metta-skill-host'`.

A new minimal subagent definition `metta-skill-host` acts as the `agent:` target for all six skills. It declares the tool permissions the skills need (Bash, AskUserQuestion, Read, Grep, Glob, Agent) and carries a short persona that explains its role.

### Layer 2 — Hook enforcement via `classifyWithIdentity`

`src/templates/hooks/metta-guard-bash.mjs` gains a named constant `SKILL_ENFORCED_SUBCOMMANDS` containing `issue`, `fix-issue`, `propose`, `quick`, `auto`, `ship`, `finalize`, and `complete`. For any invocation whose subcommand is a member of this set, the hook evaluates caller identity: it allows the call only when BOTH `inv.skillBypass === true` AND `event.agent_type?.startsWith('metta-')`. If either condition is absent, the hook exits 2 and names the required skill.

For subcommands in `BLOCKED_SUBCOMMANDS` but NOT in `SKILL_ENFORCED_SUBCOMMANDS` (specifically `fix-gap`, `refresh`, `import`, `init`), the existing inline `METTA_SKILL=1` bypass continues to work unchanged. The `process.env.METTA_SKILL === '1'` belt-and-suspenders path (current line 87) remains unconditional and exits 0 before any subcommand inspection — it is controlled by the Claude Code runtime, not by the command string, and the spec mandates it is not restricted.

### Layer 3 — Audit log

Every block decision and every observed bypass on a non-enforced subcommand writes one JSON line to `<projectRoot>/.metta/logs/guard-bypass.log`. The file is append-only; the hook never reads it. The `event_keys` field captures the current payload's top-level key names for forward observability: as Claude Code adds fields, the log reflects them before the hook is updated to use them.

### Parity constraint

`src/templates/hooks/metta-guard-bash.mjs` is the canonical source. `.claude/hooks/metta-guard-bash.mjs` must be byte-for-byte identical at every commit. The same byte-identity constraint applies to each skill pair and to the new agent definition pair.

### Verdict on the five user-space dispatch alternatives from research

All five alternatives investigated during research (dispatcher wrapper, session token file, Node direct import, `METTA_INTERNAL` allowlist, `$CLAUDE_ENV_FILE` + SessionStart hook) are forgeable by the orchestrator with one to a few additional Bash calls. The `context: fork` + `agent_type` approach is the only non-forgeable signal because `agent_type` is set by the Claude Code runtime, not by the orchestrator's tool input. The research-recommended Alternative 5 (`$CLAUDE_ENV_FILE`) was also evaluated during the research synthesis but rejected in `research.md` because it would make `process.env.METTA_SKILL === '1'` true for the entire session, undermining the guard for the orchestrator's own subsequent direct calls.

---

## Components

### 1. `src/templates/agents/metta-skill-host.md` (NEW) and `.claude/agents/metta-skill-host.md` (NEW, byte-identical)

Responsibility: minimal subagent definition that provides the tool permissions the six forked skills need. Serves as the `agent:` target in each skill's `context: fork` frontmatter. No custom logic — pure declarative capability grant. Both files must be byte-identical; a test asserts this.

Frontmatter keys: `name`, `description`, `model` (sonnet), `tools` (Bash, AskUserQuestion, Read, Grep, Glob, Agent). Body: a short persona that describes the role, notes that `agent_type` is set by the Claude Code runtime when this agent is spawned, and states that CLI calls from this agent are allowed by the guard hook.

### 2. `src/templates/skills/metta-issue/SKILL.md` and `.claude/skills/metta-issue/SKILL.md` (MODIFIED, byte-identical pair)

Responsibility: add `context: fork` and `agent: metta-skill-host` to the existing frontmatter block. No body changes. Current frontmatter:

```
name: metta:issue
description: Log an issue with root-cause analysis
allowed-tools: [Bash, AskUserQuestion, Read, Grep, Glob]
```

After change, frontmatter adds:

```
context: fork
agent: metta-skill-host
```

The `METTA_SKILL=1 metta issue "$TITLE" --severity <level>` dispatch in Step 7 remains unchanged in the body. When this skill runs as a forked subagent, the hook sees `event.agent_type === 'metta-issue'` (the `name` field from the skill frontmatter) — which passes `startsWith('metta-')`. The inline `METTA_SKILL=1` prefix satisfies the `inv.skillBypass` condition.

### 3. `src/templates/skills/metta-fix-issues/SKILL.md` and `.claude/skills/metta-fix-issues/SKILL.md` (MODIFIED, byte-identical pair)

Same frontmatter edit as component 2. Current name: `metta:fix-issues`. The forked subagent will carry `agent_type: 'metta-fix-issues'` (the name from frontmatter, colon prefix stripped per Claude Code convention — confirmed via the research payload documentation). Dispatches `metta propose`, `metta complete`, `metta finalize`, `metta fix-issue`, and `metta fix-issue --all`. All are in `SKILL_ENFORCED_SUBCOMMANDS`. After fork, all pass the `agent_type.startsWith('metta-')` check.

### 4. `src/templates/skills/metta-propose/SKILL.md` and `.claude/skills/metta-propose/SKILL.md` (MODIFIED, byte-identical pair)

Same frontmatter edit. Current name: `metta:propose`. Dispatches `metta propose`, `metta complete`, `metta finalize`. All enforced. After fork, `agent_type: 'metta-propose'`.

### 5. `src/templates/skills/metta-quick/SKILL.md` and `.claude/skills/metta-quick/SKILL.md` (MODIFIED, byte-identical pair)

Same frontmatter edit. Current name: `metta:quick`. Dispatches `metta quick`, `metta complete`, `metta finalize`. All enforced. After fork, `agent_type: 'metta-quick'`.

### 6. `src/templates/skills/metta-auto/SKILL.md` and `.claude/skills/metta-auto/SKILL.md` (MODIFIED, byte-identical pair)

Same frontmatter edit. Current name: `metta:auto`. Dispatches `metta propose`, `metta complete`, `metta finalize`. All enforced. After fork, `agent_type: 'metta-auto'`.

### 7. `src/templates/skills/metta-ship/SKILL.md` and `.claude/skills/metta-ship/SKILL.md` (MODIFIED, byte-identical pair)

Same frontmatter edit. Current name: `metta:ship`. Dispatches `metta finalize` (both dry-run and real). `finalize` is in `SKILL_ENFORCED_SUBCOMMANDS`. After fork, `agent_type: 'metta-ship'`.

### 8. `src/templates/hooks/metta-guard-bash.mjs` and `.claude/hooks/metta-guard-bash.mjs` (MODIFIED, byte-identical pair)

Responsibility: primary enforcement. Four targeted edits to the existing 122-line file:

**(a)** Add `SKILL_ENFORCED_SUBCOMMANDS` constant immediately after the existing `BLOCKED_TWO_WORD` declaration:

```js
const SKILL_ENFORCED_SUBCOMMANDS = new Set([
  'issue', 'fix-issue', 'propose', 'quick', 'auto',
  'ship', 'finalize', 'complete',
]);
```

**(b)** Add a lookup table `ENFORCED_SKILL_MAP` that maps each enforced subcommand to the skill name shown in rejection messages:

```js
const ENFORCED_SKILL_MAP = new Map([
  ['issue',    '/metta-issue'],
  ['fix-issue','/metta-fix-issues'],
  ['propose',  '/metta-propose'],
  ['quick',    '/metta-quick'],
  ['auto',     '/metta-auto'],
  ['ship',     '/metta-ship'],
  ['finalize', '/metta-ship'],
  ['complete', '/metta-complete'],
]);
```

**(c)** Replace the existing offender-finding logic with a call to `classifyWithIdentity(inv, event)`. The function signature is:

```js
function classifyWithIdentity(inv, event) {
  const base = classify(inv);
  if (base === 'allow') return 'allow';
  if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
    const callerIsSkill = event.agent_type?.startsWith('metta-') === true;
    if (inv.skillBypass && callerIsSkill) return 'allow';
    return 'block_enforced';
  }
  if (base === 'block' && inv.skillBypass) return 'allow_with_bypass';
  return base; // 'block' | 'unknown'
}
```

The offender search becomes: `invocations.find(inv => classifyWithIdentity(inv, event) !== 'allow')`.

**(d)** After determining the final verdict, call `appendAuditLog(event, verdict, inv)` before writing to stderr and exiting. A `block_enforced` verdict maps to `"block"` in the log. An `allow_with_bypass` verdict is logged before the early exit (for non-enforced bypassed calls). Allowed read-only calls do not reach the log path.

The rejection stderr message for a `block_enforced` verdict must include: the subcommand name, the matching skill from `ENFORCED_SKILL_MAP`, the exact sentence `Inline METTA_SKILL=1 prefix no longer bypasses skill-enforced subcommands — use the Skill tool.`, and the standard emergency-bypass hint `Emergency bypass: disable this hook in .claude/settings.local.json.`

### 9. `tests/metta-guard-bash.test.ts` (MODIFIED)

Existing test file; extends both the `source hook` and `deployed hook` describe blocks with:

- (i) Enforced subcommand + `METTA_SKILL=1` inline + no `agent_type` in event → exit code 2, stderr contains `/metta-issue`.
- (ii) Enforced subcommand + `METTA_SKILL=1` inline + `agent_type: 'metta-skill-host'` → exit code 0 (allowed).
- (iii) Non-enforced blocked subcommand + `METTA_SKILL=1` inline → exit code 0, log file receives one `allow_with_bypass` line.
- (iv) Allowed read-only subcommand (`metta status`) → exit code 0, no log line written.
- (v) `process.env.METTA_SKILL === '1'` on hook process → exit code 0 for any enforced subcommand (belt-and-suspenders path).

Each test that exercises log output must create a `mkdtemp` scratch directory with a `.metta/` sub-directory and pass it as `cwd` to `spawnSync`, so log writes go to an isolated location. Cleanup via `afterEach`.

### 10. `tests/cli-metta-guard-bash-integration.test.ts` (MODIFIED)

Existing integration tests. Those that previously injected a synthetic `{ tool_name, tool_input }` payload for enforced subcommand calls must be extended to also inject `agent_type: 'metta-skill-host'` when simulating a legitimate skill dispatch, and must confirm a bare call (no `agent_type`) now returns exit code 2 rather than 0. Tests that exercise `metta finalize` and `metta complete` via this file fall into this category.

### 11. `tests/agents-byte-identity.test.ts` (MODIFIED)

Add `metta-skill-host` to the parity list alongside the existing agent pairs so a missing or diverged `.claude/agents/metta-skill-host.md` fails the suite.

### 12. `CLAUDE.md` "Forbidden" section (MODIFIED)

Add one sentence after the existing `/metta-<skill>` rule: "Enforcement is now active at the PreToolUse layer — the guard hook verifies `event.agent_type` for skill-enforced subcommands and blocks any call that does not originate from a forked `metta-skill-host` subagent."

---

## Data Model

### Audit log entry schema

The hook appends exactly one JSON line per loggable event to `<projectRoot>/.metta/logs/guard-bypass.log`. The project root is resolved by traversing upward from `import.meta.url` to find the nearest ancestor that contains a `.metta/` directory; if no such ancestor is found, `process.cwd()` is used as the fallback. The `.metta/logs/` directory is created lazily via `fs.mkdirSync(logsDir, { recursive: true })` before the first write.

```typescript
interface AuditEntry {
  ts: string;           // new Date().toISOString() — ISO 8601 with ms and Z suffix
  verdict: 'block' | 'allow_with_bypass';  // 'block_enforced' maps to 'block' in the log
  subcommand: string;   // first metta subcommand token, e.g. 'issue'
  third: string | null; // second positional argument when present, e.g. 'list' in 'metta issues list'; null otherwise
  skill_hint: string | null; // matched skill name from ENFORCED_SKILL_MAP, e.g. '/metta-issue'; null for non-enforced
  reason: string;       // short classifier string, e.g. 'skill-enforced block: no agent_type', 'inline bypass on non-enforced subcommand'
  event_keys: string[]; // Object.keys(event) — observability for payload evolution
}
```

The schema exactly matches the authoritative shape defined in `spec.md` lines 34–44. No `command` field (raw command string is excluded to avoid PII leakage as established in `research-audit-log-format.md` section 4d). No additional top-level keys.

Write call: `fs.appendFileSync(logPath, JSON.stringify(entry) + '\n')`. Single synchronous `write()` syscall; the resulting payload is under 512 bytes, well below POSIX PIPE_BUF (4096 bytes), ensuring atomicity under concurrent hook invocations on Linux local filesystems.

### `metta-skill-host` subagent frontmatter shape

```yaml
---
name: metta-skill-host
description: Runs a forked metta skill in an isolated context with the tools the skill needs.
model: sonnet
tools: Bash, AskUserQuestion, Read, Grep, Glob, Agent
---
You are the subagent that hosts a single metta skill invocation. You receive the skill's content as your prompt. Execute each numbered step faithfully. When dispatching CLI calls, the guard hook allows your invocations because the Claude Code runtime sets `agent_type` to your name, satisfying the `agent_type.startsWith('metta-')` check.
```

`model: sonnet` matches the convention of all existing agents under `.claude/agents/` (e.g. `metta-proposer.md` line 3).

### Skill frontmatter delta (same for all six skills)

Add exactly two keys to each skill's existing frontmatter:

```yaml
context: fork
agent: metta-skill-host
```

No other frontmatter keys change. The `allowed-tools` key present in skill frontmatter governs what the skill itself may use; the `tools` key in the agent definition governs what the forked subagent may use. Both must permit Bash so the final CLI dispatch step runs. `AskUserQuestion` must be permitted in both because `metta-issue` step 2 and step 3 use it.

---

## API Design

### Hook external contract (unchanged)

- Exit 0: call allowed; Claude Code proceeds with the Bash tool call.
- Exit 2: call blocked; Claude Code surfaces stderr to the orchestrator as the rejection reason.
- Exit non-zero other: treated as error by Claude Code; hook should not produce these.
- stdin: JSON object matching the PreToolUse event schema.
- stderr: human-readable rejection message.

Nothing in this change alters this contract from the caller's perspective.

### New function `classifyWithIdentity(inv, event)` → `'allow' | 'block_enforced' | 'allow_with_bypass' | 'block' | 'unknown'`

Evaluates a single tokenized invocation against the enforced-subcommand set and caller identity signal.

Rules in priority order:
1. `classify(inv) === 'allow'` → return `'allow'` (allowed read-only; no audit log).
2. `SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)` AND `inv.skillBypass === true` AND `event.agent_type?.startsWith('metta-') === true` → return `'allow'` (legitimate skill dispatch via forked subagent).
3. `SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)` AND (missing `inv.skillBypass` OR missing/mismatched `agent_type`) → return `'block_enforced'` (triggers exit 2 with enforced-subcommand message and audit log entry with `verdict: 'block'`).
4. `classify(inv) === 'block'` AND `inv.skillBypass === true` AND `!SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)` → return `'allow_with_bypass'` (non-enforced subcommand with inline bypass; triggers audit log entry with `verdict: 'allow_with_bypass'` then exit 0).
5. Otherwise → return `classify(inv)` unchanged (`'block'` or `'unknown'`; existing exit-2 paths).

### New function `appendAuditLog(event, verdict, inv, reason)` → `void`

Synchronous; called once per non-allow verdict or observed bypass. Creates `.metta/logs/` if absent. Appends one newline-terminated JSON line. Does not throw — any write error is silently swallowed to avoid disrupting the hook's primary enforcement path.

### Skill invocation contract

Orchestrator invokes `/metta-issue "description"` via the Skill tool. Claude Code resolves the skill's frontmatter, sees `context: fork` and `agent: metta-skill-host`, and spawns `metta-skill-host` as a subagent. The subagent receives the skill body as its prompt and executes the numbered steps. When the subagent reaches Step 7 and issues the Bash tool call `printf '%s' "$BODY" | METTA_SKILL=1 metta issue "$TITLE" --severity <level>`, the PreToolUse hook fires with `event.agent_type === 'metta-issue'` (the skill's `name` field, with colon prefix translated to hyphen by Claude Code's naming convention). The tokenizer finds `METTA_SKILL=1` → sets `inv.skillBypass = true`. `classifyWithIdentity` receives `inv.skillBypass === true` and `event.agent_type.startsWith('metta-')` → returns `'allow'`. No audit log entry. CLI subprocess runs.

---

## Dependencies

### Internal

- `src/templates/hooks/metta-guard-bash.mjs` — primary change target; `.claude/hooks/metta-guard-bash.mjs` is its byte-identical deployed copy.
- Six skill SKILL.md pairs — frontmatter edit only; body content unchanged.
- New `src/templates/agents/metta-skill-host.md` and `.claude/agents/metta-skill-host.md` — new files with no dependencies on any other source file.
- `tests/metta-guard-bash.test.ts` and `tests/cli-metta-guard-bash-integration.test.ts` — test files that exercise the hook via `spawnSync('node', [hookPath], ...)`.
- `tests/agents-byte-identity.test.ts` — existing parity test extended with one new entry.
- `CLAUDE.md` — documentation update only; no code dependency.

### External

None. The hook is a standalone `.mjs` file with zero npm dependencies (it uses only `node:fs` from the Node.js standard library). No new npm packages are introduced. No build process changes — the hook is consumed directly from disk, not compiled. The `context: fork` and `agent:` frontmatter fields are documented Claude Code features (source: `https://code.claude.com/docs/en/skills` accessed 2026-04-20, cited in `research-pretooluse-event-payload.md`).

### Vendor lock-in flag

`context: fork` and `agent_type` are Claude Code-specific features. If metta were ported to a different AI coding runtime, the identity-verification layer would need to be re-implemented using whatever caller-identity signal that runtime exposes (or degraded to fail-closed with no bypass). This is accepted: the guard hook is already Claude Code-specific (it reads a Claude Code PreToolUse event schema). No new lock-in is introduced beyond what already exists.

---

## Risks and Mitigations

### Risk 1: `context: fork` skills lose main-session context

Skills running in a forked subagent get an isolated context window. They cannot read conversation history from the orchestrator session that invoked them.

Mitigation: the six affected skills accept their inputs exclusively via `$ARGUMENTS` (e.g. the description string or issue slug) and surface any questions to the user via `AskUserQuestion`. None of them consume prior orchestrator context to do their work. `metta-issue` step 1 parses `$ARGUMENTS` for the title and `--quick` flag; steps 2–3 collect anything missing via `AskUserQuestion`. `metta-ship` reads only the active change name, which it discovers via `metta finalize --dry-run`. This risk is therefore low. If any skill is found to require main-session context during implementation testing, the fallback is to pass that context explicitly as part of `$ARGUMENTS` before invoking the skill.

### Risk 2: `AskUserQuestion` in a forked subagent may behave differently

The Claude Code docs confirm `AskUserQuestion` is available to subagents, but the interaction model (how the question surfaces to the human user) has not been empirically validated for forked skill contexts.

Mitigation: each skill must be run end-to-end through the actual Claude Code skill flow after the frontmatter migration, specifically exercising the `AskUserQuestion` paths. If questions do not surface correctly, the fallback is to have the orchestrator collect all questions before invoking the skill and pass answers as structured `$ARGUMENTS`, which eliminates the in-skill `AskUserQuestion` calls. This fallback is less ergonomic but preserves correctness.

### Risk 3: Performance — subagent spawn overhead on every skill invocation

Forking a subagent incurs Claude Code startup latency (~1–2 seconds) plus additional token cost for the forked context window initialization, compared to inline skill execution.

Mitigation: this cost is accepted as the price of non-forgeable caller-identity verification. It should be documented in `CLAUDE.md` and surfaced in the user-facing skill descriptions so users are not surprised. The overhead is per-skill-invocation (not per hook call), and the skills are infrequently invoked relative to normal Bash calls.

### Risk 4: Orchestrator can bypass by spawning `metta-skill-host` directly via the Agent tool

An orchestrator that understands the hook's `agent_type.startsWith('metta-')` check could invoke `Agent(subagent_type: 'metta-skill-host', prompt: 'METTA_SKILL=1 metta issue ...')` to produce a PreToolUse event with the matching `agent_type`.

Mitigation: this attack requires the orchestrator to (a) know the hook's source code, (b) explicitly reconstruct the skill's protocol or at minimum the single CLI dispatch step, and (c) emit an Agent tool call — an observable action in the transcript. This is a substantially higher barrier than the current zero-cost inline token forgery (`METTA_SKILL=1 metta issue "foo"`). The audit log's `event_keys` field will also surface any `agent_type` present, so post-hoc review can detect such attempts. This change is a "raise the bar" fix, not a perfect cryptographic fence. Residual risk is accepted.

### Risk 5: Skill test suite failures after frontmatter migration

Tests that assert on skill frontmatter content, simulate inline skill execution (no `context: fork`), or check that the guard allows a specific payload may fail after migration.

Mitigation: the implementation phase must run the full test suite (`npm test`) immediately after the frontmatter edits, before touching the hook logic. The `tests/cli-metta-guard-bash-integration.test.ts` file explicitly tests skill-dispatch scenarios with synthetic event payloads; those tests need the `agent_type` injection described in component 10. Failing tests must be updated in the same commit as the frontmatter edits, not deferred.

### Risk 6: `tests/cli-metta-guard-bash-integration.test.ts` uses synthetic payloads without `agent_type`

Current integration tests inject `{ tool_name: 'Bash', tool_input: { command: '...' } }` payloads. After this change, the same payloads that simulate a legitimate skill dispatch will be blocked because they carry no `agent_type`.

Mitigation: the test helper function for constructing event payloads must be extended to accept an optional `agentType` parameter: `bashEvent(command, { agentType?: string })`. Tests simulating legitimate skill dispatches pass `agentType: 'metta-skill-host'`; tests simulating direct orchestrator calls omit it (default behavior). This is a one-line change per affected test case, localized to the helper and its callers.

### Risk 7: `.metta/logs/` directory creation races under concurrent hook invocations

Multiple PreToolUse hooks can fire simultaneously if Claude Code issues parallel Bash tool calls. Both hook processes may attempt `mkdirSync` and `appendFileSync` at the same time.

Mitigation: `fs.mkdirSync(logsDir, { recursive: true })` is idempotent — the second call to create an already-existing directory succeeds silently on both Linux and macOS. `fs.appendFileSync` opens the file with `O_APPEND`, and each JSON line is under 512 bytes, well within POSIX PIPE_BUF (4096 bytes on Linux). The kernel guarantees that a single `write()` syscall under PIPE_BUF to an `O_APPEND`-opened file is atomic. Line interleaving cannot occur. No locking or temp-file-rename is needed (per `research-audit-log-format.md` section 5).

### Risk 8: `agent_type` field name translation from skill frontmatter

The skill `name` field in SKILL.md uses colon notation (e.g. `metta:issue`). The `agent:` field in SKILL.md that names the agent definition uses hyphen notation (e.g. `metta-skill-host`). Research confirms that `event.agent_type` is populated with the agent name as defined in the agent definition file, not the skill `name` field. When `agent: metta-skill-host` is declared in the skill frontmatter, `event.agent_type` will be `'metta-skill-host'`, which passes `startsWith('metta-')`.

Mitigation: The hook checks `event.agent_type?.startsWith('metta-')`, not a specific exact match. This is intentionally broad so any current or future `metta-*` agent passes. If empirical testing shows `agent_type` receives a different value (e.g. the skill's own name `metta-issue`), the `startsWith('metta-')` check still passes because both `'metta-skill-host'` and `'metta-issue'` start with `'metta-'`. The `event_keys` logging in the audit log ensures the first few real invocations after deployment confirm the actual value.
