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

Three hooks make up the layer. Two are registered globally in
`.claude/settings.json`; the third is attached per-skill via frontmatter:

| Hook | Trigger | Source |
|------|---------|--------|
| Bash guard | `Bash` tool calls (settings.json matcher) | `.claude/hooks/metta-guard-bash.mjs` |
| Edit guard | `Edit\|Write\|NotebookEdit\|MultiEdit` (settings.json matcher) | `.claude/hooks/metta-guard-edit.mjs` |
| Session mint | PreToolUse `Bash` hook declared in each Tier-2 skill's frontmatter | `.claude/hooks/metta-session-mint.mjs` |

The runtime copies of these hooks live under `.claude/hooks/`; the canonical
sources shipped to users live at `src/templates/hooks/`. Keep the two in sync —
`tests/hooks-byte-identity.test.ts` fails the build if they drift.

---

## The Bash guard

`metta-guard-bash.mjs` intercepts every `Bash` tool call, scans the command
string for `metta` invocations, classifies each one, and blocks the call if any
invocation is a state-mutating subcommand that the caller is not authorized to
run.

### Subcommand lists

The guard maintains hard-coded lists. Classification walks them in order.

| List | Members | Meaning |
|------|---------|---------|
| `ALLOWED_SUBCOMMANDS` | `status`, `instructions`, `progress`, `doctor`, `next`, `iteration`, `model-escalation`, `tokens`, `install` | Read-safe single-word forms. Always permitted. (`install` is an intentional pass-through for human/CI install; `iteration`, `model-escalation`, and `tokens` are append-only instrumentation.) |
| `ALLOWED_TWO_WORD` | `issues list`, `gate list`, `changes list`, `backlog list`, `backlog show`, `gaps list`, `gaps show`, `milestone list`, `milestone show`, `release status` | Read-only two-word forms. Always permitted. |
| `ALLOWED_BARE` | `roadmap`, `release`, `backlog` | Bare (no-third-word) read-only status views, optionally with flags (`metta roadmap --json`). Their mutating two-word forms stay blocked. |
| `BLOCKED_SUBCOMMANDS` | `propose`, `quick`, `auto`, `complete`, `finalize`, `ship`, `issue`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `verify` | State-mutating (or command-executing, for `verify`) single-word forms. Require tier authorization. |
| `BLOCKED_TWO_WORD` | `backlog add/done/promote/migrate`, `changes abandon`, `milestone create`, `roadmap add/reorder/next/remove`, `release cut` | State-mutating two-word forms. Require tier authorization. |

