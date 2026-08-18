# orchestration-guard

## ADDED: Requirement: Deterministic Tier-2 Freshness Resolution Independent of Hook Ordering

When the guard evaluates a Tier-2 (session-tier) call, credential freshness MUST be resolved
deterministically inside the guard itself rather than depending on whether a separately scheduled
mint hook has already refreshed the token on the same Bash event. The guard MUST NOT assume any
ordering guarantee among PreToolUse hooks: given the documented parallel, unordered hook execution,
the authorization outcome for a given token state MUST be identical whether the mint hook runs
before, after, or not at all on the evaluated event. Concretely: when the guard finds a
structurally valid, in-scope per-slug token that is past its raw TTL but is eligible for re-prime
by a genuinely active skill session (as established by the non-forgeable skill-activity signal),
the guard MUST re-prime or accept that token and authorize the call rather than failing closed
with a freshness rejection.
Trace: intent Problem item 2 (same-event mint/validate race, guard line 403 `now - tok.mintedAt < tok.ttlMs`); intent Proposal item 1; US-3.

### Scenario: Expired-but-refreshable token is authorized before any mint-hook refresh lands
- GIVEN a per-slug session token that is structurally valid and in scope for the invoked Tier-2 subcommand, is past its raw TTL, and is eligible for re-prime because the invoking skill session is genuinely active
- WHEN the guard evaluates the Tier-2 call before any mint-hook refresh has rewritten the token on that event
- THEN the guard re-primes or accepts the token and authorizes the call instead of blocking with a credential-expired rejection

### Scenario: Authorization outcome is invariant under mint/guard hook ordering
- GIVEN the mint hook and the guard hook both fire on the same Bash event carrying an in-scope Tier-2 call, with a token state that the new freshness rules authorize
- WHEN the two hooks execute in either order, or the mint hook does not fire on that event at all
- THEN the guard's authorization outcome is the same in every ordering, with no dependence on which hook's filesystem effect landed first

### Scenario: No new runtime ordering guarantee is assumed
- GIVEN the fixed guard's Tier-2 freshness evaluation logic
- WHEN that logic is inspected for assumptions about PreToolUse hook scheduling
- THEN it contains no branch whose correctness requires the Claude Code runtime to order, serialize, or guarantee delivery of the separate mint hook relative to the guard


## ADDED: Requirement: Skill-Activity Signal Is Non-Forgeable and Written Only at Genuine Skill Invocation

The deterministic re-prime path MUST derive its evidence of an active skill session from a
skill-activity signal (marker, token metadata, or equivalent) that is written only by the sanctioned
skill-invocation machinery — the skill-frontmatter mint hook or an equivalent runtime-driven
mechanism — at the time the matching Tier-2 skill is genuinely invoked. The signal's authorizing
value MUST NOT be derivable from orchestrator command text, from reading any skill definition or
documentation file, or from any content the orchestrator itself authors. A Tier-2 call presented
with a fabricated or absent activity signal and no otherwise-valid credential MUST be rejected.
The per-slug token files and the per-skill scope table remain the sole source of scope truth; the
activity signal contributes only to freshness, never to scope.
Trace: intent Proposal item 1 ("trustworthy skill-activity marker (written at skill invocation time, not derivable or forgeable from orchestrator command text)"); intent Impact (trust model preserved); US-4.

### Scenario: Fabricated activity evidence from command text does not authorize
- GIVEN an orchestrator attempts to satisfy the re-prime path by supplying activity evidence authored in its own command text or copied from skill-file contents, with no genuinely invoked skill session
- WHEN the guard evaluates a Tier-2 call
- THEN the re-prime path does not fire and the call is rejected through the existing fail-closed paths

### Scenario: Activity signal originates only from sanctioned invocation machinery
- GIVEN the mechanism that writes the skill-activity signal
- WHEN its write path is inspected
- THEN the signal is produced only by the skill-invocation-time hook machinery (never sourced from event command text), and its authorizing value appears in no skill definition or documentation file

### Scenario: Activity signal never widens scope
- GIVEN a live skill-activity signal for a skill whose scope does not cover the invoked Tier-2 subcommand, and no other valid in-scope token
- WHEN the guard evaluates the call
- THEN the call is rejected with the existing scope-mismatch reason — the activity signal contributed freshness eligibility only, not scope


## ADDED: Requirement: Credential Freshness Survives Subagent Delegation Windows

