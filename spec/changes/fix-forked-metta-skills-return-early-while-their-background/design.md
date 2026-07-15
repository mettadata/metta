# Design: fix-forked-metta-skills-return-early-while-their-background

## Approach

Three additive layers, per research.md's selected approach — no restructuring of existing
control flow:

1. **Contract (US-1).** One synchronous-completion rule, authored once in
   `.claude/agents/metta-skill-host.md`'s `## Rules` section (mirrored byte-identically to
   `src/templates/agents/metta-skill-host.md`), because every `context: fork` skill declares
   `agent: metta-skill-host` and therefore loads this file's content into its context regardless
   of which of the six skills runs. No per-skill duplication of the rule text — each `SKILL.md`
   already inherits it via the host. `metta-ship`'s finalize dry-run step is the one place that
   reads as backgroundable today and gets a one-line "this blocks" clarification.
2. **Enforcement (US-2).** A new early branch in `.claude/hooks/metta-guard-bash.mjs`, sibling to
   the existing `event.tool_name !== 'Bash'` guard, checking `event.tool_input?.run_in_background`
   against the same `isTrustedSkillCaller`-style `agent_type` signal already used for
   `SKILL_ENFORCED_SUBCOMMANDS`. Placed before `classify()`/`offender` because
   `run_in_background` is orthogonal to `metta <subcommand>` tokenization and must catch
   non-`metta`-prefixed commands (e.g. bare `sleep`) too.
3. **Lock hardening (US-3/4/5).** `checkFinalizeLockStale()` added to `finalize-lock.ts`,
   reusing `isPidAlive` and `FinalizeLockSchema`; `FinalizeLockError`'s message reworded; `status.ts`
   and `next.ts` call the new helper additively before their existing print/routing paths.

No approach alternatives from research.md are revisited here; this file records where each lands.

## Components

### 1. `.claude/agents/metta-skill-host.md` — contract rule

