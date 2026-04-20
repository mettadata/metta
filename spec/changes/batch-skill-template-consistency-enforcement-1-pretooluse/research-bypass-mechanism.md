# Bypass Mechanism Research: Skill-Side Pass-Through for `metta-guard-bash.mjs`

Change: `batch-skill-template-consistency-enforcement-1-pretooluse`
Scope: How legitimate skill-driven CLI calls pass the PreToolUse Bash guard without being blocked

---

## Context

`metta-guard-bash.mjs` blocks state-mutating metta CLI calls (`metta propose`, `metta issue`,
etc.) when fired from the Claude Bash tool by an AI orchestrator. However, the guard must not
block calls that originate _from_ a skill that is correctly orchestrating the CLI. Skills are the
sanctioned path — they wrap subagent personas that produce real artifacts. The hook's purpose is
"AI orchestrator calls CLI directly, bypassing skills"; not "skill calls CLI as part of its own
workflow." A bypass mechanism is therefore required.

Three mechanisms are evaluated below.

### Event JSON Shape (grounded)

The PreToolUse hook receives this JSON on stdin[^1]:

```json
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "...",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "metta issue \"my problem\""
  },
  "tool_use_id": "toolu_01..."
}
```

Fields confirmed present: `tool_name`, `tool_input`, `hook_event_name`, `session_id`,
`transcript_path`, `cwd`, `permission_mode`, `tool_use_id`.

Conditional fields: `agent_id` and `agent_type` are included only when the hook fires inside a
subagent context (`--agent` or Agent tool call).[^1]

**There is no `metadata` field, no `from_skill` field, and no mechanism for the caller to attach
arbitrary key-value pairs to the hook event JSON.** The schema is controlled entirely by the
Claude Code runtime.

[^1]: https://code.claude.com/docs/en/hooks accessed 2026-04-20

---

## Mechanism 1: Environment Variable `METTA_SKILL=1`

### Description

Skills prefix every state-mutating CLI invocation with `METTA_SKILL=1`:

```bash
METTA_SKILL=1 metta issue "my problem"
METTA_SKILL=1 metta propose "add feature X" --json
METTA_SKILL=1 metta complete intent --json --change my-change
```

The hook checks `process.env.METTA_SKILL === '1'` as its very first guard, before any command
inspection, and exits 0 immediately if the variable is present.

```js
// First check in the hook, after non-Bash early exit:
if (process.env.METTA_SKILL === '1') process.exit(0)
```

On the hook side the env var is visible because Claude Code passes the calling process environment
through to the hook subprocess. When the Bash tool runs `METTA_SKILL=1 metta issue "..."`, the
shell sets `METTA_SKILL` in the environment of that Bash invocation, and the hook reads it via
`process.env`.

### How Skills Use It

Every skill that calls a state-mutating metta command adds the prefix. Examples:

**metta-issue/SKILL.md** — step 3 changes from:

```bash
metta issue "<description>" --severity <level>
```

to:

```bash
METTA_SKILL=1 metta issue "<description>" --severity <level>
```

**metta-propose/SKILL.md** — step 1 changes from:

```bash
metta propose "<description>" --json
```

to:

```bash
METTA_SKILL=1 metta propose "<description>" --json
```

All subsequent CLI calls within the same skill step also carry the prefix: `metta complete`,
`metta finalize`, `metta instructions`, `metta backlog`, etc. Read-only commands (`metta status`,
`metta instructions`) do not require the prefix since they pass unconditionally, but it does not
hurt to include it for consistency.

### Pros

- Zero install artifacts — no new binary, no new file, no new PATH entry.
- No changes to the metta CLI itself — pure shell convention.
- Consistent with common patterns in Unix tooling (e.g., `CI=true`, `FORCE_COLOR=0`).
- The hook can check the env var in a single `process.env` read before any command parsing.
- SKILL.md diffs are minimal and uniform: replace `metta <cmd>` with `METTA_SKILL=1 metta <cmd>`.
- If a skill author forgets the prefix on one call, only that call is blocked — no global state to
  corrupt; the mistake is immediately visible in the error message.
