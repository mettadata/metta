# Design: iterative-discovery-metta-prop

## Approach

Replace the single-shot discovery steps in two skill files with a structured iterative
loop. The change is pure prose: no TypeScript, no CLI commands, no schema changes.
Deliverable is revised markdown in four files (two template + two deployed, byte-identical
pairs).

The loop structure mirrors the existing `REVIEW-FIX LOOP` pattern already in both skill
files (metta-propose step 5, metta-quick step 7). Using the same labeled-block idiom means
AI orchestrators already understand the control-flow semantics; no new instruction pattern
is introduced.

### ADR-1: Loop expression — labeled bullet block, not pseudocode

**Decision:** Express the loop as a labeled block matching the existing `REVIEW-FIX LOOP`
pattern: `**DISCOVERY LOOP (run until exit condition met):**` with lettered sub-bullets.

**Rationale:** Skills are instruction prose consumed by an AI orchestrator, not compiled
code. The REVIEW-FIX LOOP is demonstrably followed correctly today. Pseudocode (while/until
syntax) introduces parsing overhead without adding clarity. Numbered sub-headings would
be inconsistent with how `##` headings are used in both files (top-level sections only).

**Implication:** No new prose idiom is introduced to the skill corpus; two existing files
gain a second instance of a pattern they already contain.

### ADR-2: Exit-option wording — canonical phrase from spec

**Decision:** The final selectable option in every `AskUserQuestion` within the loop is
exactly: `I'm done — proceed with these answers`

**Rationale:** This phrase is established in intent.md (line 34) and spec.md (REQ-1). The
em-dash is consistent with the review-loop prose style already in both files. "Done"
signals satisfied completion, not cancellation. The phrase is documented once at the top of
the DISCOVERY LOOP block so each round's questions inherit the requirement without
re-derivation.

### ADR-3: Round-gate predicates — named-category heuristics

**Decision:** Each conditional round gate is expressed as a one-sentence named-category
heuristic, not an exhaustive checklist or keyword scan.