The effective lifetime of a Tier-2 session credential MUST cover the dominant lifecycle shape:
skill warm-up mints the token, the orchestrator delegates artifact work to subagents for a window
longer than the raw mint TTL (during which no main-session Bash call fires to slide-refresh the
token), and the orchestrator then runs an in-scope Tier-2 command. This MUST be achieved by a
lifecycle-aware freshness window — a raised TTL, a guard-side grace window, and/or the
deterministic re-prime path — such that a token minted at skill warm-up still authorizes the
post-delegation call. The 80% sliding refresh for actively used sessions MUST be retained. The
widened effective lifetime MUST remain bounded: a credential with no active skill session and no
re-prime eligibility MUST still expire and fail closed, preserving the idle-session
no-standing-authorization property.
Trace: intent Problem item 1 (subagent-delegation expiry gap, TTL_MS = 300000); intent Proposal item 2; US-2.

### Scenario: Token outlives the raw TTL across a delegation window and still authorizes
- GIVEN a per-slug token minted at skill warm-up
- WHEN the clock advances past the original raw TTL while work is delegated to subagents (no intervening main-session Bash call refreshes the token) and the orchestrator then runs an in-scope Tier-2 command
- THEN the guard authorizes the call via the lifecycle-aware freshness window or the deterministic re-prime path

### Scenario: Sliding refresh for active sessions is retained
- GIVEN an actively used main session holding a fresh per-slug token
- WHEN a Bash call fires after 80% of the token's TTL has elapsed
- THEN the mint half re-primes the token on its sliding schedule, exactly as before the fix

### Scenario: Genuinely dead credentials still fail closed
- GIVEN a per-slug token whose TTL, grace window, and re-prime eligibility have all lapsed, with no active skill session
- WHEN an in-scope Tier-2 command is attempted
- THEN the guard blocks the call and records a credential-expired rejection


## MODIFIED: Requirement: Main-Session Lifecycle Subcommands Require a Non-Forgeable Session Credential

The main-session lifecycle subcommands — complete, finalize, refresh, import, init, and fix-gap —
run in the orchestrator's main session by design and structurally lack a forked-caller identity
signal. Each of these subcommands MUST be authorized by a session-scoped credential with all of the
following properties: (a) its value MUST NOT be derivable by an orchestrator reading any skill
definition or documentation file alone — it MUST be produced by a mechanism outside the
orchestrator's own authored text; (b) it MUST have a bounded lifetime or be rotated such that a
single credential value cannot authorize an unbounded number of calls over an unbounded period; (c)
every credential MUST expire and be treated as invalid once the session goes idle — one bounded
effective lifetime (raw TTL plus any lifecycle-aware grace, with no remaining re-prime eligibility)
after skill-session activity ceases — so idle sessions carry no standing authorization. This
idle-session property is explicitly scoped to idle sessions; it MUST NOT be read as a claim about
active sessions, whose exposure is described below. A call to one of these subcommands without a
valid credential meeting all three properties MUST be rejected.

Credential freshness MUST be judged by the lifecycle-aware rules of this capability — the
deterministic re-prime path and the lifecycle-aware freshness window — not by a bare
minted-timestamp-versus-raw-TTL comparison that races a separately scheduled refresh hook. A
structurally valid, in-scope credential belonging to a genuinely active skill session MUST NOT be
rejected on freshness grounds, regardless of the session's current working directory (main
checkout or a worktree checkout hosting the change), provided the credential resolves under the
established per-cwd token-store resolution.

Credentials MUST be stored per skill: each sanctioned skill mints and rotates its own credential
file, scoped to its own subcommands, and minting or rotating one skill's credential MUST NOT
overwrite, suppress, or invalidate another skill's credential. The guard MUST accept a call when
any currently valid credential's scope covers the invoked subcommand, so a fresh credential left
by a previously invoked skill can never block the genuinely active skill's own authorization. A
retired shared single-credential storage location MUST NOT be honored as authorization.