- Works identically across all skill types (metta-issue, metta-propose, metta-quick, etc.) with
  no per-skill plumbing.

### Cons

- Syntactically spoofable: any prompt or AI session can write `METTA_SKILL=1 metta issue "..."` to
  bypass the guard. See the security note below — this is intentional by design.
- Every skill invocation requires the author to remember the prefix. A skill template that is
  added later without the prefix will be blocked.
- No semantic differentiation between "skill in this session" and "any caller who knows the magic
  string" — but again, this is acceptable given the threat model.

### Install Cost

None. No new files, no config changes beyond the SKILL.md text edits.

### Security Profile

The variable is trivially spoofable. An AI orchestrator can write `METTA_SKILL=1 metta issue
"..."` directly without going through a skill. This is acceptable because the threat model is
"AI orchestrator drift from the spec" rather than adversarial attack — see the security note
section below.

### Forward Compatibility

As new skills are added, each one adds `METTA_SKILL=1` to its CLI calls. No hook changes are
needed. If the bypass mechanism ever needs to be strengthened (e.g., a cryptographic token), the
env var name can be kept as the interface while the hook-side validation is upgraded without
touching SKILL.md files again.

---

## Mechanism 2: Dedicated Internal Binary `metta-internal`

### Description

Ship a second binary (or symlink) alongside `metta` — e.g., `metta-internal` — that is
functionally identical to `metta`. The hook's blocked-command patterns only match invocations of
`metta` as the binary token; `metta-internal` is not in the blocklist, so any command starting
with `metta-internal propose "..."` passes through unconditionally.

Skills call:

```bash
metta-internal propose "<description>" --json
metta-internal complete intent --json --change my-change
```

### Pros

- The bypass cannot be triggered by environment manipulation — the caller must have `metta-internal`
  on PATH, which is a filesystem artifact rather than a text string.
- No per-call prefix required in skill templates — any call to `metta-internal` passes by default.

### Cons

- **Significant install cost.** `metta install` must copy or symlink a second binary to a location
  on PATH. `npm publish` / `package.json` `bin` field must declare two entries. Any installer script
  must provision both.
- **Package size and complexity increase.** Either the package ships two copies of the same binary
  (wasteful) or a thin wrapper script that delegates to `metta` (fragile) or a symlink (platform-
  dependent, breaks on some Windows environments).
- **Parallel surface.** Two entry points means two places where breaking changes must be verified.
  If the `metta` binary's interface changes, `metta-internal` must be updated or re-linked.
- **Hook logic couples to binary name.** Any renaming or refactoring of the internal binary name
  requires a coordinated update in both the hook's block-list patterns and all skill templates.
- **Confusing to contributors.** A `metta-internal` binary on PATH raises questions: when should
  you use it? Is it stable? What is its contract? The env-var pattern is self-documenting in the
  SKILL.md prose; the binary is not.
- **Does not eliminate spoofing.** Any AI session that knows about `metta-internal` can call it
  directly, achieving the same bypass. The binary provides marginally higher friction than an env
  var, but does not provide security.
- **Inconsistent with the existing `metta-guard-edit.mjs` pattern.** The edit guard uses no
  special binary; it uses environment state (`metta status --json`). A second binary is
  architecturally novel and inconsistent.

### Install Cost

High. New `bin` entry in `package.json`, installer changes, symlink or copy logic in
`metta install`, test updates to verify both binaries are present.

### Security Profile

Marginally harder to spoof than an env var (requires knowing the binary name), but practically
equivalent. Any AI session with filesystem read access can discover `metta-internal`.

### Forward Compatibility

Poor. Adding new blocked commands to the hook is unchanged, but any renaming or
splitting of the internal binary name requires coordinated changes across hook, SKILL.md files,
and installer code.

---

