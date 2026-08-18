# UAT: fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle

- **Change**: fix-metta-guard-bash-blocks-main-session-tier-2-lifecycle
- **Generated**: 2026-08-18
- **Source**: user stories (stories.md)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

### US-1: Tier-2 lifecycle commands succeed after legitimate skill invocation

*Independent test:* With a per-slug token minted by a simulated skill warm-up, an in-scope Tier-2 call is authorized by the guard from both the main-session cwd and a worktree cwd.

#### Step 1.1
- **Setup**: an in-context skill (e.g. `/metta-next`) has minted its per-slug session token
- **Do**: the orchestrator immediately runs an in-scope Tier-2 command (e.g. `metta complete research --change <c>`) from the main session
- **Observe**: the guard authorizes the call instead of blocking with "credential-expired"
- [ ] Pass

#### Step 1.2
- **Setup**: a per-slug token minted at skill warm-up
- **Do**: the Tier-2 call is issued from a worktree cwd rather than the main-session cwd
- **Observe**: the guard resolves the token and authorizes the in-scope call
- [ ] Pass

#### Step 1.3
- **Setup**: a valid, in-scope, live credential
- **Do**: the guard evaluates the Tier-2 call
- **Observe**: the call is never rejected on freshness grounds while the invoking skill session is genuinely active
- [ ] Pass

### US-2: Credential survives long subagent delegation windows

*Independent test:* An integration test mints a token, advances the clock past the raw TTL to simulate subagent delegation, and the subsequent in-scope Tier-2 call is still authorized under the new freshness rules.

#### Step 2.1
- **Setup**: a token minted at skill warm-up
- **Do**: the clock advances past the original 5-minute TTL during subagent-delegated work and the orchestrator then runs an in-scope Tier-2 command
- **Observe**: the guard authorizes the call via the deterministic skill-activity check or the lifecycle-aware freshness window
- [ ] Pass

#### Step 2.2
- **Setup**: an actively-used main session
- **Do**: Bash calls fire before 80% of TTL elapses
- **Observe**: the sliding refresh behavior is retained and the token stays fresh
- [ ] Pass

#### Step 2.3
- **Setup**: no active skill invocation and no eligible token (a genuinely dead credential)
- **Do**: a Tier-2 command is attempted
- **Observe**: the guard still fails closed and blocks the call
- [ ] Pass

### US-3: Deterministic authorization independent of parallel hook ordering

*Independent test:* An integration test evaluates the guard while the token is expired-but-eligible-for-remint (mint hook not yet run) and the call is authorized, not failed closed.

#### Step 3.1
- **Setup**: a token that is past raw TTL but eligible for re-prime by an active skill session
- **Do**: the guard evaluates the Tier-2 call before any mint-hook refresh lands
- **Observe**: the guard re-primes/accepts the matching per-slug token and authorizes the call
- [ ] Pass

#### Step 3.2
- **Setup**: the documented parallel, unordered PreToolUse hook execution
- **Do**: the mint and guard hooks fire on the same Bash event in any order
- **Observe**: the authorization outcome is identical regardless of ordering
- [ ] Pass

#### Step 3.3
- **Setup**: the fix in place
- **Do**: Tier-2 freshness is evaluated
- **Observe**: no assumption of new hook-ordering guarantees from the Claude Code runtime is required
- [ ] Pass

### US-4: Trust model boundary preserved

*Independent test:* All existing guard tests for absent, malformed, and out-of-scope tokens, Tier-1 fork identity, and allow/block classification continue to pass unchanged.

#### Step 4.1
- **Setup**: a missing or malformed credential and no active skill
- **Do**: a Tier-2 command is attempted
- **Observe**: the guard blocks with `missing-credential` exactly as before
- [ ] Pass

#### Step 4.2
- **Setup**: a token whose scope does not cover the requested subcommand
- **Do**: the Tier-2 call is evaluated
- **Observe**: the guard blocks with `subcommand-not-in-scope` exactly as before
- [ ] Pass

#### Step 4.3
- **Setup**: the skill-activity marker used for deterministic re-prime
- **Do**: an orchestrator attempts to fabricate authorization from command text or skill-file contents
- **Observe**: the marker cannot be derived or forged that way and the call is not authorized
- [ ] Pass

#### Step 4.4
- **Setup**: the change is complete
- **Do**: Tier-1 fork-identity checks, classification lists, tokenization, and `--` operand handling are exercised
- **Observe**: their behavior is byte-for-byte unchanged
- [ ] Pass

### US-5: Diagnosable audit trail for authorization decisions

*Independent test:* Guard evaluations write `credential-expired` only for genuinely dead credentials, and new acceptance paths write an entry recording their authorization reason.