This per-skill design carries an explicitly accepted threat-model tradeoff: because each invoked
skill's mint hook remains registered and continues to fire on subsequent Bash calls, re-minting
that skill's credential before it expires, an active session's effective session-tier authority is
the union of the scopes of every sanctioned skill invoked during that session — and that union
persists for the session's lifetime while skill-session activity continues, not merely for one
credential lifetime. The lifecycle-aware freshness window widens the post-activity exposure from
one raw TTL to one bounded effective lifetime; this marginal widening is an accepted tradeoff,
bounded by the deterministic skill-activity check, and MUST be recorded in the design. The
bounded-effective-lifetime property (b) and the idle-session property (c) bound this exposure once
activity stops: all credentials then expire one bounded effective lifetime after skill-session
activity ceases, and the session again carries no standing authorization. Any future change that
narrows or widens this exposure MUST update this threat model in the same change.
Trace: intent Proposal items 1–2 and Impact (trust model tradeoff); US-1; US-4.

### Scenario: Sanctioned skill-driven call with a valid credential is accepted
- GIVEN a main-session lifecycle subcommand is invoked from within a sanctioned skill's body after that skill has acquired its session credential through the sanctioned mechanism
- WHEN the guard evaluates the call
- THEN the call is accepted

### Scenario: Immediate Tier-2 call after in-context skill invocation is authorized
- GIVEN an in-context Tier-2 skill (e.g. the routing skill) has just minted its per-slug session token
- WHEN the orchestrator immediately runs an in-scope Tier-2 command (e.g. `metta complete research --change <c>`) from the main session
- THEN the guard authorizes the call and does not block with a credential-expired or missing-credential rejection

### Scenario: Tier-2 call from a worktree cwd resolves the credential and is authorized
- GIVEN a per-slug token minted at skill warm-up for a change hosted in a worktree
- WHEN the in-scope Tier-2 call is issued with the event cwd set to the worktree checkout rather than the main-session checkout
- THEN the guard resolves the applicable token under the established per-cwd resolution and authorizes the call

### Scenario: Live credential is never rejected on freshness grounds
- GIVEN a structurally valid, in-scope credential whose invoking skill session is genuinely active
- WHEN the guard evaluates an in-scope Tier-2 call at any point during that live session
- THEN the call is never rejected for freshness

### Scenario: Genuinely dead, out-of-scope, or malformed credential is rejected
- GIVEN a main-session lifecycle subcommand is invoked and the credential presented is genuinely dead (past its bounded effective lifetime with no active skill session and no re-prime eligibility), names a subcommand scope that does not cover the invoked subcommand, or is structurally malformed
- WHEN the guard evaluates the call
- THEN the call is rejected, and the rejection reason distinguishes expiry and scope mismatch from a missing credential

### Scenario: Credential forgery requires an audit-visible act outside command text
- GIVEN the credential storage is a runtime-minted file that no skill definition or documentation discloses the value of
- WHEN an orchestrator attempts to authorize a call without the sanctioned issuance mechanism
- THEN the only route is deliberately writing a well-formed credential file — an act that is not expressible as command-prefix text, leaves the fabricated credential in the audit trail on use, and is equivalent in required capability to disabling the guard itself; this residual is documented as accepted in the capability's threat model

### Scenario: No credential present is rejected with skill guidance
- GIVEN a main-session lifecycle subcommand is invoked with no session credential present at all
- WHEN the guard evaluates the call
- THEN the call is rejected and the rejection message names the sanctioned skill entry point that would have acquired the credential

### Scenario: Concurrent skill credentials do not interfere
- GIVEN two sanctioned skills have been invoked in the same session and each holds its own currently valid credential, and a main-session lifecycle subcommand covered only by the second skill's credential scope is invoked
- WHEN the guard evaluates the call
- THEN the call is accepted, and the presence of the first skill's still-valid credential neither authorizes subcommands outside its own scope nor blocks the second skill's authorization


## ADDED: Requirement: Freshness Fix Leaves All Other Guard Behavior Unchanged

The Tier-2 freshness fix MUST be behavior-preserving for every other guard path. Specifically:
(a) a Tier-2 call with no credential present and no active skill session MUST still be rejected
with the missing-credential reason; (b) a Tier-2 call covered by no valid token's scope MUST still
be rejected with the scope-mismatch reason; (c) Tier-1 fork-identity authorization, the
fork-enforced subcommand set, and the background-Bash rejection MUST be unchanged; (d) the
allow/block/unknown classification lists, command tokenization, chain-separator segmentation, and
`--` operand-terminator fail-closed handling MUST be unchanged; (e) the retired shared
single-credential file MUST remain unhonored. No subcommand moves between tiers or lists in this
change.
Trace: intent Impact (guard file — untouched surfaces) and Out of Scope; US-4.