## Mechanism 3: Hook-Metadata Flag in the Event JSON (`from_skill: true`)

### Description

If Claude Code supported attaching arbitrary metadata to tool calls, skills could tag each Bash
tool invocation with a `from_skill: true` marker. The hook would read this from the event JSON
(`input.from_skill === true`) and exit 0.

### Viability Assessment (grounded)

The PreToolUse hook event JSON schema has been confirmed from the official documentation[^1] as:

```
session_id, transcript_path, cwd, permission_mode, hook_event_name,
tool_name, tool_input, tool_use_id
```

with optional `agent_id` / `agent_type` in subagent contexts.

**There is no mechanism for skills or orchestrators to attach metadata to a Bash tool call that
would appear in the hook event JSON.** The `tool_input` object for a Bash event contains only
`command` (and optionally `timeout`). Claude Code does not expose a metadata or annotation
field on tool calls, and the hook schema is defined by the runtime, not by the caller.

A GitHub issue[^2] confirms that the hook schema is fixed: the only caller-visible fields in
`tool_input` for the Bash tool are `command`, `description`, and `timeout`.

[^2]: https://github.com/anthropics/claude-code/issues/19115 accessed 2026-04-20

### Pros

- Would be the most semantically clean mechanism if supported.
- No pollution of the command string with env vars.
- The bypass intent is explicit in the event structure rather than embedded in the shell command.

### Cons

- **Not supported.** The mechanism does not exist in the current Claude Code runtime.
- Would require an Anthropic platform change, not a metta change.
- Even if supported in the future, skills would still need explicit opt-in per-call.
- A future Claude Code update adding such a field could conflict with any workaround built
  on top of the existing schema.

### Install Cost

Infinite (blocked on a platform feature that does not exist).

### Security Profile

N/A — cannot be implemented.

### Forward Compatibility

N/A — if the platform ever adds metadata fields, this mechanism could be revisited. The
`METTA_SKILL=1` convention could be retired at that point with a single hook-side change.

---

## Tradeoff Table

| Criterion | Env var `METTA_SKILL=1` | Internal binary `metta-internal` | Hook-metadata flag |
|---|---|---|---|
| Supported today | Yes | Yes | **No** |
| Install cost | None | High (new bin, installer, package.json) | N/A |
| SKILL.md change per command | One-line prefix | Replace `metta` with `metta-internal` | N/A |
| Hook implementation cost | One `process.env` check | Expand block patterns to exempt binary | N/A |
| Spoofable | Yes (env string) | Yes (binary name known) | N/A |
| Consistent with existing hook style | Yes (env check, no new artifacts) | No (new binary, novel pattern) | N/A |
| Forward compatible | Yes (upgrade hook-side if needed) | Poor (binary rename = coordinated change) | Yes if platform adds it |
| Contributor clarity | High (self-documenting in SKILL.md) | Low (two binaries, unclear contract) | High |
| Risk of breaking human CLI | None | Low (if binary is correctly symlinked) | None |

---

## Security Note: Spoofability of `METTA_SKILL=1`

Yes, any caller can write `METTA_SKILL=1 metta issue "..."` directly in a Bash command and bypass
the guard. This is by design, not a gap.

The threat model for `metta-guard-bash.mjs` is: **an AI orchestrator drifts off-spec and calls
the metta CLI directly instead of using the skill layer.** This is an accidental compliance
failure — the orchestrator is trying to do the right thing but taking a shortcut. The hook
provides a mechanical nudge: "you are not in the right code path; here is the correct one."

The hook is a guardrail, not a security boundary. It does not protect against:

- A determined adversary who can inject text into an AI session.
- A skill that is itself misbehaving (a misbehaving skill with `METTA_SKILL=1` already has
  permission to call the CLI — that is what skills are for).
- Human developers running commands in a terminal (the hook does not fire outside the Claude
  tool harness).

