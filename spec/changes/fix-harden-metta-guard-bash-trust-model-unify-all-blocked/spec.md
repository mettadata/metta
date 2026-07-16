# orchestration-guard

<!-- new-capability -->

<!-- The guard hook's durable trust-model contract (fork-tier vs. session-tier authorization for
blocked metta subcommands, fail-closed defaults, and audit logging) has no capability spec today —
its prior spec bundles were retired in the 2026-07-16 store reset. This capability becomes its
durable home, so future guard-hook changes have a spec to diff against instead of only source and
issue history. -->

## ADDED: Requirement: Inline Command-Text Tokens Never Authorize a Blocked Subcommand

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

## ADDED: Requirement: Fork-Dispatched Subcommands Require Verified Caller Identity

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

## ADDED: Requirement: Main-Session Lifecycle Subcommands Require a Non-Forgeable Session Credential

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

### Scenario: Sanctioned skill-driven call with a valid credential is accepted
- GIVEN a main-session lifecycle subcommand is invoked from within a sanctioned skill's body after that skill has acquired its session credential through the sanctioned mechanism
- WHEN the guard evaluates the call
- THEN the call is accepted

### Scenario: Fabricated or expired credential is rejected
- GIVEN a main-session lifecycle subcommand is invoked and the credential presented is either a value the orchestrator fabricated without going through the sanctioned issuance mechanism, or a previously valid credential that has since expired or been rotated away
- WHEN the guard evaluates the call
- THEN the call is rejected, and the rejection reason distinguishes a credential mismatch from a missing credential

### Scenario: No credential present is rejected with skill guidance
- GIVEN a main-session lifecycle subcommand is invoked with no session credential present at all
- WHEN the guard evaluates the call
- THEN the call is rejected and the rejection message names the sanctioned skill entry point that would have acquired the credential

## ADDED: Requirement: Unrecognized metta Subcommands Fail Closed

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

## ADDED: Requirement: Every Rejection and Every Tier-2 Acceptance Is Recorded

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

## ADDED: Requirement: Skill Contracts Reference Only the Sanctioned Authorization Mechanism

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

## ADDED: Requirement: Forked Agents Are Blocked From Running Background Bash

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

## ADDED: Requirement: The Trust Model Is Documented Where Operators and Contributors Will Read It

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
