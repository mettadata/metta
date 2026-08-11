# orchestration-guard

## Requirement: Inline Command-Text Tokens Never Authorize a Blocked Subcommand

A blocked, state-mutating metta subcommand MUST NOT be authorized by any signal that is derivable
purely from the text of the Bash command being executed — including but not limited to an inline
environment-variable prefix, a flag, or an argument value typed by the calling session.
Authorization for every blocked subcommand MUST depend on at least one signal that originates
outside the orchestrator-authored command string: a verified caller identity supplied by the
runtime, or a credential whose value the orchestrator cannot derive from reading available files. A
command carrying only a self-authored inline token, with no such external signal present, MUST be
rejected.

### Scenario: A bare inline token with no external signal is rejected
- GIVEN a blocked subcommand is invoked in a command string that includes a self-authored inline authorization token and no verified caller identity or valid session credential accompanies the call
- WHEN the guard evaluates the call
- THEN the call is rejected and the rejection reason does not credit the inline token with any authorizing effect

### Scenario: No code path treats inline command text as sufficient on its own
- GIVEN the guard's full authorization logic for every blocked subcommand
- WHEN that logic is inspected for any branch that grants access based solely on text present in the command string
- THEN no such branch exists — every accept path requires an external signal in addition to, or instead of, the command text


## Requirement: Fork-Dispatched Subcommands Require Verified Caller Identity

The six fork-dispatched skill subcommands (propose, quick, auto, ship, issue, fix-issue) MUST be
authorized only by a verified caller-identity signal that the runtime attaches to the tool call
when the call originates from the corresponding forked skill-host subagent. A call to one of these
six subcommands lacking that verified identity MUST be rejected, regardless of any other token or
credential present in the command string. This tier's authorization mechanism is unchanged from its
current behavior and MUST NOT be weakened by any other requirement in this capability.

### Scenario: Fork-dispatched subcommand with verified caller identity is accepted
- GIVEN one of the six fork-dispatched subcommands is invoked and the tool call carries a verified caller-identity signal indicating it originated from the corresponding forked skill-host subagent
- WHEN the guard evaluates the call
- THEN the call is accepted

### Scenario: Fork-dispatched subcommand without verified caller identity is rejected
- GIVEN one of the six fork-dispatched subcommands is invoked and the tool call carries no verified caller-identity signal, or one that does not indicate the corresponding forked skill-host subagent
- WHEN the guard evaluates the call
- THEN the call is rejected and the rejection message names the sanctioned skill entry point for that subcommand


## Requirement: Main-Session Lifecycle Subcommands Require a Non-Forgeable Session Credential

The main-session lifecycle subcommands — complete, finalize, refresh, import, init, and fix-gap —
run in the orchestrator's main session by design and structurally lack a forked-caller identity
signal. Each of these subcommands MUST be authorized by a session-scoped credential with all of the
following properties: (a) its value MUST NOT be derivable by an orchestrator reading any skill
definition or documentation file alone — it MUST be produced by a mechanism outside the
orchestrator's own authored text; (b) it MUST have a bounded lifetime or be rotated such that a
single credential value cannot authorize an unbounded number of calls over an unbounded period; (c)
it MUST be absent or treated as invalid whenever no sanctioned skill is currently driving the main
session, so idle sessions carry no standing authorization. A call to one of these subcommands
without a valid credential meeting all three properties MUST be rejected.

Credentials MUST be stored per skill: each sanctioned skill mints and rotates its own credential
file, scoped to its own subcommands, and minting or rotating one skill's credential MUST NOT
overwrite, suppress, or invalidate another skill's credential. The guard MUST accept a call when
any currently valid credential's scope covers the invoked subcommand, so a fresh credential left
by a previously invoked skill can never block the genuinely active skill's own authorization. A
retired shared single-credential storage location MUST NOT be honored as authorization.

### Scenario: Sanctioned skill-driven call with a valid credential is accepted
- GIVEN a main-session lifecycle subcommand is invoked from within a sanctioned skill's body after that skill has acquired its session credential through the sanctioned mechanism
- WHEN the guard evaluates the call
- THEN the call is accepted

