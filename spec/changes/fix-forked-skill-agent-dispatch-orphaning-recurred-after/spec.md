# orchestration-guard

## ADDED: Requirement: Fork Dispatch Completion Guarantee

A forked skill-host subagent MUST NOT be able to end its turn while an `Agent` call it dispatched
is still running. This guarantee MUST be enforced by a mechanical control, not by contract prose
alone: the runtime MUST either (a) reject the fork's attempted turn-end while a dispatched child is
still outstanding and feed back an instruction to wait for that child, or (b) constrain `Agent`
dispatches issued from a fork context to complete synchronously before the dispatching call itself
returns control to the fork. Whichever form the mechanism takes, a verified fork-tier caller MUST
NOT be able to silently end its turn with a dispatched child still in flight. This guarantee applies
only to verified fork-tier callers; it MUST NOT constrain `Agent` dispatches issued by callers that
do not carry a verified fork-tier caller identity.

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


## ADDED: Requirement: Truthful Fork Results

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


## ADDED: Requirement: Residual Orphaning Recovery Protocol Is Codified in Every Fork Contract

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


## ADDED: Requirement: Fork-Dispatch Enforcement Events Are Recorded

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
