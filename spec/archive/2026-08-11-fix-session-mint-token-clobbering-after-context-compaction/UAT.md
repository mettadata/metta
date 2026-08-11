# UAT: fix-session-mint-token-clobbering-after-context-compaction

- **Change**: fix-session-mint-token-clobbering-after-context-compaction
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Skill-aware staleness (prefer-own-slug re-mint): treat the existing token as stale when `existing.skill !== slug`, so the active skill's hook reclaims the token. Smallest change; narrows but does not fully eliminate the multi-stale-hook race, so design must analyze the residual failure window.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Scope merging on re-mint: union the existing token's `subcommands` with the minting skill's scope instead of replacing. Guard unchanged; tradeoff is scope ratchet — least-privilege weakens over a long session.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Per-skill token files: each hook writes only its own token (e.g. `.metta/scratch/skill-session/<slug>.token`); the guard authorizes if any unexpired token's scope covers the subcommand. Eliminates clobbering structurally; largest change surface (both hooks, orchestration-guard spec, tests), and any recently invoked skill's scope stays live for its full TTL.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: The mint script (`.claude/hooks/metta-session-mint.mjs`) and, if the token layout or validation semantics change, the guard (`.claude/hooks/metta-guard-bash.mjs`), keeping the guard's audit logging (accept and reject reasons) coherent with the new semantics.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: The design's explicit treatment of hook accumulation across context compaction as the operating environment — the fix must be correct when N stale Tier-2 mint hooks fire in arbitrary order on the same Bash call.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.6
- **Do**: Confirm: A security review of the chosen mechanism against the existing threat model: the token must remain non-forgeable from command text, and any scope broadening (options 2/3) must be an explicit, justified tradeoff recorded in the design.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.7
- **Do**: Confirm: Updates to the `orchestration-guard` capability spec so the documented two-tier trust model matches the shipped behavior.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.8
- **Do**: Confirm: Tests covering the regression scenario: token minted by skill A earlier in the session, skill B invoked later, skill B's in-scope subcommand is authorized (and A-only subcommands are still rejected when only B is active, to the extent the chosen mechanism preserves that property).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.9
- **Do**: Confirm: The CLAUDE.md workflow-section description of the Tier-2 credential, if the mechanism's observable behavior (token path, rotation semantics) changes.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Resolved issue `session-mint-token-clobbering-after-context-compaction` (major): accumulated Tier-2 skill mint hooks fought over the single `.metta/scratch/skill-session.token`, letting a stale skill's hook (first to fire at each TTL rotation window) claim the token and block the genuinely active skill's lifecycle commands with `subcommand-not-in-scope`.

#### Step 2.1
- **Do**: Confirm: `metta-session-mint.mjs` (template `src/templates/hooks/` + installed `.claude/hooks/`, byte-identical): mints only its own `.metta/scratch/skill-session/<slug>.token`; staleness check compares against its own file only; deletes expired/malformed sibling tokens and any lingering legacy single-file token.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `metta-guard-bash.mjs` (template + installed copy): scans the token directory; authorizes a Tier-2 subcommand when any structurally valid, unexpired token covers it. Denial-reason semantics preserved (`missing-credential` / `credential-expired` / `subcommand-not-in-scope`). Legacy single-file path is a clean cutover — neither written nor honored.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: `src/delivery/workflow-primer.ts` and `CLAUDE.md`: Tier-2 description updated to the per-skill path.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: Specs: `spec/specs/orchestration-guard/spec.md` (per-skill storage, non-interference, any-valid-credential acceptance, new scenario); `spec/specs/roadmap-feature/spec.md` (path references in a MUST clause updated in sync).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: Tests: `tests/metta-session-mint.test.ts`, `tests/metta-guard-bash.test.ts`, `tests/cli-metta-guard-bash-integration.test.ts` — regression coverage for concurrent mints not clobbering, coexisting different-skill fresh token no longer blocking, expired-only denial, sibling cleanup, legacy-token inertness.
- **Observe**: behaves as described
- [ ] Pass