### Scenario: Expired, out-of-scope, or malformed credential is rejected
- GIVEN a main-session lifecycle subcommand is invoked and the credential presented is expired past its bounded lifetime, names a subcommand scope that does not cover the invoked subcommand, or is structurally malformed
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


## Requirement: Unrecognized metta Subcommands Fail Closed

When the guard tokenizes a Bash command and finds a metta invocation whose subcommand is neither on
the explicit allow list nor the explicit block list, the guard MUST treat the call as blocked
rather than allowed. The rejection MUST tell the caller how to proceed: either the subcommand needs
to be added to the allow list as a legitimate read-only command, or, if it is a legitimate
skill-internal call, how to obtain the sanctioned authorization for it.

### Scenario: An unrecognized subcommand is blocked, not silently allowed
- GIVEN a metta invocation whose subcommand appears in neither the allow list nor the block list
- WHEN the guard evaluates the call
- THEN the call is rejected and the rejection message includes guidance for updating the allow list or obtaining sanctioned authorization

### Scenario: A newly added unknown subcommand does not silently pass until classified
- GIVEN a metta CLI gains a new subcommand that has not yet been classified into either the allow list or the block list
- WHEN a call using that new subcommand is evaluated by the guard before any list is updated
- THEN the call is rejected by the same fail-closed path as any other unclassified subcommand


## Requirement: Every Rejection and Every Tier-2 Acceptance Is Recorded

The guard MUST append one audit-log record for every rejected call and for every call accepted
under the session-tier credential mechanism. Each record MUST identify which tier evaluated the
call (fork-tier or session-tier, or neither for fail-closed/unknown rejections), the subcommand
involved, and a reason distinguishing the outcome (e.g., missing identity, credential mismatch,
missing credential, unknown subcommand, or successful session-tier acceptance). Fork-tier accepted
calls MAY continue to be unlogged, consistent with current behavior, but no rejection of any kind
and no session-tier acceptance MUST go unrecorded.

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


## Requirement: Skill Contracts Reference Only the Sanctioned Authorization Mechanism

Every skill contract that drives a blocked subcommand MUST instruct the orchestrator to obtain
authorization exclusively through the sanctioned mechanism for that subcommand's tier — verified
caller identity for fork-tier subcommands, sanctioned session-credential acquisition for
session-tier subcommands. No skill contract MUST instruct an orchestrator to author, type, or
otherwise self-supply an inline authorization token as a substitute for either mechanism. This is a
standing invariant: it MUST hold immediately after this capability ships and MUST continue to hold
for any skill contract added or modified afterward.

### Scenario: No skill contract instructs typing a self-authored token
- GIVEN the full set of skill contracts that drive one or more blocked subcommands
- WHEN each contract's authorization instructions are inspected
- THEN none instructs the orchestrator to author or type an inline token as a stand-in for verified caller identity or a sanctioned session credential

### Scenario: A newly added skill contract that reintroduces a self-authored token is a detectable violation
- GIVEN a new or modified skill contract that instructs the orchestrator to type a self-authored inline token to authorize a blocked subcommand
- WHEN the contract is checked against this invariant
- THEN the check reports a violation


## Requirement: Forked Agents Are Blocked From Running Background Bash

A Bash call carrying a background-execution flag, when the call originates from a verified
fork-tier caller, MUST be rejected regardless of which subcommand it targets. Forked skill agents
MUST complete their work synchronously within their turn; ending a turn with background work still
in flight MUST NOT be permitted for a verified fork-tier caller. The rejection MUST instruct the
caller to run the command in the foreground and wait for completion.

### Scenario: Background Bash from a verified fork-tier caller is rejected
- GIVEN a Bash call carries a background-execution flag and the call's verified caller identity indicates a forked skill-host subagent
- WHEN the guard evaluates the call
- THEN the call is rejected before any subcommand classification occurs, and the rejection message instructs running the command in the foreground