This threat model is identical to the one for `metta-guard-edit.mjs`, which can be bypassed by
disabling the hook in `.claude/settings.local.json`. Both hooks are explicit about their emergency
bypass. Spoofability of `METTA_SKILL=1` is analogous to the edit hook's documented bypass in
`settings.local.json` — it is a known, intentional escape hatch, not a vulnerability.

The env-var mechanism is therefore appropriate for this threat model. A cryptographically signed
token or capability-based system would be over-engineered for a tool that is explicitly a drift-
prevention nudge.

---

## Recommendation: Mechanism 1 — `METTA_SKILL=1` Environment Variable

**Rationale:** The env var approach is the only mechanism that is implementable today without
introducing new install artifacts or coupling to binary naming. It requires zero changes to the
metta CLI, zero changes to `package.json`, and zero changes to the install logic. The hook
implementation is a single `process.env` read added at the top of the existing classification
flow. The SKILL.md changes are uniform and reviewable: every state-mutating CLI call gains a
`METTA_SKILL=1 ` prefix. Contributors can understand the intent from the SKILL.md prose without
reading hook source.

Mechanism 2 (internal binary) adds meaningful complexity at every layer — packaging, installer,
PATH, hook logic, contributor documentation — for no security gain over the env var. Mechanism 3
(hook metadata) does not exist in the current platform.

The spoofability of `METTA_SKILL=1` is acknowledged and accepted given the explicit threat model:
guardrail against accidental drift, not a security boundary.

---

## Concrete SKILL.md Prose Changes

### Pattern: state-mutating CLI call

Every Bash invocation of a blocked metta command gains the `METTA_SKILL=1` prefix.

**metta-issue/SKILL.md — Step 3**

Before:
```
Run `metta issue "<description>" --severity <level>` (shell-escape the description).
```

After:
```
Run `METTA_SKILL=1 metta issue "<description>" --severity <level>` (shell-escape the description).
```

**metta-propose/SKILL.md — Step 1 (propose call)**

Before:
```
`metta propose "<description>" --workflow <name> --json` (when flag present)
`metta propose "<description>" --json` (when flag absent — standard workflow)
```

After:
```
`METTA_SKILL=1 metta propose "<description>" --workflow <name> --json` (when flag present)
`METTA_SKILL=1 metta propose "<description>" --json` (when flag absent — standard workflow)
```

**metta-propose/SKILL.md — Step 3 (metta complete per artifact)**

Before:
```
`metta complete <artifact> --json --change <name>`
```

After:
```
`METTA_SKILL=1 metta complete <artifact> --json --change <name>`
```

**metta-propose/SKILL.md — Step 8 (finalize)**

Before:
```
`metta finalize --json --change <name>`
```

After:
```
`METTA_SKILL=1 metta finalize --json --change <name>`
```

**metta-quick/SKILL.md — Step 1**

Before:
```
`metta quick "$ARGUMENTS" --json`
```

After:
```
`METTA_SKILL=1 metta quick "$ARGUMENTS" --json`
```

### Read-only commands

`metta status`, `metta instructions`, `metta issues list`, `metta gate list`, `metta progress`,
`metta changes list`, `metta doctor` do not require the prefix — they pass unconditionally
regardless of `METTA_SKILL`. Including the prefix on read-only calls is harmless and acceptable
for consistency if a skill author prefers a uniform pattern.

### Rule text to add to each SKILL.md

Each skill's `## Rules` section (or equivalent) should include:

```
- All state-mutating `metta` CLI commands MUST be prefixed with `METTA_SKILL=1` so the
  `metta-guard-bash` PreToolUse hook recognizes the invocation as skill-sourced and permits it.
  Example: `METTA_SKILL=1 metta complete intent --json --change <name>`.
```

---

## Summary

Chosen mechanism: **`METTA_SKILL=1` environment variable prefix.**

One-line justification: it is the only viable mechanism today — zero install cost, one
`process.env` check in the hook, uniform one-line prefix in every SKILL.md, and explicitly
acceptable spoofability given the guardrail-not-security-boundary threat model.