### Scenario: Missing credential still blocks exactly as before
- GIVEN no per-slug token exists, no active skill session exists, and the caller carries no verified fork identity
- WHEN a Tier-2 command is attempted
- THEN the guard blocks the call with the missing-credential reason, identical to pre-fix behavior

### Scenario: Out-of-scope subcommand still blocks exactly as before
- GIVEN the only live token's scope does not cover the invoked Tier-2 subcommand
- WHEN the call is evaluated
- THEN the guard blocks it with the scope-mismatch reason, identical to pre-fix behavior

### Scenario: Tier-1 fork path and classification surfaces are unchanged
- GIVEN the existing test coverage for Tier-1 fork-identity checks, the classification lists, tokenization, chain-separator segmentation, and `--` operand handling
- WHEN the full pre-existing guard test suite runs against the fixed hooks
- THEN every pre-existing test passes without modification to its expected outcomes

### Scenario: Retired single-file credential remains unhonored
- GIVEN a well-formed credential written at the retired shared single-file location
- WHEN a Tier-2 command is attempted with no valid per-slug token and no active skill session
- THEN the guard does not honor the retired file and blocks the call


## MODIFIED: Requirement: Every Rejection and Every Tier-2 Acceptance Is Recorded

The guard MUST append one audit-log record for every rejected call and for every call accepted
under the session-tier credential mechanism. Each record MUST identify which tier evaluated the
call (fork-tier or session-tier, or neither for fail-closed/unknown rejections), the subcommand
involved, and a reason distinguishing the outcome (e.g., missing identity, credential mismatch,
missing credential, unknown subcommand, or successful session-tier acceptance). Fork-tier accepted
calls MAY continue to be unlogged, consistent with current behavior, but no rejection of any kind
and no session-tier acceptance MUST go unrecorded.

Freshness outcomes MUST be recorded with fidelity: a credential-expired rejection reason MUST be
written only for genuinely dead credentials (no active skill session, no token eligible under the
lifecycle-aware rules). A call accepted through a new acceptance path — deterministic re-prime or
the lifecycle-aware grace window — MUST be recorded with a reason that distinguishes that path
from an ordinary within-TTL credential acceptance, so future incidents remain diagnosable from
the audit log. In-scope Tier-2 calls made during a live skill session MUST NOT produce
credential-expired entries.
Trace: intent Proposal item 4 (audit-log fidelity); intent Problem (audit log pinned the defect via reason:"credential-expired"); US-5.

### Scenario: A session-tier rejection is recorded with tier and reason
- GIVEN a main-session lifecycle subcommand is rejected for a fabricated credential
- WHEN the audit log is inspected after the call
- THEN it contains a new record identifying the session tier, the subcommand, and a reason indicating credential mismatch

### Scenario: A session-tier acceptance is recorded
- GIVEN a main-session lifecycle subcommand is accepted because a valid session credential was presented
- WHEN the audit log is inspected after the call
- THEN it contains a new record identifying the session tier, the subcommand, and a reason indicating successful credential verification

### Scenario: A fork-tier rejection is recorded with tier and reason
- GIVEN a fork-dispatched subcommand is rejected for lacking verified caller identity
- WHEN the audit log is inspected after the call
- THEN it contains a new record identifying the fork tier, the subcommand, and a reason indicating missing caller identity

### Scenario: Credential-expired is written only for genuinely dead credentials
- GIVEN a Tier-2 call blocked after the guard finds no token eligible under the lifecycle-aware rules and no active skill session
- WHEN the audit log is inspected after the call
- THEN it contains a credential-expired record for that block, and no credential-expired record exists for any call made while a skill session was genuinely live

### Scenario: New acceptance paths are recorded distinctly
- GIVEN a Tier-2 call authorized via deterministic re-prime or the lifecycle-aware grace window
- WHEN the audit log is inspected after the call
- THEN it contains an acceptance record whose reason identifies the re-prime/grace path, distinguishable from an ordinary within-TTL credential acceptance

### Scenario: Live skill sessions produce no false expiry entries
- GIVEN a skill session that remains genuinely active across a subagent-delegation window longer than the raw TTL
- WHEN in-scope Tier-2 calls are made during and after that window
- THEN the audit log records only acceptances for those calls, with zero credential-expired entries attributable to them


