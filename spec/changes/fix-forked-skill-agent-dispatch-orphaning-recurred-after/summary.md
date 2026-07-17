# Implementation Summary: fix-forked-skill-agent-dispatch-orphaning-recurred-after

## What changed

Fork-dispatched agent orphaning — the failure mode that hit every forked-skill invocation of the v0.2 milestone (~9 manual recoveries) — now has mechanical enforcement plus a codified recovery floor.

- **Dispatch guard** (`metta-guard-agent-dispatch.mjs`, new hook pair): a PreToolUse hook scoped to the Agent tool via `metta-skill-host.md`'s own frontmatter (identity by scoping — it only runs for the fork host). A dispatch with `run_in_background === true` is rejected (exit 2) with a reason instructing the fork to wait for its child; the event is audit-logged (`tier: fork`, `reason: rejected-async-agent-dispatch`). Unrecognized field shapes fail open **with** an audit record (`fail-open-unrecognized-shape`), per the spec's amended, honestly-scoped guarantee.
- **Recovery protocol codified** (`metta-skill-host.md` + one-line pointers in all six fork skills): in-progress narration in a fork result = failed non-terminal result; wait for/attach to the orphan, never dispatch a duplicate; re-dispatch fresh work only after the orphan is confirmed dead/complete, resuming from persisted change state. This codifies the manual recovery performed ~9 times during v0.2.
- **The deferred SubagentStop ledger is dead**: the research-prescribed live experiment (two instrumented background dispatches with a temporary PostToolUse probe — see `experiment-posttooluse-timing.md`) proved PostToolUse fires at dispatch acknowledgment (+9s both runs), never at child completion — the ledger's clearing premise is broken. NOT GREEN; no follow-up issue logged; the forced-synchronous rejection stands as the only viable mechanical control.

## Requirement coverage

All 4 orchestration-guard delta requirements: Fork Dispatch Completion Guarantee (amended to scope detection to documented dispatch shapes with audited fail-open), Truthful Fork Results, Residual Orphaning Recovery Protocol, Fork-Dispatch Enforcement Events Are Recorded.

## Verification

Suite 1155/1155 (84 files, +24 net new tests); tsc/build clean; grep proofs: recovery pointer in all 6 fork skills, hook wired in host frontmatter, all pairs byte-identical. Live probes: background dispatch → exit 2 + audit record; foreground → pass; drift shape → audited fail-open.

## Commits

`c2208978f` (dispatch guard), `78b2a3b14` (guard tests), `b25ec9d45` (stale version-literal test fix, pre-existing), `aa61a48c5` (wiring + recovery protocol), plus spec amendment and experiment evidence.

## Notes

- Deviation: fail-open path upgraded from silent to audited per the pre-implementation spec amendment.
- Bonus fix: cli-skills.test.ts hardcoded `0.1.0` (rotted by the v0.2.0 release) now reads package.json.
- The enforcement's first real-world test will be the next forked-skill invocation whose host attempts a background dispatch — expect audit records in `.metta/logs/guard-bypass.log`.