### Scenario: Background Bash from a caller without verified fork identity is unaffected by this rule
- GIVEN a Bash call carries a background-execution flag but the call carries no verified fork-tier caller identity
- WHEN the guard evaluates the call
- THEN this requirement's rejection path does not fire, and the call proceeds to ordinary subcommand classification


## Requirement: The Trust Model Is Documented Where Operators and Contributors Will Read It

The guard's own descriptive header and the generated workflow guidance surfaced to operators MUST
describe both authorization tiers accurately: which subcommands belong to each tier, what signal
authorizes each tier, why each signal cannot be forged from command text, and the emergency bypass
procedure for disabling enforcement entirely. This documentation MUST NOT describe a retired
single-tier or inline-token model as the current mechanism, and MUST be updated in the same change
as any future modification to either tier's authorization mechanism.

### Scenario: Header documentation describes both tiers and the emergency bypass
- GIVEN the guard's descriptive header
- WHEN it is read
- THEN it identifies which subcommands are fork-tier, which are session-tier, what non-forgeable signal authorizes each tier, and the emergency bypass procedure

### Scenario: Generated workflow guidance matches the documented model
- GIVEN the workflow guidance an operator consults to understand why a call was rejected or how to authorize a subcommand
- WHEN that guidance is read
- THEN it names the correct tier and sanctioned mechanism for the subcommand in question, with no reference to a retired inline-token model as if it still authorized anything


## Requirement: Fork Dispatch Completion Guarantee

A forked skill-host subagent MUST NOT be able to end its turn while an `Agent` call it dispatched
is still running. This guarantee MUST be enforced by a mechanical control, not by contract prose
alone: the runtime MUST either (a) reject the fork's attempted turn-end while a dispatched child is
still outstanding and feed back an instruction to wait for that child, or (b) constrain `Agent`
dispatches issued from a fork context to complete synchronously before the dispatching call itself
returns control to the fork. Whichever form the mechanism takes, a verified fork-tier caller MUST
NOT be able to silently end its turn with a dispatched child still in flight. This guarantee applies
only to verified fork-tier callers; it MUST NOT constrain `Agent` dispatches issued by callers that
do not carry a verified fork-tier caller identity.
The mechanical control's detection is scoped to the dispatch shapes the runtime documents at ship
time: if the runtime's dispatch-shape surface drifts such that a backgrounding request is no longer
recognizable, the control MAY pass the dispatch through (fail-open) rather than reject all
dispatches, PROVIDED the pass-through leaves an audit-log record of the unrecognized shape and the
residual recovery protocol (below) remains in force as the documented backstop for any orphaning
that results.

### Scenario: Enforcement fires when a fork attempts to end its turn with a pending dispatch
- GIVEN a forked skill-host subagent has dispatched an `Agent` child that has not yet returned
- WHEN the fork attempts to end its turn (or, under a forced-synchronous mechanism, attempts a dispatch shape that would detach the child before it completes)
- THEN the mechanical enforcement control fires and prevents the turn from ending, or the dispatch shape, with the child still outstanding

### Scenario: A fork whose dispatched work is complete ends its turn normally
- GIVEN a forked skill-host subagent has dispatched one or more `Agent` children and all of them have returned
- WHEN the fork attempts to end its turn
- THEN the enforcement control allows the stop without interference

### Scenario: Non-fork callers are unaffected by this guarantee
- GIVEN a subagent call whose caller identity does not carry a verified fork-tier caller identity
- WHEN that caller dispatches an `Agent` child and later ends its turn
- THEN this requirement's enforcement control does not apply to it, consistent with the existing fork-tier trust model


## Requirement: Truthful Fork Results

When the completion-guarantee enforcement described above fires for a forked skill-host subagent,
the fork MUST continue or wait rather than surface a terminal result while its dispatched work
remains incomplete. The terminal result an orchestrator receives from a forked skill-host subagent
MUST describe only work that has completed or definitively failed; it MUST NOT narrate in-progress
or background work as though the fork's turn had ended in success.

