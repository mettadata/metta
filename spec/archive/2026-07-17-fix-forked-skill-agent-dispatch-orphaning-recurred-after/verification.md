# Verification: fix-forked-skill-agent-dispatch-orphaning-recurred-after

Verified 2026-07-17 on branch `metta/fix-forked-skill-agent-dispatch-orphaning-recurred-after` against the 4-requirement `orchestration-guard` delta in `spec.md`. All live probes were executed against the deployed hook (`.claude/hooks/metta-guard-agent-dispatch.mjs`) with synthetic PreToolUse events in an isolated fixture cwd.

## Overall verdict: PASS

All four requirements verified with live evidence; all gates green; experiment evidence internally consistent with its NOT-GREEN verdict and no ledger follow-up issue logged.

---

## R1 — Fork Dispatch Completion Guarantee: PASS

The shipped control is the spec's mechanism (b): `Agent` dispatches from fork context are forced synchronous by rejecting the backgrounding dispatch shape before it executes. Caller-identity scoping is structural — the hook is registered only in `metta-skill-host.md`'s frontmatter (`hooks: PreToolUse / matcher: Agent`, `.claude/agents/metta-skill-host.md:4-9`), so it never runs for non-fork callers.

Live probes (synthetic events piped to `node .claude/hooks/metta-guard-agent-dispatch.mjs`, fixture cwd):

| Probe | Event | Expected | Observed |
|---|---|---|---|
| A | Agent, `run_in_background: true` | exit 2 + block audit | exit 2; audit line `{"verdict":"block","reason":"rejected-async-agent-dispatch","tier":"fork","agent_type":"metta-skill-host","subagent_type":"metta-implementer",...}` |
| B | Agent, `run_in_background: false` | exit 0, no audit | exit 0; log still 1 line |
| C | Agent, field absent | exit 0, no audit | exit 0; log still 1 line |
| D | `tool_name: "Bash"` (non-Agent) | exit 0, no audit | exit 0; log still 1 line |
| E | Agent, `run_in_background: "true"` (string drift shape) | exit 0 + fail-open audit | exit 0; audit line `{"verdict":"allow","reason":"fail-open-unrecognized-shape","observed_run_in_background":"\"true\"",...}` |

Probe E satisfies the amended-guarantee branch: pass-through on unrecognized shape **with** an audit record carrying the observed shape, with the recovery protocol (R3) as documented backstop.

- Scenario "Enforcement fires..." — probe A (exit 2 blocks the detaching dispatch shape).
- Scenario "...ends its turn normally" — probes B/C: synchronous dispatches pass untouched; under mechanism (b) a fork whose children all ran synchronously has nothing outstanding, so no interference. Hook source confirms exit 0 with no side effects (`metta-guard-agent-dispatch.mjs:85-87`).
- Scenario "Non-fork callers are unaffected" — structurally guaranteed by frontmatter-only registration (the hook is named in no other agent file and not in `.claude/settings.json`-level hooks; grep found only the two `metta-skill-host.md` copies). Probe D additionally shows non-Agent events pass.

Unit coverage: `tests/metta-guard-agent-dispatch.test.ts` (13 tests, passing in the suite run below).

## R2 — Truthful Fork Results: PASS

- Rejection stderr instructs wait-then-return (probe A, verbatim): *"Re-issue this Agent dispatch in the foreground and wait for the outstanding dispatched child to complete before returning — never end your turn with a dispatched child still in flight."* It also points to the two host-contract sections by name. This satisfies "instructs the fork to wait... rather than merely rejecting."
- In-progress-narration-is-failure clause present in both host copies (`.claude/agents/metta-skill-host.md:35` and `src/templates/agents/metta-skill-host.md:35`): *"any fork result that narrates in-progress or background work ... is a failed, non-terminal result. Never treat such a result as success."* The hard rule at line 30 additionally forbids the fork's final message from describing launched work as in progress.
- "Terminal result never narrates in-progress work" is enforced by the combination: mechanism (b) prevents the detached-child state from arising, and the contract clause makes any residual narration a failed result on the orchestrator side. Contract-plus-mechanism is what the spec prescribes here.

## R3 — Residual Orphaning Recovery Protocol: PASS

