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
every credential MUST expire and be treated as invalid once the session goes idle — one bounded
lifetime after Bash activity ceases — so idle sessions carry no standing authorization. This
idle-session property is explicitly scoped to idle sessions; it MUST NOT be read as a claim about
active sessions, whose exposure is described below. A call to one of these subcommands without a
valid credential meeting all three properties MUST be rejected.

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
persists for the session's lifetime while Bash activity continues, not merely for one credential
lifetime. The bounded-lifetime property (b) and the idle-session property (c) bound this exposure
only once Bash activity stops: all credentials then expire one bounded lifetime after the last
Bash call, and the session again carries no standing authorization. This session-lifetime union of
invoked skills' scopes in active sessions is the accepted cost of eliminating cross-skill
credential clobbering, and any future change that narrows or widens it MUST update this threat
model in the same change.

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


## Requirement: Worktree Edits Are Allowed Under the Inverted-Hosting Topology

When a guarded Write/Edit/NotebookEdit/MultiEdit targets a file under `.metta/worktrees/<change>/`, the guard-edit hook MUST allow the edit (exit 0) whenever an active metta change is visible from either the target file's checkout root or the checkout root hosting that worktree — the checkout whose `.metta/worktrees/` directory contains the target's checkout. (In the reproduced topology the hosting root and the session's checkout root are the same checkout; the hosting-root formulation is the precise, session-cwd-independent statement of the same guarantee.) In particular, the inverted-hosting topology — where the change's state (`spec/changes/<name>/.metta.yaml`) lives in the main checkout's `spec/changes/` and the worktree checkout carries no change state of its own — MUST NOT produce a block. The hook MUST NOT treat a successful no-active-changes answer from the target's checkout root as sufficient grounds to block while the hosting checkout reports an active change.
Trace: intent problem statement (zeus false-positive block, 2026-08-18); US-1.

### Scenario: Inverted-hosting topology edit is allowed
- GIVEN a main checkout hosting `spec/changes/<name>/.metta.yaml` for an active change
- AND a worktree at `.metta/worktrees/<name>/` that does not carry that change state in its own `spec/changes/`
- WHEN a subagent issues a Write or Edit targeting a file inside the worktree
- THEN the guard-edit hook exits 0 and the edit proceeds

### Scenario: Empty answer from the target root alone does not block
- GIVEN the inverted-hosting topology above
- WHEN the worktree checkout's own `spec/changes/` carries no state for the change
- AND an active change is visible from the hosting checkout root
- THEN the hook allows the edit rather than blocking on the worktree checkout's answer alone

### Scenario: Subagents no longer need the heredoc fallback
- GIVEN a consumer project running the fixed hooks with an active change in the inverted-hosting topology
- WHEN a subagent executes inside `.metta/worktrees/<change>/` and lands its edits via the Write/Edit tools
- THEN every edit passes the guard without resorting to a bash heredoc bypass


## Requirement: Canonical Worktree Topology Remains Allowed

The guard-edit hook MUST continue to allow (exit 0) guarded edits targeting worktree-hosted files when the change state lives inside the worktree's own checkout (`spec/changes/<name>/.metta.yaml` present in the worktree) — the canonical topology fixed by PR #57. The fix for the inverted-hosting topology MUST NOT regress this behavior.
Trace: US-2; intent acceptance shape (canonical PR #57 topology).

### Scenario: Canonical topology edit is still allowed
- GIVEN a worktree at `.metta/worktrees/<name>/` whose own checkout contains `spec/changes/<name>/.metta.yaml` for an active change
- WHEN a subagent issues a Write or Edit targeting a file inside that worktree
- THEN the guard-edit hook exits 0 and the edit proceeds


## Requirement: Guard Still Blocks When No Change Is Active in Either Root

When no active metta change is visible from the target file's checkout root or, for worktree-hosted targets, from the hosting checkout root, the guard-edit hook MUST block guarded edits to non-allow-listed paths with exit 2 and MUST emit guidance to start a change (e.g. via `metta quick`). The fix MUST NOT convert the guard into an unconditional allow.
Trace: US-2; intent acceptance shape (protective behavior preserved).

### Scenario: No active change anywhere still blocks
- GIVEN a metta project with no active change in the session's checkout
- AND a target path whose checkout root also reports no active change
- WHEN a Write or Edit targets a guarded path that matches no allow-list entry
- THEN the hook exits 2 with the no-active-change guidance message


## Requirement: Probe Failures Continue to Fail Open

Any failure of the hook's active-change probe — `metta` missing from PATH, a non-zero exit, invalid or unparseable JSON output, or a probe timeout — MUST continue to result in the hook exiting 0 (fail open), for every probe the hook performs. The fix MUST NOT introduce a probe whose failure blocks an edit.
Trace: US-2; intent Out of Scope (fail-open policy unchanged).

### Scenario: Each probe-failure mode fails open
- GIVEN a guarded edit under evaluation
- WHEN the active-change probe fails in any mode — metta not on PATH, non-zero exit, invalid JSON, or timeout
- THEN the hook exits 0 and the edit proceeds


## Requirement: Init-Phase and Issues Allow-Lists Are Unchanged

The guard-edit hook's no-active-change allow-lists MUST remain unchanged in content and semantics: the exact-path init-phase allow-list (`spec/project.md`, `.metta/config.yaml`) and the directory-prefix allow-list (`spec/issues/` restricted to `.md` files) MUST continue to permit those writes without an active change, and no new paths are added or removed by this fix.
Trace: US-2; intent Out of Scope (allow-lists unchanged).

### Scenario: Allow-listed paths still pass without an active change
- GIVEN a metta project with no active change visible from any checkout root
- WHEN a Write targets `spec/project.md`, `.metta/config.yaml`, or a `.md` file under `spec/issues/`
- THEN the hook exits 0 and the write proceeds


## Requirement: Regression Tests Exercise Real Discovery Semantics for the Inverted Topology

The guard-edit test suite's worktree-awareness cases MUST exercise the real CLI's change-discovery behavior — or a faithful reproduction of its one-directional discovery (main root aggregates worktree changes; a worktree root does not consult the parent checkout) — against the inverted-hosting topology. The suite MUST NOT rely solely on a shim `metta` binary that answers by cwd for topology coverage, and the inverted-topology test MUST be demonstrably capable of failing against the pre-fix behavior.
Trace: US-3; intent contributing gap (shim-based suite blind spot).

### Scenario: Inverted-topology test catches the original defect
- GIVEN the regression test reproducing the inverted-hosting topology against real (or faithfully reproduced one-directional) discovery semantics
- WHEN the test runs against the pre-fix hook/CLI behavior
- THEN it fails, demonstrating it would have caught the original false-positive block

### Scenario: Topology coverage does not come from a cwd-answering shim
- GIVEN the worktree-awareness cases in the guard-edit test suite
- WHEN they probe active-change discovery for the canonical and inverted topologies
- THEN the answer derives from real CLI resolution and aggregation semantics (or an equivalent faithful reproduction), not a shim that answers by cwd

### Scenario: Both topologies are covered alongside existing cases
- GIVEN the extended guard-edit test suite
- WHEN the full test run executes
- THEN it covers the canonical topology, the inverted-hosting topology, the no-active-change block, and every fail-open probe-failure mode
