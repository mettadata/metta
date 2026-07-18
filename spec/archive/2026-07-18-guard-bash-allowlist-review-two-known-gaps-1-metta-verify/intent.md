# guard-bash-allowlist-review-two-known-gaps-1-metta-verify

## Problem

The 2026-07-17 two-tier trust-model change deferred two known authorization gaps in the metta guard hooks, and both now actively break documented workflows:

1. **`metta verify` and `metta gaps` fail closed as unknown subcommands.** Neither appears in `ALLOWED_SUBCOMMANDS`, `ALLOWED_TWO_WORD`, `BLOCKED_SUBCOMMANDS`, or `BLOCKED_TWO_WORD` in `src/templates/hooks/metta-guard-bash.mjs`, so `classify()` returns `unknown` and the hook blocks with exit 2. Yet the metta-verify skill's own contract (`.claude/skills/metta-verify/SKILL.md`, step 1) instructs running `metta verify --json --change <name>`, and the metta-fix-gap skill instructs `metta gaps list --json` / `metta gaps show <slug> --json` — both of which the guard currently rejects from orchestrator sessions. The two subcommands are not equivalent: `gaps` list/show forms are read-only queries, while `metta verify` executes gates (runs commands) and therefore must not be blanket-allowed.

2. **The metta-fix-gap→propose authorization dead end** (design-flagged 2026-07-15, pre-existing). The metta-fix-gap skill is an unforked Tier-2 skill — its mint hook scopes the session credential to `['fix-gap', 'complete', 'finalize']` (see `SKILL_SCOPES` in `src/templates/hooks/metta-session-mint.mjs`). But its Single Gap Pipeline step 2 instructs the bare CLI call `metta propose "fix gap: ..." --json`. `propose` is Tier-1 (fork-enforced via `SKILL_ENFORCED_SUBCOMMANDS`), authorized solely by a verified fork caller identity that a Tier-2 session credential can structurally never provide. The skill therefore instructs a call its own trust tier can never authorize — every fix-gap run hits a guaranteed guard block at step 2.

## Proposal

Resolve each gap according to its actual mutation profile, keeping the two-tier trust model intact:

**Gap 1a — allow-list `gaps` read-only forms.** Add `['gaps', new Set(['list', 'show'])]` to `ALLOWED_TWO_WORD` in `metta-guard-bash.mjs`. These are pure queries over `spec/gaps/` with no state-mutating side effects, matching the existing pattern for `issues list`, `changes list`, and `backlog list/show`. (`gaps remove` stays unlisted and continues to fail closed — it mutates state and its authorization is not in scope here.)

**Gap 1b — credential-gate `verify` as Tier-2.** `metta verify` runs gates, which execute commands — it is not read-only and must not join the allow list. Instead:
- Add `'verify'` to `BLOCKED_SUBCOMMANDS` in `metta-guard-bash.mjs`, so it classifies as Tier-2 `block` (credential-gated) instead of fail-closed `unknown`.
- Add `'verify'` to the `metta-verify` entry in `SKILL_SCOPES` in `metta-session-mint.mjs` (currently `['complete']`, becomes `['verify', 'complete']`), so the credential minted when the metta-verify skill is invoked authorizes the call its contract step 1 makes.

**Gap 2 — reroute fix-gap's propose step through the Skill tool.** Update the metta-fix-gap SKILL.md contract (both `src/templates/skills/metta-fix-gap/SKILL.md` and the deployed byte-identical copy at `.claude/skills/metta-fix-gap/SKILL.md`) so Single Gap Pipeline step 2 invokes the `/metta-propose` skill via the Skill tool (the fork path, which carries the trusted `agent_type`) instead of the bare `metta propose` CLI call — matching how CLAUDE.md routes propose for AI orchestrators. No guard or mint hook change is needed for this half; the fix is entirely in the skill contract wording.

**Tests and invariants:**
- Guard tests (`tests/metta-guard-bash.test.ts`): `gaps list` / `gaps show` allowed without any credential; `metta verify` blocked without a credential, allowed with a valid metta-verify session token, and blocked when the token's scope omits `verify`.
- Mint tests (`tests/metta-session-mint.test.ts`): update the scope table so the `metta-verify` entry expects `['verify', 'complete']`.
- A grep-style contract test asserting both copies of the metta-fix-gap SKILL.md use skill-invocation wording for propose and contain no bare `metta propose` CLI instruction.
- Both hook copies (template under `src/templates/hooks/` and deployed under `.claude/hooks/`) remain byte-identical; `node --check` passes after every hook edit.

## Impact

- **Unblocks the metta-verify skill** — its step-1 `metta verify` call currently dies at the guard; after this change the skill's own minted credential authorizes it, closing the contract-vs-guard contradiction without weakening enforcement (bare orchestrator `metta verify` calls stay blocked).
- **Unblocks the metta-fix-gap skill** — both its `metta gaps list/show` calls (now allow-listed) and its propose step (now routed through the fork-enforced skill path) work end to end; today the pipeline is guaranteed to fail.
- **Trust model unchanged in shape:** no subcommand moves to a weaker tier than its mutation profile warrants. `gaps` list/show joins the read-only allow list alongside its peers; `verify` becomes credential-gated exactly like `complete` and `finalize`; `propose` remains strictly fork-tier.
- **Files touched:** `src/templates/hooks/metta-guard-bash.mjs` + `.claude/hooks/metta-guard-bash.mjs`, `src/templates/hooks/metta-session-mint.mjs` + `.claude/hooks/metta-session-mint.mjs`, `src/templates/skills/metta-fix-gap/SKILL.md` + `.claude/skills/metta-fix-gap/SKILL.md`, `tests/metta-guard-bash.test.ts`, `tests/metta-session-mint.test.ts`, plus the new skill-contract wording test.
- **Audit trail:** Tier-2 `verify` acceptances and rejections flow through the existing `guard-bypass.log` append path with `tier: 'session'` — no logging changes required.

## Out of Scope

- Any change to Tier-1 fork enforcement: `propose`, `quick`, `auto`, `ship`, `issue`, `fix-issue` remain in `SKILL_ENFORCED_SUBCOMMANDS`, and `propose` is not added to any Tier-2 scope.
- Allow-listing `metta verify` outright — explicitly rejected; it executes gates and stays credential-gated.
- `gaps remove` (or any other mutating `gaps` form): stays unlisted / fail-closed; authorizing it is a separate decision.
- Restructuring metta-fix-gap into a forked (Tier-1) skill, or any change to its `SKILL_SCOPES` entry — only its SKILL.md propose-step wording changes.
- A general audit of other unknown-classified subcommands (`gate run`, `iteration` variants, etc.) beyond the two named gaps.
- Changes to the mint hook's TTL, token shape, rotation logic, or the guard's tokenizer/classifier structure.
- CLAUDE.md or docs regeneration (handled by the normal finalize flow, not authored here).