A further set, `SKILL_ENFORCED_SUBCOMMANDS` (`issue`, `fix-issue`, `propose`,
`quick`, `auto`, `ship`), is the **fork-tier (Tier 1)** subset of the blocked
subcommands — see [the two-tier model](#two-tier-enforcement) below. Every
other blocked form is **session-tier (Tier 2)**.

### Classification: allow / block / unknown

`classify(inv)` returns one of three verdicts for each invocation:

- **`allow`** — bare `metta` with no subcommand, or a member of an allow list.
- **`block`** — a member of a block list.
- **`unknown`** — anything not in any list (e.g. a new subcommand that no list
  has been updated for). Unknown is treated conservatively as **blocked**, so a
  newly added mutating subcommand fails closed rather than slipping through. The
  rejection message tells the contributor to update the allowlist if the command
  is genuinely read-only.

An invocation containing a `--` operand terminator anywhere in its arguments
(bare, or a word whose quote-removed form is `--`) is always `unknown` — Commander
dispatches what follows `--` as a subcommand, so no tier, fork identity, or
session credential can authorize it. A `--` that is a proper substring of a
longer quoted argument (`"hello -- world"`) is literal text and stays allowed.

### The tokenizer

`tokenize(command)` splits the command into segments at unquoted chain-separator
runs (`;`, `|`, `&`, `&&`, `||`, newlines — quote-aware, so a separator inside a
quoted argument is literal text, not a boundary), then whitespace-tokenizes each
segment looking for a leading `metta` invocation. For each one it records:

- `sub` — the subcommand (token after `metta`)
- `third` — the next token (for two-word forms)
- `hasDoubleDash` — whether a live `--` operand terminator appears in the
  invocation's argument span

Leading env-var assignments (`FOO=bar metta ...`) are consumed before the
`metta` token so the subcommand behind them is still detected. **Inline command
text — including any env-var prefix — never carries authorization.** Tier 1
trusts only the verified fork caller identity, and Tier 2 trusts only the minted
session credential. (The historical inline `METTA_SKILL=1` bypass is retired and
no longer recognized.)

> The tokenizer is intentionally a coarse approximation of shell parsing, not a
> real parser. Wrapper prefixes (`command metta ...`, `env metta ...`, `sh -c`),
> command substitution, subshells, and similar indirection are invisible to it —
> an accepted limitation documented in the hook source. Defense in depth comes
> from the two-tier trust model and the audit log, not from mechanically
> detecting every indirection. When extending it, keep failing closed
> (unknown ⇒ block) as the guiding principle.

### Two-tier enforcement

Blocked subcommands are authorized through one of two trust anchors, neither of
which can be forged from command text:

- **Tier 1 (fork-tier)** — `SKILL_ENFORCED_SUBCOMMANDS` (`issue`, `fix-issue`,
  `propose`, `quick`, `auto`, `ship`) are authorized **solely** by a verified
  fork caller identity: `isTrustedSkillCaller(event)` returns true only when
  `event.agent_type` is a string beginning with `metta-`. The Claude Code
  runtime sets this field itself when a tool call fires from a forked
  `metta-skill-host` subagent; the model cannot set it.

- **Tier 2 (session-tier)** — every other blocked form (`complete`, `finalize`,
  `fix-gap`, `refresh`, `import`, `init`, `verify`, and the blocked two-word
  forms) is authorized by a verified fork caller identity (a Tier-1 skill body
  legitimately driving a Tier-2 subcommand) **or** by a valid per-skill
  **session credential** — see the next section.

Tier-2 rejections carry one of three reasons, threaded into the audit log and
the block verdict: `missing-credential` (no structurally valid token at all),
`credential-expired` (tokens exist but all are genuinely dead — see below), or
`subcommand-not-in-scope` (an eligible token exists but none covers this
subcommand).

### Tier-2 session credentials: minting and the two-band freshness model

Tier-2 authorization rests on per-skill credential files at
`<cwd>/.metta/scratch/skill-session/<slug>.token` (mode `0o600`), written by
the **mint hook** and validated (and, when needed, re-primed) by the **guard**.

> The original single-file credential at `.metta/scratch/skill-session.token`
> is **retired**: the guard does not honor it, and the mint hook actively
> deletes any lingering copy. Likewise retired is the earlier
> single-band model in which freshness was judged only against the raw TTL of
> the minted timestamp and refresh raced the guard during delegation windows —
> everything below describes the current, deterministic two-band model.

**Minting.** Each Tier-2 (non-forked) skill declares a PreToolUse Bash hook in
its frontmatter: `node .claude/hooks/metta-session-mint.mjs <slug>`. The slug is
a static, ship-time-authored string — never sourced from event data. On every
Bash call inside the skill session, the mint hook:

- mints/rotates **its own** `<slug>.token` when the token is absent, malformed,
  or past **80% of its TTL** (sliding refresh — active use keeps it fresh);
- writes the token atomically (temp file + same-directory rename), containing a
  random `token` value (`randomUUID`), the skill slug, the skill's authorized
  `subcommands` scope (from `SKILL_SCOPES`, the sole scope truth), `mintedAt`,
  `ttlMs` (`TTL_MS = 300_000`, 5 minutes), and `sessionId` — stamped from the
  runtime-supplied `event.session_id`;
- cleans up **genuinely dead** sibling tokens — those past `ttlMs + GRACE_MS` —
  plus stale `*.tmp` orphans. The cleanup horizon deliberately matches the
  guard's re-prime horizon so housekeeping can never delete a token the guard
  would still re-prime;
- always exits `0`. It never blocks and never writes stderr guidance.

**Two-band freshness (guard-side, judged at validation time).** The guard reads
every structurally valid token in the directory and classifies each into bands
(`GRACE_MS = 3_600_000`, 60 minutes — one shared constant across both hooks,
pinned equal by the seam test suite):

| Band | Predicate | Outcome on acceptance |
|------|-----------|----------------------|
| **Fresh** | `now - mintedAt < ttlMs` | audit reason `session-credential-verified` |
| **Re-primable** | `sessionId === event.session_id` (strict string equality) **and** `now - mintedAt < ttlMs + GRACE_MS` | audit reason `session-credential-reprimed`; the guard **rewrites the token** (new random `token` value, `mintedAt = now`, atomic temp+rename, best-effort) |
| **Dead** | neither band | `credential-expired` block |

A call is authorized when **any** eligible (fresh or re-primable) token covers
the subcommand's scope key — one skill's stale credential never blocks another
active skill's own credential. If at least one in-scope token is fresh, the
acceptance is a plain `session-credential-verified`. Only when authorization
came **exclusively** via the re-primable band does the guard re-prime: it
rewrites that token in place so the credential's clock restarts. The re-prime
write is best-effort and never load-bearing — the authorize decision precedes
the write, and a write failure never revokes the authorization.

**Why the re-primable band exists.** The mint hook is declared in the skill's
frontmatter, so it fires only on Bash calls the skill session itself issues.
During **delegation windows** — when the skill hands work to subagents — no
mint-refreshing Bash calls occur, and under the earlier single-band model the
token silently aged past its raw TTL, blocking the lifecycle when control
returned. The re-primable band lets the guard itself act as the re-priming half
during those windows. Because the band is bound to the live session's
runtime-supplied `session_id` (the same trust class as Tier 1's `agent_type`),
a token left behind by a crashed or previous session matches nothing and
authorizes nothing.

**Determinism under parallel hooks.** Claude Code runs PreToolUse hooks in
parallel with no ordering guarantee. The guard's verdict is a pure function of
**(token file state, event fields, clock)** — no branch consults whether the
separately scheduled mint hook has already fired on this event — so the outcome
is invariant under hook ordering: mint-wrote-first yields a fresh-band
acceptance, guard-read-first yields a re-prime acceptance, and if the mint hook
never fires at all the re-prime path is self-sufficient.

**Bounded lifetime and fail-closed degradations.**

- The effective lifetime of a credential is `TTL + GRACE` (65 minutes) after
  the **last mint or re-prime**. Active lifecycle use extends its own window;
  once activity ceases, every credential dies within one bounded lifetime — an
  idle session holds no standing authorization.
- A missing or non-string `event.session_id` disables the re-primable band
  entirely: the guard degrades to fresh-band-only (the pre-fix behavior),
  fail-closed.
- Old-format tokens without a `sessionId` field still validate and work in the
  fresh band, but are never re-primable. No migration step; fail-closed
  degradation.
- The re-primable band contributes **freshness only, never scope**: scope
  filtering runs over the token's `subcommands` array identically in both
  bands, with `SKILL_SCOPES` in the mint hook as the sole scope truth.

**`credential-expired` means genuinely dead.** The reason string is unchanged
from earlier versions, but its semantic is now **narrower**: it is written only
when every structurally valid token is dead — at least `TTL + GRACE` stale, or
stamped with a different session's id past its raw TTL — and no fresh token
exists. Under the retired single-band model the same string could fire a mere
five minutes after minting, mid-lifecycle; that state now re-primes instead.
Audit-log consumers parse the same string with a stricter meaning, and the new
`staleness_ms` field (below) makes the shift observable.

### Exit codes & messages

- **`exit 0`** — no offender. Also taken early when stdin is empty or
  unparseable, or when `tool_name !== 'Bash'`.
- **`exit 2`** — blocked, with a targeted stderr message. Distinct block paths:
  - background Bash (`run_in_background: true`) from a forked metta agent —
    forked skills must complete synchronously;
  - a `--` operand terminator anywhere in a metta invocation (unconditional,
    tier-independent);
  - a Tier-1 (skill-enforced) subcommand without a trusted `agent_type` —
    points to the matching skill via `SKILL_HINT_MAP`;
  - an `unknown` subcommand (asks the contributor to update the allowlist);
  - a Tier-2 subcommand with `missing-credential`, `credential-expired`, or
    `subcommand-not-in-scope` — points to the `/metta-<skill>` mapping and
    notes that the per-skill credential is minted by the skill's entry point.

  Every message ends with the emergency-bypass hint.

### Audit log

The guard appends one JSON line per relevant event to
`<cwd>/.metta/logs/guard-bypass.log` via `appendAuditLog`. Each entry records
`ts`, `verdict` (`allow` or `block`), `subcommand`, `third`, the observed
`agent_type`, a `reason`, the `tier` (`fork`, `session`, or `null`), and the
event keys. All log I/O errors are swallowed: an audit-log failure must never
break the hook's primary enforcement path.

Session-tier entries carry the richer surface introduced with the two-band
model:

- **`session-credential-verified`** — Tier-2 acceptance via a fresh in-scope
  token (or via a trusted fork caller, in which case `staleness_ms` is `null`).
- **`session-credential-reprimed`** — Tier-2 acceptance that came only via the
  re-primable band; the guard rewrote the authorizing token as a side effect.
- **`staleness_ms`** (number | null) — on session-tier acceptances, the age of
  the authorizing token at evaluation time; on `credential-expired` blocks, the
  age of the *youngest* structurally valid token considered (evidence for
  future horizon tuning); `null`/absent where it does not apply.
- Block reasons: `missing-credential`, `credential-expired` (genuinely-dead
  semantic, above), `subcommand-not-in-scope`, plus the tier-independent
  `double-dash-operand-terminator`, `background-bash-from-fork`, `unknown`,
  and the Tier-1 `skill-enforced subcommand without trusted agent_type`.

Every session-tier authorization is logged — the trail shows each acceptance,
which freshness band it came through, and how stale the credential was, not
just rejections.

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

## Forked vs. interactive skills: how each gets authorized

The two trust anchors map onto two different ways a skill can run.

Several metta skills declare `context: fork` in their frontmatter
(`metta-issue`, `metta-fix-issues`, `metta-propose`, `metta-quick`,
`metta-auto`, `metta-ship`). When one of these runs, Claude Code forks it into an
isolated subagent — the **`metta-skill-host`** agent — and the runtime stamps the
fork's tool calls with `event.agent_type` beginning `metta-`. That is precisely
the unforgeable signal `isTrustedSkillCaller` looks for, and it is the sole
Tier-1 authorization. A fork's verified identity also satisfies Tier 2, so a
Tier-1 skill body may drive Tier-2 subcommands directly.

Non-forked, **interactive** skills (e.g. `metta-init`, which uses
`AskUserQuestion` and therefore cannot run in a fork) never get a trusted
`agent_type`. They are instead authorized by the Tier-2 session credential:
each such skill's frontmatter declares the mint hook with its own ship-time
slug, so invoking the skill mints a scoped credential that the guard then
validates — and re-primes across delegation windows — for the lifetime of the
skill session. The credential value never appears in any skill file, so it
cannot be derived from reading skill instructions; the historical forgeable
inline `METTA_SKILL=1` prefix is fully retired and carries no authorization on
any tier.

---

## Emergency bypass

Both guard hooks print the same escape hatch in their rejection messages:
disable the hook in **`.claude/settings.local.json`**. `settings.local.json` is
the machine-local override that layers over `settings.json`, so you can turn a
guard off for yourself without editing the checked-in configuration. Use this
only as a deliberate, temporary measure — the guards exist to protect the
workflow's quality guarantees, and a disabled guard means direct CLI calls can
once again ship unreviewed artifacts.

---

## See also

- [extending.md](./extending.md) — how to add guarded subcommands, allowlist
  paths, or new hooks.
- [Troubleshooting](../guide/troubleshooting.md) — what to do when a guard blocks
  a command you believe is legitimate.