#### Step 5.1
- **Setup**: a genuinely dead credential (no active skill, no eligible token)
- **Do**: a Tier-2 call is blocked
- **Observe**: a `credential-expired` audit entry is written as before
- [ ] Pass

#### Step 5.2
- **Setup**: a call authorized via a new acceptance path (deterministic re-prime or grace window)
- **Do**: the guard allows it
- **Observe**: the audit log records the authorization reason for that path
- [ ] Pass

#### Step 5.3
- **Setup**: a live skill session
- **Do**: in-scope Tier-2 calls are made
- **Observe**: no false `credential-expired` entries appear in the log
- [ ] Pass

### US-6: Documentation reflects the corrected TTL lifecycle

*Independent test:* The two-tier trust model description in the hook headers (and CLAUDE.md workflow section, if its Tier-2 wording changes) accurately describes the new freshness rules with no reference to the retired racing-refresh behavior as current.

#### Step 6.1
- **Setup**: the fix has landed
- **Do**: a reader consults the guard and mint hook header comments
- **Observe**: they describe the deterministic re-prime/grace freshness model, not the bare `now - mintedAt < ttlMs` race
- [ ] Pass

#### Step 6.2
- **Setup**: the CLAUDE.md workflow section's Tier-2 wording no longer matches the implementation
- **Do**: documentation sync is performed
- **Observe**: the section is updated to match the corrected TTL lifecycle
- [ ] Pass

## Additional scenarios

#### Step 7.1: Expired-but-refreshable token is authorized before any mint-hook refresh lands
- **Setup**: a per-slug session token that is structurally valid and in scope for the invoked Tier-2 subcommand, is past its raw TTL, and is eligible for re-prime because the invoking skill session is genuinely active
- **Do**: the guard evaluates the Tier-2 call before any mint-hook refresh has rewritten the token on that event
- **Observe**: the guard re-primes or accepts the token and authorizes the call instead of blocking with a credential-expired rejection
- [ ] Pass

#### Step 7.2: Authorization outcome is invariant under mint/guard hook ordering
- **Setup**: the mint hook and the guard hook both fire on the same Bash event carrying an in-scope Tier-2 call, with a token state that the new freshness rules authorize
- **Do**: the two hooks execute in either order, or the mint hook does not fire on that event at all
- **Observe**: the guard's authorization outcome is the same in every ordering, with no dependence on which hook's filesystem effect landed first
- [ ] Pass

#### Step 7.3: No new runtime ordering guarantee is assumed
- **Setup**: the fixed guard's Tier-2 freshness evaluation logic
- **Do**: that logic is inspected for assumptions about PreToolUse hook scheduling
- **Observe**: it contains no branch whose correctness requires the Claude Code runtime to order, serialize, or guarantee delivery of the separate mint hook relative to the guard
- [ ] Pass

#### Step 7.4: Fabricated activity evidence from command text does not authorize
- **Setup**: an orchestrator attempts to satisfy the re-prime path by supplying activity evidence authored in its own command text or copied from skill-file contents, with no genuinely invoked skill session
- **Do**: the guard evaluates a Tier-2 call
- **Observe**: the re-prime path does not fire and the call is rejected through the existing fail-closed paths
- [ ] Pass

#### Step 7.5: Activity signal originates only from sanctioned invocation machinery
- **Setup**: the mechanism that writes the skill-activity signal
- **Do**: its write path is inspected
- **Observe**: the signal is produced only by the skill-invocation-time hook machinery (never sourced from event command text), and its authorizing value appears in no skill definition or documentation file
- [ ] Pass

#### Step 7.6: Activity signal never widens scope
- **Setup**: a live skill-activity signal for a skill whose scope does not cover the invoked Tier-2 subcommand, and no other valid in-scope token
- **Do**: the guard evaluates the call
- **Observe**: the call is rejected with the existing scope-mismatch reason — the activity signal contributed freshness eligibility only, not scope
- [ ] Pass

#### Step 7.7: Token outlives the raw TTL across a delegation window and still authorizes
- **Setup**: a per-slug token minted at skill warm-up
- **Do**: the clock advances past the original raw TTL while work is delegated to subagents (no intervening main-session Bash call refreshes the token) and the orchestrator then runs an in-scope Tier-2 command
- **Observe**: the guard authorizes the call via the lifecycle-aware freshness window or the deterministic re-prime path
- [ ] Pass

#### Step 7.8: Sliding refresh for active sessions is retained
- **Setup**: an actively used main session holding a fresh per-slug token
- **Do**: a Bash call fires after 80% of the token's TTL has elapsed
- **Observe**: the mint half re-primes the token on its sliding schedule, exactly as before the fix
- [ ] Pass