## ADDED: Requirement: Integration Tests Exercise the Mint/Validate Seam

The test suite MUST include integration tests that exercise the mint hook and the guard together
across the seam where the defect lived, and each seam test MUST be demonstrably capable of failing
against the pre-fix behavior. The suite MUST cover at minimum: (a) mint via simulated skill
warm-up followed by an immediate in-scope Tier-2 call, exercised from both the main-session cwd
and a worktree cwd; (b) a time-advanced case reproducing the post-subagent expiry gap — token
minted, clock advanced past the raw TTL, and the subsequent in-scope Tier-2 call authorized under
the new freshness rules; (c) the same-event ordering case — the guard evaluates while the token is
expired-but-eligible-for-remint and no mint refresh has landed, and the call is authorized rather
than failed closed; and (d) the fail-closed complement — a genuinely dead credential (all
freshness avenues lapsed) is still blocked. Any defect the worktree-cwd case reveals beyond the
TTL lifecycle gap is logged as a separate issue rather than silently patched in this change.
Trace: intent Proposal item 3; intent Out of Scope (worktree cwd candidate); US-1, US-2, US-3 independent test criteria.

### Scenario: Immediate-call seam test passes from both cwds
- GIVEN the integration suite simulates skill warm-up minting a per-slug token
- WHEN an immediate in-scope Tier-2 call is evaluated by the guard from the main-session cwd and, in a separate case, from a worktree cwd
- THEN both cases assert the guard authorizes the call

### Scenario: Time-advanced expiry-gap test reproduces and passes the delegation window
- GIVEN a seam test that mints a token and advances the clock past the raw TTL to simulate a subagent delegation window
- WHEN the subsequent in-scope Tier-2 call is evaluated by the guard
- THEN the test asserts authorization under the new freshness rules, and the same test fails when run against the pre-fix guard freshness check

### Scenario: Same-event race test proves ordering independence
- GIVEN a seam test that places the token in the expired-but-eligible-for-remint state with no mint refresh applied
- WHEN the guard evaluates the in-scope Tier-2 call
- THEN the test asserts the call is authorized, demonstrating the outcome does not depend on the mint hook winning a same-event race

### Scenario: Dead-credential fail-closed test still blocks
- GIVEN a seam test with a token past every freshness avenue (raw TTL, grace, re-prime eligibility) and no active skill session
- WHEN the in-scope Tier-2 call is evaluated
- THEN the test asserts the guard blocks the call with a credential-expired audit record


## MODIFIED: Requirement: The Trust Model Is Documented Where Operators and Contributors Will Read It

The guard's own descriptive header and the generated workflow guidance surfaced to operators MUST
describe both authorization tiers accurately: which subcommands belong to each tier, what signal
authorizes each tier, why each signal cannot be forged from command text, and the emergency bypass
procedure for disabling enforcement entirely. The Tier-2 description MUST describe the corrected
credential lifecycle — the deterministic re-prime/grace freshness model and the lifecycle-aware
effective lifetime — and MUST NOT present the retired bare minted-timestamp-versus-raw-TTL racing
refresh as the current freshness mechanism, just as it MUST NOT describe a retired single-tier or
inline-token model as current. The mint hook's descriptive header MUST likewise reflect the
corrected lifecycle. This documentation MUST be updated in the same change as any future
modification to either tier's authorization mechanism.
Trace: intent Proposal item 5 (documentation sync); US-6.

### Scenario: Header documentation describes both tiers and the emergency bypass
- GIVEN the guard's descriptive header
- WHEN it is read
- THEN it identifies which subcommands are fork-tier, which are session-tier, what non-forgeable signal authorizes each tier, and the emergency bypass procedure

### Scenario: Hook headers describe the corrected freshness model
- GIVEN the guard and mint hook descriptive headers after the fix lands
- WHEN they are read
- THEN they describe the deterministic re-prime/grace freshness model and the lifecycle-aware effective lifetime, with no description of the bare raw-TTL racing refresh as current behavior

### Scenario: Generated workflow guidance matches the documented model
- GIVEN the workflow guidance an operator consults to understand why a call was rejected or how to authorize a subcommand
- WHEN that guidance is read
- THEN it names the correct tier and sanctioned mechanism for the subcommand in question, describes the corrected Tier-2 credential lifecycle where Tier-2 wording appears, and contains no reference to a retired inline-token or racing-refresh model as if it still governed anything
