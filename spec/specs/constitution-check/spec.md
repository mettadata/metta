# constitution-check

## Requirement: Contract Emission Without API Credentials

The `check-constitution` command MUST, when invoked with a change name and no verdict has yet been recorded for that check, emit a check contract — without instantiating any AI-provider client and without requiring any API credential to be present in the environment. The contract MUST include: the constitution articles (Conventions and Off-Limits) parsed from `spec/project.md`, the target change's spec path and content, and the expected verdict JSON shape (`{"violations": [...]}` per the violation schema). The command MUST exit `0` on successful contract emission. With `--json`, the contract MUST be emitted as a single machine-readable JSON object on stdout.
References: US-1

### Scenario: Contract emitted with no credential present
- Given a change with a `spec.md` exists and `ANTHROPIC_API_KEY` is unset in the environment
- When `metta check-constitution --change <name>` is invoked with no prior recorded verdict
- Then the command emits the check contract (constitution articles, change spec path and content, expected verdict shape) and exits `0`, with no authentication error of any kind

### Scenario: Machine-readable contract via --json
- Given the same change and unset credential as above
- When `metta check-constitution --change <name> --json` is invoked
- Then stdout contains a single JSON object carrying the constitution articles, the change's spec path and content, and the expected `{"violations": [...]}` verdict shape, and the process exits `0`

### Scenario: Nonexistent change fails with a clear error, not an auth error
- Given a change name that does not correspond to any existing change directory
- When `metta check-constitution --change <name>` is invoked
- Then the command fails with an error describing the missing change, and the failure is not an SDK/authentication error


## Requirement: No Direct AI Provider Invocation

The command MUST NOT construct or invoke any hosted AI-provider client (Anthropic or otherwise) in any code path, and MUST NOT require any hosted-model API credential to be set for any invocation to succeed. This holds for both the contract-emission step and the verdict-recording step.
References: US-1, US-4

### Scenario: No provider client is constructed during contract emission
- Given a change with a `spec.md`
- When `metta check-constitution --change <name>` is invoked to emit the contract
- Then no network call to a hosted model provider is attempted, and no provider client is constructed at any point in the invocation

### Scenario: No provider client is constructed during verdict recording
- Given a valid verdict file for a change
- When `metta check-constitution --change <name> --record <verdict-file>` is invoked
- Then no network call to a hosted model provider is attempted, and no provider client is constructed at any point in the invocation

### Scenario: Full check runs end-to-end with no credential in the environment
- Given `ANTHROPIC_API_KEY` and any other hosted-model credential are unset in the environment
- When the full contract-then-record flow is run for a change to completion
- Then every step succeeds or fails on its own merits (missing change, invalid verdict, blocking violations) and never fails due to a missing or invalid API credential


## Requirement: Verdict Schema Validation

The `check-constitution` command MUST, when invoked with a verdict via `--record <verdict-file>`, validate the verdict content against the violation-list schema before accepting it. When the verdict does not conform to the schema, the command MUST report a typed validation error, MUST exit `4`, and MUST NOT write or modify `violations.md`.
References: US-2

### Scenario: Malformed verdict is rejected without persisting anything
- Given a verdict file whose JSON does not conform to the violation-list schema (e.g. missing a required field, wrong severity value)
- When `metta check-constitution --change <name> --record <verdict-file>` is invoked
- Then the command reports a schema validation error, exits `4`, and does not create or overwrite `violations.md` for the change

### Scenario: Unparseable verdict input is rejected
- Given a verdict file that is not valid JSON
- When `metta check-constitution --change <name> --record <verdict-file>` is invoked
- Then the command reports a validation error, exits `4`, and does not create or overwrite `violations.md` for the change

### Scenario: Well-formed empty verdict passes validation
- Given a verdict file containing `{"violations": []}`
- When `metta check-constitution --change <name> --record <verdict-file>` is invoked
- Then the verdict passes schema validation and processing proceeds to persistence


## Requirement: Verdict Recording and Blocking-Violation Exit Semantics

When a schema-valid verdict is recorded, the command MUST classify each violation using the existing severity semantics — `critical` severity is always blocking; `major` severity is blocking unless justified by a matching entry in the change's Complexity Tracking section; `minor` severity is never blocking — and MUST exit `0` when no blocking violations are present after classification, or `4` when at least one blocking violation is present.
References: US-2

