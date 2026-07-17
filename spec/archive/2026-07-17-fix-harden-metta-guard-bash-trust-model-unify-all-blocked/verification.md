# Verification: fix-harden-metta-guard-bash-trust-model-unify-all-blocked

**Date:** 2026-07-17
**Method:** Live synthetic `PreToolUse` JSON events piped to `node .claude/hooks/metta-guard-bash.mjs`
and `node .claude/hooks/metta-session-mint.mjs` against an isolated fixture cwd (audit log and token
file inspected after each call), plus static inspection and full gate runs. No source files modified.

**Overall verdict: PASS with one PARTIAL** — 7 of 8 requirements fully verified with live evidence;
the *Non-Forgeable Session Credential* requirement is PARTIAL on its fabricated-credential scenario
(analysis below). Implementation matches the approved design exactly; the gap is between the spec
scenario's literal wording and what a file-based credential validated by a stateless hook can
structurally enforce.

---

## R1 — Inline Command-Text Tokens Never Authorize a Blocked Subcommand: PASS

**Live:** `{"tool_input":{"command":"METTA_SKILL=1 metta finalize"}}` with no token file and no
`agent_type` → **exit 2**. stderr states authorization comes from the session credential "never by
inline command text" and credits the prefix with nothing. Audit record:
`{"verdict":"block","subcommand":"finalize","reason":"missing-credential","tier":"session"}`.

**Code inspection (scenario 2 — no text-only accept branch):** `.claude/hooks/metta-guard-bash.mjs`
has exactly three accept paths for blocked subcommands: `isTrustedSkillCaller(event)` (runtime
`agent_type`, lines 112–114, 195–201) and `readSessionToken(cwd)` (external file, lines 122–135,
203–215). `tokenize()` (lines 67–95) consumes env-var prefixes solely to locate the subcommand
behind them; no branch reads command text as an authorization signal. The retired
`inv.skillBypass` machinery is gone.

## R2 — Fork-Dispatched Subcommands Require Verified Caller Identity: PASS

**Live:** `metta ship --change x` with `agent_type: "metta-skill-host"` → **exit 0**. Same event
without `agent_type` → **exit 2**, stderr names the sanctioned entry point (`/metta-ship`), audit
record `{"reason":"skill-enforced subcommand without trusted agent_type","tier":"fork"}`.
`SKILL_ENFORCED_SUBCOMMANDS` covers exactly the six fork subcommands (guard lines 49–51);
`isTrustedSkillCaller` is the sole Tier-1 check per design ("sole check" statement) — the mechanism
is `event.agent_type`, unchanged, not weakened.

## R3 — Main-Session Lifecycle Subcommands Require a Non-Forgeable Session Credential: PARTIAL

**Live matrix (fixture cwd):**

| Case | Result | Audit reason |
|---|---|---|
| Mint via hook (`metta-session-mint.mjs metta-next`, Bash event) | token written, mode `0600`, `{skill:"metta-next",subcommands:["complete","finalize"],ttlMs:300000}` | — |
| In-scope `metta complete intent`, fresh token | **exit 0** | `session-credential-verified` (allow, tier session) — acceptance logged |
| Out-of-scope `metta refresh` under metta-next token | **exit 2** | `subcommand-not-in-scope` |
| `mintedAt` backdated 400s (> 300s TTL) | **exit 2** | `credential-expired` |
| Wrong-shape JSON (`token: ""`) | **exit 2** (fails closed) | `missing-credential` |
| **Hand-fabricated fresh, well-shaped, in-scope token file (made-up UUID)** | **exit 0 — ACCEPTED** | `session-credential-verified` |

Properties (b) bounded lifetime and (c) idle-absence are enforced and live-proven: 300 s sliding
TTL validated at every call (guard line 205), re-primed at 80% only while a Tier-2 skill's
frontmatter hook is active (mint hook lines 55–61), so an idle session's token decays and is
rejected.

