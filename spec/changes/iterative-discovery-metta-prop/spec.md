# Spec: iterative-discovery-metta-prop

## Overview

This specification governs the replacement of single-round discovery steps in the
`/metta:propose` and `/metta:quick` skills with a structured, iterative loop. The
loop terminates under two explicit exit conditions: the AI declares no remaining
ambiguity, or the user selects a labeled early-exit option. Both skill files MUST
remain byte-identical between their template and deployed copies.

---

## Requirements

### REQ-1: propose-discovery-iterative

The `/metta:propose` skill body MUST replace the single-round "DISCOVERY GATE" step
with an iterative loop executed directly by the orchestrator (not a subagent). The
orchestrator MUST execute rounds according to the following rules:

- Round 1 (scope + architecture): MUST always run. There is no zero-question path in
  `/metta:propose`.
- Round 2 (data model + integration points): MUST run when the change involves any of:
  file schemas, API contracts, external system calls, or store methods. MUST be skipped
  when none of those conditions are present.
- Round 3 (edge cases + non-functional requirements — errors, validation, performance,
  security): MUST run when the change touches runtime code paths. MUST be skipped for
  changes that are docs-only or skill-only.
- Round 4 and beyond (open-ended: "anything else unclear?"): MUST continue while the
  AI honestly identifies remaining ambiguities. MUST stop when the AI finds no further
  ambiguity.

Each round MUST present 2–4 focused questions via `AskUserQuestion` with concrete option
sets. Every `AskUserQuestion` call in the loop MUST include a final selectable option
semantically equivalent to `I'm done — proceed with these answers`, enabling user-
controlled early exit at any round boundary.

After each round's answers are received, the orchestrator MUST emit a brief status line
naming: (a) which questions were resolved by the round's answers, and (b) which questions,
if any, remain open. This status MUST be emitted before proceeding to the next round.

The full cumulative set of all question-answer pairs from all completed rounds MUST be
passed as structured context to the proposer subagent that writes `intent.md`. Answers
from later rounds MUST supplement, not replace, answers from earlier rounds.

#### Scenarios

**Scenario 1a — Simple change: Round 1 only, AI exits**

```
Given a change description with no data model, no API contract, no external calls,
  and no runtime code paths (e.g., "rename a constant in one config file")
When the orchestrator evaluates round conditions
Then Round 1 runs (scope + architecture questions asked)
And Round 2 is skipped (no schema/API/store involvement)
And Round 3 is skipped (no runtime code path involved)
And after Round 1 answers, the AI finds no remaining ambiguity
And the loop exits
And all Round 1 answers are passed to the proposer subagent as structured context
```

**Scenario 1b — Complex change: all four rounds run**

```
Given a change description that introduces a new API endpoint backed by a new
  data store schema, touching request-validation middleware (runtime code path)
When the orchestrator evaluates round conditions
Then Round 1 runs (scope + architecture)
And Round 2 runs (API contract + store schema are present)
And Round 3 runs (runtime code path — validation middleware — is touched)
And after Round 3, the AI identifies residual ambiguity about error response format
And Round 4 runs with the open-ended question
And after Round 4, the AI finds no remaining ambiguity and exits
And cumulative answers from all four rounds are passed to the proposer subagent
```

**Scenario 1c — User early-exits at Round 2**

```
Given a change description involving a new CLI command that writes to a YAML store
  (triggering Round 2 on store methods)
When Round 2 AskUserQuestion is presented to the user
And the user selects "I'm done — proceed with these answers"
Then the loop exits immediately after recording Round 2 answers
And Rounds 3 and 4 are not run
And cumulative answers from Rounds 1 and 2 are passed to the proposer subagent
```

**Scenario 1d — AI declares done at Round 3, no open-ended needed**

```
Given a change description that touches a runtime validation code path
  (triggering Round 3) but has no residual ambiguity after Round 3
When Round 3 answers are received
And the AI evaluates whether further ambiguity exists
Then the AI finds no remaining ambiguity
And Round 4 is not entered
And the loop exits with cumulative answers from Rounds 1–3 passed to the proposer subagent
```

---

### REQ-2: quick-discovery-conditional-loop

The `/metta:quick` skill body's "LIGHT DISCOVERY" step MUST become a gated entry into
the same iterative loop defined in REQ-1.

Before entering Round 1, the orchestrator MUST evaluate whether the change description
carries meaningful ambiguity:

- If the change is trivially scoped (single-line fix, typo, one-file delete, or any
  description that leaves no decisions unresolved): the orchestrator MUST ask zero
  questions and proceed directly to writing `intent.md`.
- If the change carries meaningful ambiguity (scope, approach, or integration unclear,
  or the change touches multiple files or existing contracts): the orchestrator MUST
  enter the iterative loop as specified in REQ-1, honoring every early-exit option and
  the same round-condition rules.