### Scenario: Verdict with no blocking violations exits 0
- Given a schema-valid verdict containing only `minor` violations, or containing `major` violations each justified in the change's Complexity Tracking section
- When the verdict is recorded via `metta check-constitution --change <name> --record <verdict-file>`
- Then the command exits `0`

### Scenario: Critical violation is always blocking
- Given a schema-valid verdict containing a `critical` severity violation
- When the verdict is recorded, regardless of any Complexity Tracking entry matching that violation's article
- Then the violation is classified as blocking and the command exits `4`

### Scenario: Unjustified major violation is blocking
- Given a schema-valid verdict containing a `major` severity violation whose article has no matching justification entry in the change's Complexity Tracking section
- When the verdict is recorded
- Then the violation is classified as blocking and the command exits `4`

### Scenario: Justified major violation is not blocking
- Given a schema-valid verdict containing a `major` severity violation whose article has a matching justification entry in the change's Complexity Tracking section
- When the verdict is recorded
- Then the violation is classified as not blocking, and if it is the only violation present the command exits `0`


## Requirement: Violations Report Format and Location Preserved

Recording a verdict MUST write the rendered violations report to the same path and in the same structure used prior to this change: `spec/changes/<name>/violations.md`, containing frontmatter with a check timestamp and spec version, followed by either a "No violations found." line or a heading and one rendered line per violation (severity, article, evidence, suggestion, justification note where applicable, and a BLOCKING marker where applicable).
References: US-2, US-3

### Scenario: Clean verdict produces the no-violations report
- Given a schema-valid verdict containing `{"violations": []}`
- When the verdict is recorded for a change
- Then `spec/changes/<name>/violations.md` is written containing frontmatter (checked timestamp, spec version) followed by "No violations found."

### Scenario: Violations report renders each violation with its fields
- Given a schema-valid verdict containing one or more violations
- When the verdict is recorded for a change
- Then `spec/changes/<name>/violations.md` is written containing a heading naming the change and violation count, followed by one line per violation showing its severity, article, evidence, and suggestion, with a BLOCKING marker on each violation classified as blocking


## Requirement: Skill-Driven Two-Step Check Flow

The `metta-check-constitution` skill MUST drive the complete check by, in order: invoking the contract-emission CLI step for the target change, spawning the `metta-constitution-checker` subagent restricted to Read-only tools with the emitted constitution articles and spec content, and passing the subagent's `{"violations": [...]}` output to the verdict-recording CLI step. The skill MUST surface a blocking result (exit `4`) rather than suppressing it, and the skill template and its deployed copy MUST remain byte-identical.
References: US-3

### Scenario: Skill completes a full check with no manual workaround
- Given an active change with a `spec.md` and no `ANTHROPIC_API_KEY` set in the session environment
- When the `metta-check-constitution` skill is invoked
- Then it runs the contract-emission step, spawns the `metta-constitution-checker` subagent with Read-only tools and the emitted constitution/spec content, and runs the verdict-recording step with the subagent's output, producing `violations.md` with no manual intervention

### Scenario: Skill surfaces a blocking result rather than masking it
- Given the `metta-constitution-checker` subagent returns a verdict containing a blocking violation
- When the skill's verdict-recording step exits `4`
- Then the skill reports the failure and the blocking violation(s) to the user rather than reporting success

### Scenario: Skill template and deployed copy stay byte-identical
- Given the skill template at its source location and its deployed copy
- When the change ships
- Then the two copies are byte-identical


## Requirement: Idempotent Re-Check Replaces the Prior Verdict

Running the full contract-then-record flow again for the same change MUST replace the contents of `violations.md` with the new check's result rather than appending to or merging with the previous report.
References: US-2

### Scenario: Re-running the check overwrites the prior report
- Given a change with an existing `violations.md` from a prior check
- When the contract-emission and verdict-recording steps are run again for the same change with a different verdict
- Then `violations.md` is fully replaced with the new check's rendered content, containing no content carried over from the prior run

### Scenario: Re-running with an unchanged clean verdict still overwrites
- Given a change with an existing `violations.md` reporting "No violations found."
- When the flow is run again and again produces a verdict with `{"violations": []}`
- Then `violations.md` is rewritten (same content, fresh timestamp/spec version), not appended to