**Fabrication analysis (the crux).** The spec scenario says a credential "the orchestrator
fabricated without going through the sanctioned issuance mechanism" MUST be rejected. The guard
validates shape + freshness + scope only; it never compares the token *value* against any issuer
record — there is no second channel, no shared secret, no signature. The token file **is** the
storage mechanism, and the guard structurally cannot distinguish a hook-minted file from a
hand-written one. My live test directly instantiates the scenario's GIVEN and the THEN fails: a
fabricated file passes.

Assessment against property (a) ("not derivable by reading any skill definition or documentation
file alone"): the *letter* holds for the read-only threat surface — no fixed credential value
exists in any skill or doc file, and zero skill contracts instruct authoring one. But the fuller
clause ("produced by a mechanism outside the orchestrator's own authored text") is only enforced
against the **command-text** surface the guard can see (it hooks Bash events only,
`tool_name !== 'Bash'` → exit 0 at line 165). An orchestrator using the Write tool, or a Bash
`node -e`/`cat >` that never mentions `metta`, can author a passing credential. The approved design
explicitly scoped the model this way ("not text-derivable", research: "a mechanism the orchestrator
cannot invoke by typing text") and design.md:112–116 maps the fabricated-credential scenario onto
`credential-expired` + `subcommand-not-in-scope` — i.e. the design consciously narrowed
"fabricated" to expired/out-of-scope sub-cases. The implementation matches that design exactly.

The reason-distinction clause ("distinguishes a credential mismatch from a missing credential") is
satisfied for the rejections that occur: `missing-credential` vs `credential-expired` /
`subcommand-not-in-scope` (three-way granularity in the audit log, per design). A literal
value-mismatch reason cannot exist because no value comparison exists.

**Residual-threat honesty:** summary.md's documented residual (in-scope over-breadth within TTL) is
a *different* residual; the file-write fabrication path is **not** documented in summary.md's
follow-ups. Materially, this residual is inherent to any same-directory file credential checked by
a stateless PreToolUse hook — an orchestrator with arbitrary file write in the repo can equally
edit the guard hook or `.claude/settings.local.json`, so the mechanism is roughly as strong as the
hook infrastructure itself, and it is a real hardening over the retired prefix (which every skill
*instructed* the orchestrator to type; nothing anywhere instructs writing a token file, and doing
so is an unambiguous, audit-visible willful bypass — the fabricated acceptance IS logged with the
subcommand and `session` tier). Verdict: **PARTIAL** — spec scenario not literally met; behavior
matches approved design. Recommend a follow-up to either (i) amend the spec scenario to the
design's narrowed meaning and document the file-write residual alongside the TTL-breadth residual,
or (ii) pursue issuer-side verification (requires state outside orchestrator write reach — e.g. a
secret held outside the repo cwd), which is materially harder for a stateless hook pair.

## R4 — Unrecognized metta Subcommands Fail Closed: PASS

**Live:** `metta somethingnew` → **exit 2**, stderr gives both remediations (update the allowlist
for read-only commands; use the Skill tool entry point whose mint hook issues the session
credential for skill-internal calls). Audit: `{"reason":"unknown","tier":null}`. The same
`classify() === 'unknown'` path (lines 106, 244–254) catches any future unclassified subcommand.
New allowlist entry verified: `metta next --json` → **exit 0** (guard line 21).

## R5 — Every Rejection and Every Tier-2 Acceptance Is Recorded: PASS

**Live:** every one of the eight rejections triggered during this verification produced exactly one
audit record in `<cwd>/.metta/logs/guard-bypass.log` with `tier` (`fork` / `session` / `null` for
unknown) and a distinguishing `reason` (`missing-credential`, `credential-expired`,
`subcommand-not-in-scope`, `skill-enforced subcommand without trusted agent_type`, `unknown`,
`background-bash-from-fork`). The Tier-2 acceptance was logged
(`{"verdict":"allow","reason":"session-credential-verified","tier":"session"}`). Fork-tier accept
(`metta ship` + `agent_type`) produced no record, consistent with the spec's MAY.

## R6 — Skill Contracts Reference Only the Sanctioned Authorization Mechanism: PASS

- `grep -rn METTA_SKILL .claude/ src/ CLAUDE.md` → **zero matches**; `REMOVE-AFTER-SHIP` → zero.
  Remaining `tests/` mentions are negative assertions only.
- No skill contract instructs typing any token (grep for token/prefix instructions across all
  `SKILL.md`: only an unrelated file-path "prefix" in metta-execute).
- All 9 Tier-2 skills carry the mint-hook frontmatter in both copies (`.claude/skills/` +
  `src/templates/skills/`): **metta-next, metta-plan, metta-execute, metta-verify, metta-refresh,
  metta-import, metta-init, metta-backlog, metta-fix-gap** — slugs match the mint hook's
  `SKILL_SCOPES` keys exactly.
- Detectable-violation scenario: `tests/skill-iteration-record.test.ts:39,47` asserts
  `METTA_SKILL=1` never reappears in skill bodies;
  `tests/cli-metta-guard-bash-integration.test.ts` asserts the retired mechanisms stay inert.
- Byte-identity: all 15 `SKILL.md` pairs identical (`cmp`), plus `metta-guard-bash.mjs`,
  `metta-session-mint.mjs`, and `agents/metta-skill-host.md` pairs identical.

## R7 — Forked Agents Are Blocked From Running Background Bash: PASS (regression held)

**Live:** `{"run_in_background":true, "agent_type":"metta-skill-host"}` → **exit 2** before any
subcommand classification (guard lines 170–180, ahead of `tokenize`); stderr instructs running in
the foreground; audit `{"reason":"background-bash-from-fork","tier":"fork"}`. Same event without
`agent_type` (benign `sleep 5`) → **exit 0** — the rule does not fire for non-fork callers.

## R8 — The Trust Model Is Documented: PASS

- **Guard header** (`.claude/hooks/metta-guard-bash.mjs:2-13`): names the six fork-tier and the
  session-tier subcommands, the authorizing signal for each ("Not forgeable from command text" /
  "Not derivable from reading any skill file"), and the emergency bypass
  (`.claude/settings.local.json`).
- **Generated workflow guidance** (`CLAUDE.md:44-47`, source `src/delivery/workflow-primer.ts:22-25`,
  byte-consistent): describes both tiers, the non-forgeability rationale per tier, and the
  emergency bypass. Zero references to the retired inline-token model as a live mechanism
  (repo-wide `METTA_SKILL` grep is clean).
- Note: the header/primer claim "not derivable from reading any skill file" is accurate as stated;
  the R3 file-*write* residual above is a distinct surface the docs do not (yet) mention.

---

## Gates

| Gate | Result |
|---|---|
| `npx vitest run` | **1131 passed / 1131 (83 files)** on two consecutive full runs. First run showed 1 transient failure (1130/1131) that did not reproduce on either re-run and whose id was not surfaced before retry output; flake, not attributable to this change's suites (guard/mint/skill tests passed in all runs). |
| `npx tsc --noEmit` | clean (exit 0) |
| `npm run lint` | clean (exit 0; lint = `tsc --noEmit` in this project) |
| `npm run build` | clean (exit 0), templates copied to `dist/` |

## Fixture hygiene

All synthetic events used an isolated fixture cwd under the session scratchpad; fixture and its
planted/fabricated token files deleted after verification. The live mid-session token at
`.metta/scratch/skill-session.token` (gitignored) was not touched.

## Recommended follow-ups

1. Log an issue for the R3 file-write fabrication residual: amend the orchestration-guard spec's
   fabricated-credential scenario to the design's narrowed meaning (expired / out-of-scope /
   malformed) and document the residual next to the existing TTL-breadth note — or design
   issuer-side verification if the threat is deemed unacceptable.
2. (Already in summary.md) Allowlist review for `verify`/`gaps`; metta-fix-gap → `metta propose`
   Tier-1 gap.
