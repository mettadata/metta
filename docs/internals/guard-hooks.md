# Guard Hooks & the Skill-Enforcement Model

This document explains metta's **guard hooks** — the security-critical PreToolUse
layer that keeps AI-driven sessions inside the metta workflow. It is written for
contributors and maintainers who need to understand, extend, or debug this layer.

If you only want to get unblocked right now, jump to
[Emergency bypass](#emergency-bypass) or the
[troubleshooting guide](../guide/troubleshooting.md). To add new guarded
subcommands or paths, see [extending.md](./extending.md).

---

## Why these hooks exist

metta's quality guarantees come from its **skills**, not from the CLI. A skill
like `/metta-propose` or `/metta-issue` does far more than shell out to `metta
propose`: it forks the right subagent personas (proposer, planner, executor,
reviewer, verifier), wraps artifact authoring and review, and enforces that the
artifacts carry real, reviewed content. Calling the CLI directly from an AI
orchestrator session bypasses all of that and has shipped broken or stub
artifacts in the past.

The rule the framework enforces (see the root `CLAUDE.md`):

> **AI orchestrators MUST invoke the matching metta skill — never call the CLI
> directly.** Humans running the CLI in a terminal are unaffected.

The guard hooks are the mechanical backstop for that rule. They run as Claude
Code **PreToolUse** hooks: a small Node script receives the tool-call event on
stdin, decides allow/block, and signals the result via exit code. A `0` exit
permits the tool call; a non-zero exit (`2`) blocks it and surfaces the message
written to stderr back to the model.

Two hooks are registered in `.claude/settings.json`:

| Hook | Matcher | Source |
|------|---------|--------|
| Bash guard | `Bash` | `.claude/hooks/metta-guard-bash.mjs` |
| Edit guard | `Edit\|Write\|NotebookEdit\|MultiEdit` | `.claude/hooks/metta-guard-edit.mjs` |

The runtime copies of these hooks live under `.claude/hooks/`; the canonical
sources shipped to users live at `src/templates/hooks/`. Keep the two in sync —
edits to one without the other will drift.

---

## The Bash guard

`metta-guard-bash.mjs` intercepts every `Bash` tool call, scans the command
string for `metta` invocations, classifies each one, and blocks the call if any
invocation is a state-mutating subcommand that the caller is not authorized to
run directly.

### Subcommand lists

The guard maintains four hard-coded lists. Classification walks them in order.

| List | Members | Meaning |
|------|---------|---------|
| `ALLOWED_SUBCOMMANDS` | `status`, `instructions`, `progress`, `doctor`, `iteration`, `install` | Read-safe single-word forms. Always permitted. (`install` is an intentional pass-through for human/CI install; `iteration` only bumps a per-change counter.) |
| `ALLOWED_TWO_WORD` | `issues list`, `gate list`, `changes list`, `backlog list`, `backlog show` | Read-only two-word forms. Always permitted. |
| `BLOCKED_SUBCOMMANDS` | `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init` | State-mutating single-word forms. Blocked unless bypassed. |
| `BLOCKED_TWO_WORD` | `backlog add`, `backlog done`, `backlog promote`, `changes abandon` | State-mutating two-word forms. Blocked unless bypassed. |

A fifth set, `SKILL_ENFORCED_SUBCOMMANDS` (`issue`, `fix-issue`, `propose`,
`quick`, `auto`, `ship`), is a stricter subset of the blocked subcommands — see
[the two-tier model](#two-tier-enforcement) below.

### Classification: allow / block / unknown

`classify(inv)` returns one of three verdicts for each invocation:

- **`allow`** — bare `metta` with no subcommand, or a member of an allow list.
- **`block`** — a member of a block list.
- **`unknown`** — anything not in any list (e.g. a new subcommand that no list
  has been updated for). Unknown is treated conservatively as **blocked**, so a
  newly added mutating subcommand fails closed rather than slipping through. The
  rejection message tells the contributor to update the allowlist if the command
  is genuinely read-only.

### The tokenizer

`tokenize(command)` splits the command on whitespace and walks the tokens,
following shell chain separators (`&&`, `;`, `||`, `|`) to find every `metta`
invocation. For each one it records:

- `sub` — the subcommand (token after `metta`)
- `third` — the next token (for two-word forms)
- `skillBypass` — whether an inline `METTA_SKILL=1` env-var prefix preceded the
  invocation

Leading env-var assignments (`FOO=bar metta ...`) are consumed before the
`metta` token, and `METTA_SKILL=1` among them sets `skillBypass`.

**Quote-aware skip-to-separator (recently fixed).** After it finds a `metta`
invocation, the tokenizer skips the rest of that command's arguments up to the
next chain separator before looking for another invocation. This prevents a word
*inside a quoted argument* from being misparsed as a second `metta` call — for
example, a propose description that literally contains the words
`"metta finalize"`. Without this skip, the substring would be flagged as a
blocked `finalize` call and the legitimate command would be rejected.

> The tokenizer is intentionally a coarse approximation of shell parsing, not a
> real parser. It does not strip quotes or expand variables; it only needs to be
> conservative enough to catch direct `metta <mutating-subcommand>` calls and
> robust enough not to false-positive on quoted text. When extending it, keep
> failing closed (unknown ⇒ block) as the guiding principle.

### Two bypass signals and their trust properties

The guard recognizes two distinct signals that a `metta` call is legitimately
skill-initiated. Their trust levels differ, and that difference is the whole
point of the design.

1. **Inline `METTA_SKILL=1` prefix** — the env-var prefix on the command string
   itself (`METTA_SKILL=1 metta issue ...`). This is **forgeable**: anything that
   can construct a Bash command can prepend it, including an orchestrator that is
   trying to route around the guard. It is recorded as `skillBypass` per
   invocation. (A belt-and-suspenders check also honors `METTA_SKILL=1` set on
   the hook *process's own* environment, near the top of `main()`.)

2. **`event.agent_type`** — caller identity set by the Claude Code **runtime**
   when a tool call fires from a forked subagent. `isTrustedSkillCaller(event)`
   returns true only when `event.agent_type` is a string beginning with
   `metta-`. This signal is **not forgeable via the command string** — the model
   cannot set it; only the runtime does, and only for a genuine fork. This is the
   strong trust anchor.

### Two-tier enforcement

The guard applies different requirements depending on the subcommand:

- **Skill-enforced subcommands** (`SKILL_ENFORCED_SUBCOMMANDS`: `issue`,
  `fix-issue`, `propose`, `quick`, `auto`, `ship`) require **BOTH** the inline
  `METTA_SKILL=1` bypass **AND** a trusted `metta-*` `agent_type`. For these,
  the inline prefix alone is no longer sufficient — a forgeable signal can't
  unlock the highest-impact commands. The rejection message points the caller at
  the matching skill (via `SKILL_HINT_MAP`, e.g. `propose → /metta-propose`).

- **Every other blocked subcommand** (e.g. `complete`, `finalize`, `refresh`,
  `import`, `init`, the blocked two-word forms) accepts the inline
  `METTA_SKILL=1` bypass **alone**. This preserves existing skill-internal CLI
  behavior for commands that the skill fork drives but which were not yet
  migrated to the stricter tier.

The offender-finding logic encodes exactly this:

```js
const offender = invocations.find((inv) => {
  if (classify(inv) === 'allow') return false;          // never an offender
  if (SKILL_ENFORCED_SUBCOMMANDS.has(inv.sub)) {
    return !(inv.skillBypass && isTrustedSkillCaller(event)); // BOTH required
  }
  return !inv.skillBypass;                                // inline bypass enough
});
```

### Exit codes & messages

- **`exit 0`** — no offender. The call proceeds. Also taken early when stdin is
  empty/unparseable, when `tool_name !== 'Bash'`, or when the hook process's own
  `METTA_SKILL` env is `1`.
- **`exit 2`** — an offender was found. The hook writes a targeted message to
  stderr and blocks. Three distinct messages are produced:
  - skill-enforced subcommand without a trusted `agent_type` (points to the
    matching skill, notes that inline `METTA_SKILL=1` no longer suffices),
  - `unknown` subcommand (asks the contributor to update the allowlist),
  - plain `block` (points to the `/metta-<skill>` mapping in `CLAUDE.md`).

  Every message ends with the emergency-bypass hint.

### Audit log

The guard appends one JSON line per relevant event to
`<cwd>/.metta/logs/guard-bypass.log` via `appendAuditLog`. Each entry records the
timestamp, verdict, subcommand/third token, observed `agent_type`,
`skill_bypass` flag, a human reason, and the event keys. Verdicts logged include
`block` (all three block paths) and `allow_with_bypass` (a non-enforced
subcommand that was permitted because of an inline bypass — so the trail reflects
*every* skill-bypass use, not just rejections). All log I/O errors are swallowed:
an audit-log failure must never break the hook's primary enforcement path.

---

## The Edit guard

`metta-guard-edit.mjs` intercepts `Edit`, `Write`, `NotebookEdit`, and
`MultiEdit` tool calls (the `GUARDED` set). Its job is to prevent **untracked
edits outside the metta workflow** — file mutations that aren't attached to an
active change and therefore won't be captured by any spec or commit.

### Active-change requirement

On every guarded call the hook runs `metta status --json` and inspects the
result:

- `{ change: "<slug>" }` (a string `change`), **or**
- a non-empty `changes` array

…means there is an active change, and the edit is permitted (`exit 0`).

The hook **fails open** in three cases by design — it must not block bootstrap or
non-metta repositories:

- `metta status` errors or times out (not a metta project, metta not installed),
- the output isn't valid JSON,
- the tool isn't one of the guarded edit tools.

When there is no active change and the path isn't allowlisted, the hook writes a
nudge to stderr (start a change with `/metta:quick` or `metta quick`) and
**`exit 2`**.

### Allowlisted paths

Some edits are legitimate even without an active change — chiefly the
`/metta-init` bootstrap and post-creation enrichment of issue bodies.
Two allowlists cover these (paths are resolved relative to the project root):

| Allowlist | Entries | Why |
|-----------|---------|-----|
| `ALLOW_LIST` (exact) | `spec/project.md`, `.metta/config.yaml` | Lets `metta-discovery` bootstrap the constitution and config during `/metta-init`, before any change exists. |
| `ALLOW_PREFIXES` (prefix, `.md` only) | `spec/issues/` | Lets users enrich issue bodies after the CLI creates them. This directory has dedicated commands (`metta issue`, `metta backlog add` — both now write under `spec/issues/`) that own creation. |

A prefix match only allows files that both start with the prefix **and** end in
`.md`.

---

## `METTA_SKILL=1` ↔ `agent_type` and the metta-skill-host fork

The two bypass signals map onto two different ways a skill can run.

Several metta skills declare `context: fork` in their frontmatter
(`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`,
`metta-auto`, `metta-ship`). When one of these runs, Claude Code forks it into an
isolated subagent — the **`metta-skill-host`** agent — and the runtime stamps the
fork's tool calls with `event.agent_type` beginning `metta-`. That is precisely
the unforgeable signal `isTrustedSkillCaller` looks for. So when the forked host
dispatches `METTA_SKILL=1 metta issue ...`, the Bash guard sees **both** signals
and permits the skill-enforced subcommand.

Non-forked, **interactive** skills cannot get the trusted `agent_type`. The
clearest example is `metta-init`, which uses `AskUserQuestion` and therefore must
run in the interactive session rather than a fork — a fork can't prompt the user.
Such skills have no trusted `agent_type` and rely on the inline `METTA_SKILL=1`
prefix alone. This is why the non-enforced tier still accepts the forgeable
signal: removing it would break interactive bootstrap flows.

### Known limitation

This split is the reason `METTA_SKILL=1` can't be fully retired today: the
strongest design (require a trusted `agent_type` for *every* blocked subcommand)
would lock out the interactive skills that legitimately can't fork. The
forgeable inline bypass therefore remains the only path for those flows, leaving
a residual trust gap on the non-enforced tier.

Unifying the model — so that all blocked subcommands demand the unforgeable
signal, without breaking interactive skills — is tracked by the open issue
**`harden-metta-guard-bash-trust-model-unify-all-blocked`**
(`spec/issues/harden-metta-guard-bash-trust-model-unify-all-blocked.md`). If you
touch this layer, read that issue first.

---

## Emergency bypass

Both hooks print the same escape hatch in their rejection messages: disable the
hook in **`.claude/settings.local.json`**. `settings.local.json` is the
machine-local override that layers over `settings.json`, so you can turn a guard
off for yourself without editing the checked-in configuration. Use this only as a
deliberate, temporary measure — the guards exist to protect the workflow's
quality guarantees, and a disabled guard means direct CLI calls can once again
ship unreviewed artifacts.

---

## See also

- [extending.md](./extending.md) — how to add guarded subcommands, allowlist
  paths, or new hooks.
- [Troubleshooting](../guide/troubleshooting.md) — what to do when a guard blocks
  a command you believe is legitimate.