#### Step 7.9: Genuinely dead credentials still fail closed
- **Setup**: a per-slug token whose TTL, grace window, and re-prime eligibility have all lapsed, with no active skill session
- **Do**: an in-scope Tier-2 command is attempted
- **Observe**: the guard blocks the call and records a credential-expired rejection
- [ ] Pass

#### Step 7.10: Sanctioned skill-driven call with a valid credential is accepted
- **Setup**: a main-session lifecycle subcommand is invoked from within a sanctioned skill's body after that skill has acquired its session credential through the sanctioned mechanism
- **Do**: the guard evaluates the call
- **Observe**: the call is accepted
- [ ] Pass

#### Step 7.11: Immediate Tier-2 call after in-context skill invocation is authorized
- **Setup**: an in-context Tier-2 skill (e.g. the routing skill) has just minted its per-slug session token
- **Do**: the orchestrator immediately runs an in-scope Tier-2 command (e.g. `metta complete research --change <c>`) from the main session
- **Observe**: the guard authorizes the call and does not block with a credential-expired or missing-credential rejection
- [ ] Pass

#### Step 7.12: Tier-2 call from a worktree cwd resolves the credential and is authorized
- **Setup**: a per-slug token minted at skill warm-up for a change hosted in a worktree
- **Do**: the in-scope Tier-2 call is issued with the event cwd set to the worktree checkout rather than the main-session checkout
- **Observe**: the guard resolves the applicable token under the established per-cwd resolution and authorizes the call
- [ ] Pass

#### Step 7.13: Live credential is never rejected on freshness grounds
- **Setup**: a structurally valid, in-scope credential whose invoking skill session is genuinely active
- **Do**: the guard evaluates an in-scope Tier-2 call at any point during that live session
- **Observe**: the call is never rejected for freshness
- [ ] Pass

#### Step 7.14: Genuinely dead, out-of-scope, or malformed credential is rejected
- **Setup**: a main-session lifecycle subcommand is invoked and the credential presented is genuinely dead (past its bounded effective lifetime with no active skill session and no re-prime eligibility), names a subcommand scope that does not cover the invoked subcommand, or is structurally malformed
- **Do**: the guard evaluates the call
- **Observe**: the call is rejected, and the rejection reason distinguishes expiry and scope mismatch from a missing credential
- [ ] Pass

#### Step 7.15: Credential forgery requires an audit-visible act outside command text
- **Setup**: the credential storage is a runtime-minted file that no skill definition or documentation discloses the value of
- **Do**: an orchestrator attempts to authorize a call without the sanctioned issuance mechanism
- **Observe**: the only route is deliberately writing a well-formed credential file — an act that is not expressible as command-prefix text, leaves the fabricated credential in the audit trail on use, and is equivalent in required capability to disabling the guard itself; this residual is documented as accepted in the capability's threat model
- [ ] Pass

#### Step 7.16: No credential present is rejected with skill guidance
- **Setup**: a main-session lifecycle subcommand is invoked with no session credential present at all
- **Do**: the guard evaluates the call
- **Observe**: the call is rejected and the rejection message names the sanctioned skill entry point that would have acquired the credential
- [ ] Pass

#### Step 7.17: Concurrent skill credentials do not interfere
- **Setup**: two sanctioned skills have been invoked in the same session and each holds its own currently valid credential, and a main-session lifecycle subcommand covered only by the second skill's credential scope is invoked
- **Do**: the guard evaluates the call
- **Observe**: the call is accepted, and the presence of the first skill's still-valid credential neither authorizes subcommands outside its own scope nor blocks the second skill's authorization
- [ ] Pass

#### Step 7.18: Missing credential still blocks exactly as before
- **Setup**: no per-slug token exists, no active skill session exists, and the caller carries no verified fork identity
- **Do**: a Tier-2 command is attempted
- **Observe**: the guard blocks the call with the missing-credential reason, identical to pre-fix behavior
- [ ] Pass

#### Step 7.19: Out-of-scope subcommand still blocks exactly as before
- **Setup**: the only live token's scope does not cover the invoked Tier-2 subcommand
- **Do**: the call is evaluated
- **Observe**: the guard blocks it with the scope-mismatch reason, identical to pre-fix behavior
- [ ] Pass

#### Step 7.20: Tier-1 fork path and classification surfaces are unchanged
- **Setup**: the existing test coverage for Tier-1 fork-identity checks, the classification lists, tokenization, chain-separator segmentation, and `--` operand handling
- **Do**: the full pre-existing guard test suite runs against the fixed hooks
- **Observe**: every pre-existing test passes without modification to its expected outcomes
- [ ] Pass

#### Step 7.21: Retired single-file credential remains unhonored
- **Setup**: a well-formed credential written at the retired shared single-file location
- **Do**: a Tier-2 command is attempted with no valid per-slug token and no active skill session
- **Observe**: the guard does not honor the retired file and blocks the call
- [ ] Pass