**Rationale:** Spec REQ-1 already names the four trigger categories for Round 2: "file
schemas, API contracts, external system calls, store methods." Repeating these exactly gives
the AI specific-enough anchors without implying exhaustiveness. Round 3 uses the spec's own
predicate ("touches runtime code paths") plus the explicit negative exclusion ("docs-only or
skill-only changes skip Round 3") to prevent over-triggering.

### ADR-4: Between-round summary — single inline status line

**Decision:** After each round, the orchestrator emits exactly one line using the template:
`"Resolved: <A>, <B>. Open: <C> — proceeding to Round N."`
When no further rounds are needed: `"Resolved: all questions. Proceeding to proposer subagent."`

**Rationale:** The spec says "emit a brief status line" — "brief" and "status line" indicate
one line, not bullets. The concrete format template eliminates ambiguity about what "brief"
means and allows the output to remain scannable in long sessions.

### ADR-5: Quick-mode trivial-detection — examples plus functional criterion

**Decision:** Before Round 1, metta-quick evaluates triviality using three canonical examples
(single-line fix, typo correction, one-file delete) as calibration anchors, plus the
functional criterion: "the description leaves no approach, scope, or integration decisions
unresolved."

**Rationale:** The existing metta-quick LIGHT DISCOVERY already uses the examples-then-
principle pattern. Three specific examples give the AI calibration reference points; the
functional criterion is the actual decision rule. Either alone is weaker: examples alone
cannot enumerate every trivial case; a functional criterion alone is too abstract without
anchors.

---

## Components

This change touches exactly two source file pairs. No other components are involved.

### `src/templates/skills/metta-propose/SKILL.md`

Step 2 "DISCOVERY GATE" is replaced with "DISCOVERY LOOP". The replacement:

- Retains the "YOU (the orchestrator, not a subagent)" and "mandatory — do NOT skip" labels.
- Removes the static 3-6 question instruction and illustrative example questions (Auth
  strategy, Password requirements, Session duration). Those examples implied exhaustiveness
  and are subsumed by the round-topic guidance.
- Adds the DISCOVERY LOOP block with Round 1 (always), Round 2 (conditional: file schemas /
  API contracts / external system calls / store methods), Round 3 (conditional: runtime code
  paths; skipped for docs-only or skill-only), Round 4+ (open-ended while genuine ambiguity
  remains).
- Documents the exit-option phrase once at the top of the loop block.
- Documents the between-round status line format.
- Documents the exit condition (REQ-4): exit when (a) no further ambiguity found, or (b)
  user selected early-exit.
- Passes full cumulative answer set (all rounds) to the proposer subagent.

All other steps (1, 3–8) and all content after step 2 are unchanged.

### `.claude/skills/metta-propose/SKILL.md`

Byte-identical copy of the template file above. Written after the template to guarantee
identity; verified by the static test.

### `src/templates/skills/metta-quick/SKILL.md`

Step 2 "LIGHT DISCOVERY" gains a trivial-detection gate at the top, then conditionally
enters the same DISCOVERY LOOP structure. Specifically:

- The existing "clear and specific / 1-3 quick questions" text is replaced.
- A gate block appears first: evaluate triviality using examples and functional criterion.
  If trivial: zero questions, proceed to intent. If not trivial: enter DISCOVERY LOOP.
- The DISCOVERY LOOP sub-block is structurally identical to the metta-propose version
  (same four rounds, same exit-option phrase, same status line format, same exit criterion).
- All other steps (1, 3–12) and surrounding text are unchanged.

### `.claude/skills/metta-quick/SKILL.md`

Byte-identical copy of the metta-quick template file.

---

## Data Model

No data model changes. Skills are instruction prose; no new fields, schemas, or state
artifacts are introduced. Discovery answers remain in-session context only — they are not
written to disk, not stored in `.metta.yaml`, and not tracked as spec artifacts. This is
unchanged from the current behavior where the DISCOVERY GATE answers are passed
inline to the proposer subagent.

---

## API Design

No API changes. `AskUserQuestion` is used as-is — existing interface, option format, and
invocation signature. The loop introduces repeated calls to the same tool; it does not
change the tool contract.

No CLI command changes. `src/cli/commands/propose.ts` and `src/cli/commands/quick.ts` are
not modified.

---

## Dependencies

None. All components used (AskUserQuestion, Agent tool, metta-proposer subagent) are
already present and working in both skills. No new npm packages, no new framework modules,
no new template files.

---

## Risks and Mitigations

**Risk: AI enters an infinite Round 4+ loop when it can always find one more ambiguity.**

Mitigation: The "I'm done — proceed with these answers" early-exit option is mandatory on
every AskUserQuestion in the loop. The user can terminate at any round boundary. The exit
criterion also gives the AI an honest-judgment obligation ("honestly find no further
ambiguity") — the word "honestly" is load-bearing and should appear in the skill text. No
round count cap is imposed; the loop relies on the combination of user exit and AI
self-assessment. If a cap is needed in practice it can be added without a spec change.

**Risk: Quick-mode trivial-detection gate over-triggers the loop for genuinely small changes.**

Mitigation: Three concrete trivial examples (single-line fix, typo, one-file delete) act as
calibration anchors alongside the functional criterion. The functional criterion ("leaves no
approach, scope, or integration decisions unresolved") is objective and directional. The
examples ensure the AI does not treat every single-file change as non-trivial.

**Risk: Between-round status lines become verbose or inconsistently formatted across
orchestrator runs.**

Mitigation: The status line format is locked to a single template in the skill body. The
format is concrete enough to reproduce consistently and short enough that inconsistency
would be visible immediately in any session.

**Risk: Template and deployed copies drift after initial write.**

Mitigation: A byte-identity static test already exists for the skill corpus (REQ-3).
The test for both metta-propose and metta-quick pairs is added to `tests/` if not already
present. The build step that copies templates to `.claude/skills/` enforces identity at
deploy time; manual edits to one copy without updating the other will be caught by the test.

**Risk: Removing the illustrative example questions (Auth strategy, etc.) reduces AI
question quality in Round 1.**

Mitigation: The round-topic guidance ("scope + architecture") is more general and better
calibrated than the auth-specific examples. The research explicitly recommends dropping
those examples to avoid implying they are the only right questions (research.md, "Existing
Structure to Preserve" section). The proposer subagent receives richer context precisely
because the loop runs multiple focused rounds.

---

## Test Strategy

Tests are static-content checks only. Skills are LLM-consumed prose, not executable code.
Behavior verification occurs implicitly during the next real discovery session
(`/metta:propose` or `/metta:quick`).

Test file: `tests/skill-discovery-loop.test.ts`

### metta-propose checks

1. File contains the string `DISCOVERY LOOP` (confirms old DISCOVERY GATE header replaced).
2. File contains the exact canonical exit-option phrase `I'm done — proceed with these answers`.
3. File contains `Round 1` marker.
4. File contains `Round 2` marker.
5. File contains `Round 3` marker.
6. File contains an exit criterion statement referencing both exit conditions (AI judgment +
   user early-exit); acceptable match: text contains both "no further ambiguity" and
   "early-exit" (or equivalent REQ-4 language).

### metta-quick checks

7. File contains both a trivial-detection gate reference (e.g., "trivially scoped" or
   "zero questions") AND a reference to the DISCOVERY LOOP structure (confirming both paths
   are documented).
8. File contains the canonical exit-option phrase `I'm done — proceed with these answers`.
9. File contains the exit criterion statement (same check as #6).

### Byte-identity checks (REQ-3)

10. `src/templates/skills/metta-propose/SKILL.md` content equals
    `.claude/skills/metta-propose/SKILL.md` content (exact string comparison).
11. `src/templates/skills/metta-quick/SKILL.md` content equals
    `.claude/skills/metta-quick/SKILL.md` content (exact string comparison).

All eleven checks are read-only file assertions. No mocking, no fixtures beyond the actual
files. Test runtime: negligible (file reads + string comparisons).

No integration or runtime tests are added. The loop's AI-judgment behavior (round selection,
early-exit, honest ambiguity assessment) cannot be unit-tested against deterministic
assertions — it is validated through use.