- Protocol section present in both host copies (byte-identical pair, `cmp` clean) at `metta-skill-host.md:32-38`, covering all three mandated elements: (a) detection (in-progress narration = failed non-terminal), (b) wait/attach, (c) confirmed-dead re-dispatch resuming from `spec/changes/<name>/` persisted state.
- Duplicate dispatch explicitly forbidden (line 36, verbatim): *"It MUST NOT dispatch a duplicate `Agent` call for the same in-flight work."*
- One-line pointer present in all six fork skills, both copies each — 12/12 files confirmed by grep: `metta-issue` (SKILL.md:63), `metta-fix-issues` (:121), `metta-propose` (:282), `metta-quick` (:215), `metta-auto` (:91), `metta-ship` (:27), identical line in each `src/templates/skills/` counterpart: *"If a dispatched step appears orphaned, follow the residual orphaning recovery protocol in metta-skill-host.md."*

## R4 — Fork-Dispatch Enforcement Events Are Recorded: PASS

- **Rejected async dispatch shape** (mandated scenario): probe A's audit record carries event type (`verdict: block`, `reason: rejected-async-agent-dispatch`), tier (`tier: fork`), and identity (`agent_type: metta-skill-host`, `subagent_type: metta-implementer`), written as JSONL to `<cwd>/.metta/logs/guard-bypass.log` — the capability's existing audit trail, schema-compatible with `metta-guard-bash.mjs` entries.
- **Fail-open** record (probe E) carries the same tier/identity fields plus `observed_run_in_background`, distinguishing outcome by `reason`.
- **Blocked turn-end**: under the shipped mechanism (b) — forced-synchronous dispatch — a fork cannot reach the "turn-end with pending child" state through a recognized dispatch shape, so this event class does not occur; the rejected-dispatch record is the enforcement record for this mechanism. Consistent with R1's either/or framing.
- **Recovery-protocol invocation** — honest assessment: this is contractual, not mechanical. The host contract's Observability clause (`metta-skill-host.md:38`) requires the orchestrator to record the invocation and the orphan's identity in the commit message or artifact trail. There is no runtime hook point for "orchestrator decides to invoke a prose protocol," so no mechanical record is possible; git commits/artifacts are a durable, inspectable record, and the spec explicitly permits "the audit log **or an equivalent durable record**." A session where enforcement never fired leaves no such trail note, so the distinguishing test in the scenario is met — conditional on orchestrator compliance with a MUST clause. Judged adequate for the spec as written; noted as the weakest of the three record types.

## Experiment evidence (`experiment-posttooluse-timing.md`): PASS

- File exists in the change directory; method, observations, verdict, and consequence sections all present.
- Internal consistency: probe 1 fired at +8.978s, probe 2 at +9.011s — both match the stated "+9.0s"; in both runs the single PostToolUse firing precedes the child's completion (03:00:41.878 < ~03:00:46; 03:02:08.891 < ~03:02:52) and zero events fired at completion (log checked >80s past probe 1's completion). Minor note: the approximate "child ran" column appears computed from dispatch time for probe 1 and acknowledgment time for probe 2, a ~9s bookkeeping wobble in an explicitly approximate column — it does not affect the verdict, which rests on the exact firing timestamps.
- The NOT-GREEN verdict follows from the observations (dispatch-time firing breaks the ledger's clearing premise), and per tasks.md's green-gate, **no ledger follow-up issue exists**: grep of `spec/issues/` for ledger/posttooluse/subagentstop returns nothing (12 issues present, none related).

## Hook wiring and pair integrity: PASS

- `hooks:` block naming `.claude/hooks/metta-guard-agent-dispatch.mjs` present in both host copies (line 9 of each).
- Byte-identity: `cmp` clean on the hook pair (`.claude/hooks/` vs `src/templates/hooks/`) and the host pair (`.claude/agents/` vs `src/templates/agents/`).
- `node --check` clean on both hook copies.
- Build copies templates to `dist/templates/hooks/metta-guard-agent-dispatch.mjs` and `dist/templates/agents/metta-skill-host.md` (verified post-build).

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` | 84 files passed, **1155/1155 tests passed** (242s) |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean (templates copied to dist) |

Fixture directories were removed after probing; no repository source files were modified by verification.