### Scenario: A terminal fork result never narrates in-progress work under enforcement
- GIVEN enforcement fired one or more times during a forked skill-host subagent's run because a dispatched child was still outstanding
- WHEN that fork eventually returns its terminal result to the orchestrator
- THEN the terminal result describes only completed or definitively-failed work, with no narration of work still in flight

### Scenario: The enforcement reason instructs the fork to wait rather than return early
- GIVEN the enforcement control blocks a fork's attempted early turn-end
- WHEN the reason is fed back to the fork
- THEN the reason explicitly instructs the fork to wait for the outstanding dispatched child before returning, rather than merely rejecting the attempt with no guidance

### Scenario: The skill-host contract treats in-progress narration as a non-terminal, failed result
- GIVEN the skill-host contract that governs how a forked skill-host subagent's result is interpreted
- WHEN an orchestrator reads a fork result that narrates in-progress or background work
- THEN the contract directs the orchestrator to treat that result as a failed, non-terminal fork result rather than as success


## Requirement: Residual Orphaning Recovery Protocol Is Codified in Every Fork Contract

The skill-host contract and the contract of every forked skill MUST carry a recovery protocol for
the case where a forked skill-host subagent orphans a dispatched agent despite the completion-
guarantee enforcement. The protocol MUST instruct the orchestrator to: (a) treat any fork result
that narrates in-progress or background work as a failed, non-terminal result; (b) wait for or
attach to the still-running orphaned agent rather than dispatching a duplicate of the same in-flight
work; and (c) dispatch fresh work only once the orphaned agent is confirmed dead or complete,
resuming from the change's persisted state rather than restarting it from scratch.

### Scenario: Contract inspection finds the recovery protocol in every fork contract
- GIVEN the skill-host contract and the contract of every forked skill
- WHEN each contract is inspected
- THEN every one of them carries the recovery-protocol section covering detection, wait/attach, and confirmed-recovery re-dispatch

### Scenario: The protocol explicitly forbids duplicate dispatch of in-flight work
- GIVEN an orchestrator following the recovery protocol has detected an orphaned agent that is still running
- WHEN it consults the protocol for what to do next
- THEN the protocol explicitly forbids dispatching a duplicate of the still-running work and instead directs waiting for or attaching to the orphan

### Scenario: Fresh work is only dispatched after the orphan is confirmed dead or complete
- GIVEN an orphaned agent has been confirmed dead or complete per the protocol
- WHEN the orchestrator needs the associated work carried out
- THEN the protocol permits dispatching fresh work only at that point, resuming from the change's persisted state


## Requirement: Fork-Dispatch Enforcement Events Are Recorded

Each fork-dispatch completion-guarantee enforcement event — a blocked turn-end, a rejected async
dispatch shape, or an invocation of the residual recovery protocol — MUST leave inspectable evidence
in the audit log or an equivalent durable record. Each record MUST identify the event type, the
fork-tier caller and agent identity involved, and, consistent with this capability's existing
audit-record conventions, a tier designation and a reason distinguishing the outcome, so a maintainer
can correlate the record with the session in which it fired without reconstructing the session from
ephemeral conversation text.

### Scenario: A blocked turn-end is recorded with tier and reason
- GIVEN the enforcement control blocks a forked skill-host subagent's attempted early turn-end
- WHEN the audit log is inspected after the event
- THEN it contains a new record identifying the fork tier, the affected agent identity, and a reason indicating a pending dispatched child

### Scenario: A rejected async dispatch shape is recorded with tier and reason
- GIVEN the enforcement control rejects an `Agent` dispatch shape from a fork context because it would detach the dispatched child
- WHEN the audit log is inspected after the event
- THEN it contains a new record identifying the fork tier, the affected agent identity, and a reason indicating a rejected async dispatch shape

### Scenario: A recovery-protocol invocation is discernible from recorded evidence
- GIVEN an orchestrator invoked the codified recovery protocol for an orphaned fork
- WHEN a maintainer reviews the recorded enforcement evidence after the session ends
- THEN the recovery invocation is discernible from that evidence alone, and the maintainer can distinguish it from a session where enforcement never fired