Insert a new subsection immediately after the existing `## Rules` list (after
`.claude/agents/metta-skill-host.md:21`, the "return a short summary" line), as a new
`### Synchronous completion (hard rule)` block so grep-based audits (US-1's test criteria) find it
as a discrete, quotable unit. Mirror the identical bytes into
`src/templates/agents/metta-skill-host.md` in the same commit — `template-deploy-sync.test.ts`
fails the build otherwise (see Risks, b).

### 2. `.claude/hooks/metta-guard-bash.mjs` — hook branch

Placement: new function `isBackgroundBashRejected(event)` defined near `isTrustedSkillCaller`
(after line 107), and a new check inserted in `main()` immediately after the existing
`if (event.tool_name !== 'Bash') process.exit(0);` guard (line 137) and the `METTA_SKILL` env
bypass (line 140), **before** `tokenize(command)` runs (line 142/143) — this call never needs
`command` parsed at all:

```js
if (event.tool_input?.run_in_background === true && isTrustedSkillCaller(event)) {
  appendAuditLog(event, 'block', { sub: null, third: null }, 'background-bash-from-fork');
  process.stderr.write(
    `metta-guard-bash: Blocked Bash run_in_background from a forked metta agent (${event.agent_type}).\n` +
    `Forked skills MUST NOT end their turn with background work in flight — see the ` +
    `Synchronous completion rule in .claude/agents/metta-skill-host.md.\n` +
    `Run the command in the foreground and wait for it to complete before reporting.\n` +
    `Emergency bypass: disable this hook in .claude/settings.local.json.\n`
  );
  process.exit(2);
}
```

Exit code **2** — matches every existing rejection branch (lines 184, 195, 206), preserving a
uniform "hook blocked this tool call" signal for the orchestrator. `SKILL_ENFORCED_SUBCOMMANDS`
classification and audit-log behavior downstream are untouched (intent.md's explicit constraint).
Mirror identically into `src/templates/hooks/metta-guard-bash.mjs`.

### 3. `src/finalize/finalize-lock.ts` — `checkFinalizeLockStale`

```ts
export async function checkFinalizeLockStale(
  projectRoot: string,
  change: string,
): Promise<{ stale: boolean; reason?: 'dead-pid' | 'mtime-expired'; pid?: number; ageMs?: number }>
```

Co-located below `isPidAlive` (after line 41), reading `lockPath`'s `fs.stat().mtime` (not the
JSON body's `startedAt`) via the same path-join logic `acquireFinalizeLock` already uses (line
61). Logic: missing lock → `{ stale: false }`; corrupt lock → treat as `{ stale: true, reason:
'dead-pid' }` (unreadable lock cannot block a retry); parses and `isPidAlive` is unambiguously
false → `{ stale: true, reason: 'dead-pid', pid }`; `isPidAlive` true but reached only via the
`EPERM`-ambiguous branch **and** `Date.now() - mtimeMs > 60_000` → `{ stale: true, reason:
'mtime-expired', pid, ageMs }`; otherwise `{ stale: false }`. `isPidAlive` itself is unchanged —
the ambiguity is resolved one layer up in `checkFinalizeLockStale`, not inside `isPidAlive`,
matching research's rejection of approach 4 (mtime as an unconditional replacement). Reuses
`STALE_LOCK_THRESHOLD_MS` naming/value convention from `src/state/state-store.ts:24` (either
imported or a locally-defined `const FINALIZE_LOCK_STALE_MS = 60_000` — planner's call; no new
shared constant module is implied by research).

`FinalizeLockError` message (`finalize-lock.ts:17-20`) changes verbatim to:

> `A finalize is already running for "${change}" (PID ${pid}). Re-run metta finalize once it
> finishes — a dead-pid lock is reclaimed automatically. Do not delete the lock file manually.`

### 4. `src/cli/commands/status.ts` / `next.ts` — surfacing

`status.ts`: call `checkFinalizeLockStale(ctx.projectRoot, changeName)` inside `printChangeStatus`
(after the existing block ending `finalize-lock.ts:146`, i.e. appended as the last conditional
block before the function returns) and in `toChangeJson` for the `--json` path. Human line
(only when `stale === true`):

```
Finalize lock: stale finalize lock detected, safe to retry
```

JSON field added to `ChangeStatusJson`: `finalize_lock_stale: boolean` (present always, `false`
when no lock or a fresh live lock — additive per US-5's "existing output unchanged" scenario when
absent/false renders no visible line in human mode).

`next.ts`: insert the check inside the `allComplete` branch (lines 95-103), before emitting
`next: 'finalize'`. When stale:

```
Stale finalize lock detected for <changeName> — safe to retry.
Next: metta finalize --change <changeName>
```

JSON: `outputJson({ next: 'finalize', command: ..., change: changeName, finalize_lock_stale: true, finalize_lock_reason: 'dead-pid' | 'mtime-expired' })` — same `next: 'finalize'` route (US-5 requires *not* silently rerouting away from finalize, only warning), with the two new fields additive to the existing three.

## Data Model

**No schema changes.** `FinalizeLockSchema` (`src/schemas/finalize-lock.ts:3-7`) already carries
`{ pid, startedAt, change }` `.strict()` — sufficient for both the dead-pid check (`pid`) and the
mtime check, which reads the **lock file's** `fs.stat().mtime`, not a schema field, per
research.md's explicit rejection of keying staleness off `startedAt`. `ChangeStatusJson`
(`status.ts:6-10`) gains one additive boolean field (`finalize_lock_stale`); this is a TypeScript
type widening, not a Zod schema, and requires no migration.

## API Design

**New contract rule text** (drafted for `metta-skill-host.md`, verbatim candidate for the
planner/executor to place):

> ### Synchronous completion (hard rule)
> You MUST NOT invoke `Bash` with `run_in_background: true`. You MUST NOT dispatch an `Agent`
> call and end your turn before that agent returns a result. Your final message MUST NOT describe
> any launched work as still "in progress," "running," or "in the background" — it MUST report
> only outcomes that have already completed or definitively failed, with evidence (exit code,
> file written, pid confirmed dead). If a step would normally be backgroundable, run it in the
> foreground and wait for it to return before proceeding.

**Hook exit code:** `2`, matching the three existing `process.exit(2)` rejection paths in
`metta-guard-bash.mjs` — no new exit-code convention introduced.

**CLI additive fields:** `metta status --json` gains `finalize_lock_stale: boolean` (and, for
symmetry, `finalize_lock_reason?: 'dead-pid' | 'mtime-expired'`); `metta next --json` gains the
same two fields only on the `next: 'finalize'` branch. No existing field renamed or removed —
satisfies spec.md's "existing output... unchanged" scenarios for both commands.

## Dependencies

No new packages. Reuses: `node:fs/promises` `stat` (finalize-lock.ts already imports from
`node:fs`/`node:fs/promises`), the existing `isPidAlive`/`FinalizeLockSchema` pair, and the
`state-store.ts` 60s threshold *convention* (value, not a shared import, unless the planner
chooses to export `STALE_LOCK_THRESHOLD_MS` from `state-store.ts` for reuse — either is
consistent with research; no cross-module coupling is mandated). No vendor lock-in: all changes
are local file/process primitives (`process.kill`, `fs.stat`) already in use.

## Risks & Mitigations

**(a) Hook rejection could break legitimate background Bash use by metta agents.**
Checked: `grep -rn "run_in_background"` across `.claude/agents/`, `.claude/skills/`, and
`src/templates/` returns zero matches (confirmed live during this design pass, matching
research.md's finding) — no skill or agent template currently issues a background Bash call.
`metta-executor.md` and `metta-verifier.md` (agent_type `metta-executor`/`metta-verifier`, both
matching the `metta-` prefix `isTrustedSkillCaller` tests) show no background-task pattern either;
all Agent fan-out in `metta-propose`/`metta-quick`/`metta-fix-issues`/`metta-auto`/`metta-fix-gap`
uses multiple synchronous `Agent(subagent_type: ...)` calls dispatched in parallel within one
message, not `Bash run_in_background`. **However**, research's hook check reuses the same broad
`agent_type.startsWith('metta-')` signal as `isTrustedSkillCaller`, so the block is **not** scoped
to `metta-skill-host` alone — it also blocks background Bash from `metta-executor`,
`metta-verifier`, `metta-reviewer`, etc., if any of those personas ever gain a legitimate
background use case (e.g. an executor starting a dev server to test against). Mitigation: no
narrowing needed *today* since no legitimate use exists; if one arises later, narrow the hook
condition to `event.agent_type === 'metta-skill-host'` specifically rather than the prefix match —
flagged here for the planner as a design note, not a blocking conflict.

**(b) Template mirror drift.** `.claude/agents/metta-skill-host.md` and
`.claude/hooks/metta-guard-bash.mjs` each have a byte-identical `src/templates/...` source
(`tests/template-deploy-sync.test.ts:22-24`). Mitigation: every edit to a deployed file in this
change lands an identical edit to its template counterpart in the same commit;
`template-deploy-sync.test.ts` fails CI on any divergence, giving a hard gate rather than a
process reminder.

**(c) Mtime fallback racing a slow-but-alive finalize.** A finalize that is alive but has held its
lock past 60s (slow spec merge, large diff) could be mis-reclaimed if the mtime check applied
unconditionally. Mitigation: per research's rejection of approach 4, the mtime check is
**only consulted inside the `EPERM`-ambiguous / recycled-pid branch** — a confirmed-alive owner
via a clean `isPidAlive` result (no `EPERM`) is always respected regardless of lock age, matching
spec.md's "Fresh lock with a confirmed live owner is respected" scenario (spec.md:50-55) and
preserving the existing dead-pid path unchanged (spec.md:57-61).

## Spec Traceability

Requirements: `Finalize Lock Contention Error Message`, `Finalize Lock Staleness Fallback Via
Mtime`, `Stale Finalize Lock Surfaced In Status`, `Stale Finalize Lock Surfaced In Next Routing`
(all in `spec/changes/.../spec.md`, capability `finalize-ship`). Stories: US-1 through US-5.
