# Research: Generic wording fix without an enumerated list

**Approach under evaluation** (candidate solution 3 from the issue): rewrite the primer's
`MANDATE` and Forbidden bullet to scope the ban to state-mutating commands, and keep the
read-only subsection generic — "the guard hook permits read-only status/list queries; when
in doubt attempt the command — the hook fails closed" — with no enumerated command list
that can go stale.

## 1. Current state (verified in this worktree)

### `src/delivery/workflow-primer.ts` (71 lines)

- `MANDATE` (line 11): `"AI orchestrators MUST invoke the matching metta skill — never
  call the CLI directly."` — shared verbatim by both variants (documented consistency
  invariant in the file header, lines 6–8).
- `workflowPrimerShort()` (line 28): mandate + 3 entry points + 5-line trust-model block +
  refresh pointer. Injected into consumer CLAUDE.md by `claude-code-adapter.ts:76`
  (install scaffold) and `discovery-helpers.ts:143` (init). ~14 logical lines, though the
  Tier-2 trust bullet is a very long single line.
- `workflowPrimerLong()` (line 43): adds the Forbidden section — line 60 is the offending
  bullet banning "any other `` `metta <cmd>` `` directly from an AI orchestrator session" —
  plus quick-mode routing and Research discipline. Injected by `refresh.ts:127` into the
  `metta:workflow` region of every consumer CLAUDE.md.
- Injection cost today: long variant ≈ 27 content lines. A generic read-only paragraph adds
  ~3–5 lines to the long variant and ~1–2 to the short; a full enumerated list (candidate
  solution 1) would add ~12–15 lines to the long variant and grow with every allowlist
  change.

### `.claude/hooks/metta-guard-bash.mjs` — fail-closed confirmation

The "when in doubt, attempt it" guidance is **safe**. Verified in `classify()`
(lines 660–680): the decision ladder is allow-lists → block-lists → `return 'unknown'`,
and `main()` treats `'unknown'` as a hard block (`process.exit(2)`, lines 982–992). There
is no fall-through allow for unrecognized `metta` subcommands. The only textual evasions
are the documented wrapper/indirection limitations (lines 138–157), which are irrelevant
to a cooperating session typing plain commands. Comments in the hook state the fail-closed
direction explicitly (e.g. lines 55, 59, 93). An attempted read-only-looking command can
therefore only succeed (it was allowed) or be blocked (exit 2) — it can never mutate state
by accident.

### What a blocked attempt teaches the session

Three relevant block messages:

1. **Unknown subcommand** (lines 984–990): "Blocked unknown metta subcommand '`<sub>`' …
   Update the allowlist in metta-guard-bash.mjs if this is a legitimate read-only
   command." — This *does* teach that a read-only allow surface exists and that this
   particular command isn't on it. It does **not** list what is allowed, and the "update
   the allowlist" advice is aimed at metta developers, not consumer sessions.
2. **Skill-enforced (Tier 1)** (lines 973–978): names the exact `/metta-<skill>` to use —
   good redirection, no read-only information.
3. **Tier-2 block** (lines 1000–1006): points at CLAUDE.md and the credential model — no
   read-only information.

So the feedback loop is real but weak: a session that *tries* commands converges by trial
and error, one block message at a time. A session that never tries (because the primer
told it "never call the CLI") gets nothing — which is exactly the zeus failure.

### Discoverability channels that survive without an enumerated list

- **Bare `metta` is guard-allowed** (`classify()` line 671: no subcommand → allow) and
  Commander prints the full top-level command listing (verified by running the installed
  CLI: usage + every registered command with descriptions). A generic primer can therefore
  point at bare `metta` as the self-updating command reference — zero drift, always
  matches the installed CLI version.
- **Limitation of that channel:** drill-down help on two-word groups is blocked. `metta
  milestone --help` and bare `metta milestone` both classify as `'unknown'` (milestone is
  not in `ALLOWED_BARE`, and `--help`/absent third token is not in its
  `ALLOWED_TWO_WORD` set {list, show}) → exit 2. The top-level listing shows that a
  `milestone` command *exists* but not that `milestone show` specifically is permitted.
  The same applies to `gaps`, `issues`, `gate`, `changes` (their bare forms are unknown →
  blocked; only specific two-word forms are allowed).