#### Step 7.22: A session-tier rejection is recorded with tier and reason
- **Setup**: a main-session lifecycle subcommand is rejected for a fabricated credential
- **Do**: the audit log is inspected after the call
- **Observe**: it contains a new record identifying the session tier, the subcommand, and a reason indicating credential mismatch
- [ ] Pass

#### Step 7.23: A session-tier acceptance is recorded
- **Setup**: a main-session lifecycle subcommand is accepted because a valid session credential was presented
- **Do**: the audit log is inspected after the call
- **Observe**: it contains a new record identifying the session tier, the subcommand, and a reason indicating successful credential verification
- [ ] Pass

#### Step 7.24: A fork-tier rejection is recorded with tier and reason
- **Setup**: a fork-dispatched subcommand is rejected for lacking verified caller identity
- **Do**: the audit log is inspected after the call
- **Observe**: it contains a new record identifying the fork tier, the subcommand, and a reason indicating missing caller identity
- [ ] Pass

#### Step 7.25: Credential-expired is written only for genuinely dead credentials
- **Setup**: a Tier-2 call blocked after the guard finds no token eligible under the lifecycle-aware rules and no active skill session
- **Do**: the audit log is inspected after the call
- **Observe**: it contains a credential-expired record for that block, and no credential-expired record exists for any call made while a skill session was genuinely live
- [ ] Pass

#### Step 7.26: New acceptance paths are recorded distinctly
- **Setup**: a Tier-2 call authorized via deterministic re-prime or the lifecycle-aware grace window
- **Do**: the audit log is inspected after the call
- **Observe**: it contains an acceptance record whose reason identifies the re-prime/grace path, distinguishable from an ordinary within-TTL credential acceptance
- [ ] Pass

#### Step 7.27: Live skill sessions produce no false expiry entries
- **Setup**: a skill session that remains genuinely active across a subagent-delegation window longer than the raw TTL
- **Do**: in-scope Tier-2 calls are made during and after that window
- **Observe**: the audit log records only acceptances for those calls, with zero credential-expired entries attributable to them
- [ ] Pass

#### Step 7.28: Immediate-call seam test passes from both cwds
- **Setup**: the integration suite simulates skill warm-up minting a per-slug token
- **Do**: an immediate in-scope Tier-2 call is evaluated by the guard from the main-session cwd and, in a separate case, from a worktree cwd
- **Observe**: both cases assert the guard authorizes the call
- [ ] Pass

#### Step 7.29: Time-advanced expiry-gap test reproduces and passes the delegation window
- **Setup**: a seam test that mints a token and advances the clock past the raw TTL to simulate a subagent delegation window
- **Do**: the subsequent in-scope Tier-2 call is evaluated by the guard
- **Observe**: the test asserts authorization under the new freshness rules, and the same test fails when run against the pre-fix guard freshness check
- [ ] Pass

#### Step 7.30: Same-event race test proves ordering independence
- **Setup**: a seam test that places the token in the expired-but-eligible-for-remint state with no mint refresh applied
- **Do**: the guard evaluates the in-scope Tier-2 call
- **Observe**: the test asserts the call is authorized, demonstrating the outcome does not depend on the mint hook winning a same-event race
- [ ] Pass

#### Step 7.31: Dead-credential fail-closed test still blocks
- **Setup**: a seam test with a token past every freshness avenue (raw TTL, grace, re-prime eligibility) and no active skill session
- **Do**: the in-scope Tier-2 call is evaluated
- **Observe**: the test asserts the guard blocks the call with a credential-expired audit record
- [ ] Pass

#### Step 7.32: Header documentation describes both tiers and the emergency bypass
- **Setup**: the guard's descriptive header
- **Do**: it is read
- **Observe**: it identifies which subcommands are fork-tier, which are session-tier, what non-forgeable signal authorizes each tier, and the emergency bypass procedure
- [ ] Pass

#### Step 7.33: Hook headers describe the corrected freshness model
- **Setup**: the guard and mint hook descriptive headers after the fix lands
- **Do**: they are read
- **Observe**: they describe the deterministic re-prime/grace freshness model and the lifecycle-aware effective lifetime, with no description of the bare raw-TTL racing refresh as current behavior
- [ ] Pass

#### Step 7.34: Generated workflow guidance matches the documented model
- **Setup**: the workflow guidance an operator consults to understand why a call was rejected or how to authorize a subcommand
- **Do**: that guidance is read
- **Observe**: it names the correct tier and sanctioned mechanism for the subcommand in question, describes the corrected Tier-2 credential lifecycle where Tier-2 wording appears, and contains no reference to a retired inline-token or racing-refresh model as if it still governed anything
- [ ] Pass