The orchestrator MUST apply this judgment itself; it MUST NOT delegate the ambiguity
evaluation to a subagent.

#### Scenarios

**Scenario 2a — Typo fix: zero questions**

```
Given a change description "fix typo in README header — 'recieve' → 'receive'"
When the orchestrator evaluates the change for meaningful ambiguity
Then the orchestrator determines the change is trivially scoped
And no AskUserQuestion calls are made
And the orchestrator proceeds directly to spawning the proposer subagent
```

**Scenario 2b — Multi-file refactor: loop engages**

```
Given a change description "refactor the auth module to support OAuth alongside
  the existing session-cookie strategy"
When the orchestrator evaluates the change for meaningful ambiguity
Then the orchestrator determines scope, approach, and integration are unclear
And the iterative loop is entered starting at Round 1
And Round 2 is evaluated (API contracts with the OAuth provider are involved)
And the loop proceeds per REQ-1 round conditions until exit
And cumulative answers are passed to the proposer subagent
```

**Scenario 2c — User early-exits from quick-mode loop**

```
Given a change description that triggers the iterative loop in /metta:quick
When the iterative loop is running and presents a Round 1 AskUserQuestion
And the user selects "I'm done — proceed with these answers"
Then the loop exits after Round 1
And the orchestrator passes Round 1 answers to the proposer subagent
And no further rounds are executed
```

---

### REQ-3: skill-byte-identity

After all edits are applied, the template copy and the deployed copy of each modified
skill MUST be byte-identical.

- `src/templates/skills/metta-propose/SKILL.md` MUST be byte-identical to
  `.claude/skills/metta-propose/SKILL.md`.
- `src/templates/skills/metta-quick/SKILL.md` MUST be byte-identical to
  `.claude/skills/metta-quick/SKILL.md`.

No other skill files are modified by this change.

#### Scenarios

**Scenario 3a — metta-propose template matches deployed copy**

```
Given the iterative discovery loop has been written into the metta-propose skill
When a byte-level diff is performed between
  src/templates/skills/metta-propose/SKILL.md and
  .claude/skills/metta-propose/SKILL.md
Then the diff produces no output (files are identical)
```

**Scenario 3b — metta-quick template matches deployed copy**

```
Given the conditional iterative loop has been written into the metta-quick skill
When a byte-level diff is performed between
  src/templates/skills/metta-quick/SKILL.md and
  .claude/skills/metta-quick/SKILL.md
Then the diff produces no output (files are identical)
```

---

### REQ-4: discovery-completeness-documentation

Both skill bodies MUST explicitly document the loop exit criteria so that the
orchestrating AI knows when to stop. The text MUST contain a statement equivalent to:

> Exit the loop when (a) you honestly find no further ambiguity or (b) the user
> selects an early-exit option.

This exit criterion MUST appear in both `metta-propose/SKILL.md` and
`metta-quick/SKILL.md` within the discovery step, not in a comment or footnote outside
the active instruction block.

#### Scenarios

**Scenario 4a — Exit criterion present in metta-propose**

```
Given the updated metta-propose/SKILL.md has been written
When the text of the discovery step is read
Then the file contains a statement specifying that the loop exits when
  (a) the AI finds no further ambiguity or (b) the user selects an early-exit option
And this statement appears inside the discovery step instruction block
```

**Scenario 4b — Exit criterion present in metta-quick**

```
Given the updated metta-quick/SKILL.md has been written
When the text of the discovery step is read
Then the file contains a statement specifying that the loop exits when
  (a) the AI finds no further ambiguity or (b) the user selects an early-exit option
And this statement appears inside the discovery step instruction block
```

---

## Out of Scope

- CLI command changes: `src/cli/commands/propose.ts` and `src/cli/commands/quick.ts`
  are not modified. The iterative loop lives entirely in skill orchestration markdown.
- New flags: no `--deep`, `--no-discovery`, or `--rounds N` flags are added to any
  CLI command.
- Other skills: `metta-fix-gap`, `metta-fix-issues`, `metta-init`, and all other
  skills are not taught iterative discovery by this change.
- Persisting discovery answers: answers live only in the in-session context passed to
  the proposer subagent. They are not written to disk, stored in `.metta.yaml`, or
  tracked as a spec artifact.
- Discovery completeness tracking: no gate, metric, or artifact captures which rounds
  executed. Completeness is determined by AI judgment at runtime.
- Changing AskUserQuestion itself: the tool interface, option format, and invocation
  signature are used as-is with no modifications.
- Minimum question counts: while 2–4 questions per round is the stated guidance, this
  spec does not mandate failure if an orchestrator asks 1 or 5 in unusual circumstances.
  The guidance is normative intent, not a hard gate.