## 2. Wording sketch (generic-only variant)

`MANDATE` replacement (shared by both variants, preserving the consistency invariant):

> **AI orchestrators MUST invoke the matching metta skill for any state-mutating metta
> command — never run lifecycle commands like `metta propose`, `metta complete`, or
> `metta finalize` directly.** The `metta-guard-bash` PreToolUse hook is the enforcement
> authority: it permits read-only status/list queries directly and fails closed on
> everything else. (Humans running the CLI in a terminal are unaffected — this rule
> scopes to AI-driven sessions.)

New read-only paragraph (long variant, after the entry points; one-line version in short):

> **Read-only queries are permitted directly.** The guard hook allows the CLI's read-only
> query surface (status, progress, and list/show commands) from any session. Run bare
> `metta` for the current command listing. When in doubt, just attempt the command — the
> guard fails closed: anything unrecognized or state-mutating is blocked with an
> explanation, so an attempt is always safe and never mutates state.

Forbidden bullet (line 60) replacement:

> - Running any state-mutating `metta` command (lifecycle, backlog/milestone/roadmap/
>   release mutations, `changes abandon`) directly from an AI orchestrator session. Use
>   the matching skill. Read-only queries are exempt — see "Read-only queries" above.

Note the Forbidden bullet names mutating *families*, not an exhaustive command list — the
family names (lifecycle, backlog mutations, …) are stable even when individual subcommands
are added.

## 3. Drift-resilience

- **Generic-only: effectively zero drift surface.** The wording makes only two factual
  claims about the hook: (a) it permits a read-only surface, (b) it fails closed. Both
  are structural properties of the hook's architecture (allow-list-first + `'unknown'` →
  block), not membership facts. Allowlist additions (`gaps`, `milestone`, `release
  status` were all added after the primer was written — the comments at hook lines 53–63
  show this churn is real and recent) never invalidate the primer.
- **The bare-`metta` pointer is self-updating** — the help listing comes from the
  installed CLI, so it is always current for that consumer's version.
- **Failure directionality is the key win:** if wording and hook ever disagree again, the
  generic phrasing degrades to "attempt it and let the guard decide" — a mild efficiency
  loss — rather than to false prohibition (the zeus failure mode). Candidate solution 1's
  enumerated list degrades to *stale enumeration*, which recreates the original bug shape
  (primer under-reports the allowed surface) as soon as the hook gains a new allow entry.

## 4. Discoverability tradeoff — honest assessment

The zeus failure had **two halves**, and generic wording fixes only one cleanly:

1. **False prohibition** ("permitted commands are forbidden") — **fully fixed.** The
   mandate no longer bans the read-only surface, and the fail-closed guidance gives
   explicit permission to experiment.
2. **Discoverability** ("sessions never learned `metta milestone show` existed") —
   **only partially fixed.** A generic primer tells the session *that* a permitted
   surface exists and *how* to probe it (bare `metta`, trial-and-error against a
   fail-closed guard), but not *which* commands to reach for. The specific zeus case is
   instructive: to find `milestone show`, a session must (a) run bare `metta`, (b) notice
   the `milestone` entry, (c) guess `show`/`list` as third words, because `metta
   milestone --help` is itself blocked. That is a plausible but multi-step path; a
   time-pressed session may still fall back to grepping `spec/**`. Trial-and-error also
   burns turns: each probe that lands on an unlisted form costs a blocked Bash call and a
   stderr lecture.

Honest verdict: generic-only is a *correctness* fix with a *partial* discoverability fix.
It removes the reason sessions avoided the CLI but does not hand them the map.

### Hybrid: generic rule + short curated examples list (recommended)

Add one line of curated examples to the read-only paragraph, framed as **examples, not an
exhaustive enumeration**:

> High-value examples: `metta status`, `metta progress`, `metta issues list`,
> `metta changes list`, `metta milestone list` / `metta milestone show <slug>`.

Drift math for the hybrid is asymmetric in the safe direction:

- **Additions to the hook's allowlists never invalidate it** — "examples" makes
  incompleteness correct by construction. This kills the dominant drift mode (the hook
  history shows additions, not removals).
- **Only removal/renaming of a listed command creates drift**, and the five commands above
  are the most stable, load-bearing queries in the surface (`status` and `progress` are
  the backbone of the status skills; `issues list`/`changes list`/`milestone show` are
  exactly what zeus needed). Removal risk over the plausible life of the wording: low.
- Cost: one extra primer line, one extra test assertion, plus a two-line sync-reminder
  comment in the hook's allowlist block pointing at the primer (as the intent already
  proposes).

The hybrid directly patches the discoverability half at the exact spot the evidence says
sessions fail (they needed `milestone show` and never found it), while keeping the drift
surface a fraction of candidate solution 1's full enumeration (5 stable examples vs ~25
entries across three allow structures).

## 5. Test impact

Verified against `tests/delivery.test.ts` (the primer's test home):

- **No existing test pins the current mandate or Forbidden wording.** Grep for "never
  call the CLI" / "any other \`metta" across `tests/` matches nothing. Existing primer
  assertions cover the Research-discipline section (lines 73–102) and Tier-2 trust-model
  wording (lines 105–119) — none of that text changes, so **zero existing tests break**.
- New tests needed (same file, matching the existing `toContain` style):
  1. Both variants scope the mandate to state-mutating commands (e.g. contain
     "state-mutating" and no longer contain "never call the CLI directly").
  2. Both variants carry the fail-closed guidance ("fails closed" / "attempt the
     command").
  3. Long variant's Forbidden section no longer contains "any other \`metta <cmd>\`".
  4. (Hybrid) long variant contains the curated examples line (e.g. `metta milestone
     show`).
- Downstream: `installCommands` / refresh region tests consume the same functions, so
  they follow automatically; docs updates (`docs/workflows/README.md` §"Core rule:
  skills, not CLI" lines 45–51, and the blockquote in `docs/internals/guard-hooks.md`
  lines 24–27) are untested prose.
- No snapshot tests exist for the primer — no snapshot churn.

## 6. Effort estimate

| Item | Generic-only | Hybrid (generic + 5 examples) |
|---|---|---|
| `workflow-primer.ts` rewrite (MANDATE, Forbidden bullet, new paragraph) | ~1h | +15min |
| `tests/delivery.test.ts` additions (3–4 cases) | ~30min | +10min |
| `docs/workflows/README.md` + `docs/internals/guard-hooks.md` wording | ~30min | ~30min |
| Sync-reminder comments in hook allowlist blocks | — | ~10min |
| Regenerate own CLAUDE.md region via refresh skill + review | ~15min | ~15min |
| **Total** | **~2–2.5h** | **~2.5–3h** |

Both are quick-mode-sized: one source file + its test file + two docs files + a
comment-only hook touch; no logic changes anywhere.

## 7. Recommendation

**Adopt the hybrid: generic mutating-scoped mandate + fail-closed guidance + bare-`metta`
pointer + a five-command "examples" line.** Pure generic wording is the most
drift-resilient option and fully cures the false-prohibition failure, but the issue's own
evidence shows the costly half was discoverability — zeus needed one specific command
name it never saw. Five curated examples framed as non-exhaustive buy back that
discoverability at near-zero drift cost (additions can never make the list wrong; only
removal of a highly stable command could). If the maintainer weights drift-elimination
absolutely, generic-only is acceptable — but it should at minimum keep the bare-`metta`
pointer, since that is the only zero-drift channel through which a session can learn
concrete command names, and the guard verifiably permits it.

Secondary observation (out of scope here, worth a backlog note): the hook's
unknown-command block message (lines 984–990) is the one surface that is *guaranteed*
in sync with the allowlists; having it print the allowed read-only surface on block would
be a drift-proof discoverability channel that no primer wording can match.
