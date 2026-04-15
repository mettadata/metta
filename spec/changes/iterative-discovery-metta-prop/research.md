# Research: iterative-discovery-metta-prop

## Context

This change is skill-body-only: no TypeScript, no CLI commands, no schema changes. The
deliverable is revised markdown in two SKILL.md files. The research question is how to
express the iterative loop idiom clearly in the existing skill prose style.

---

## Existing Patterns Observed

### Skill prose style

Skills use a flat numbered-step list at the top level. Sub-steps use lettered bullets
(a, b, c). The only existing loop construct appears in `metta-propose/SKILL.md` step 5
(REVIEW-FIX LOOP) and step 6, which describe fix-then-re-verify cycles:

```
- **REVIEW-FIX LOOP (repeat until clean):**
  a. If any critical issues found: ...
  b. After fixes: re-run the 3 reviewers again
  c. Repeat until all reviewers report PASS/PASS_WITH_WARNINGS (max 3 iterations)
```

`metta-quick/SKILL.md` mirrors this pattern verbatim for its review loop.

`metta-init/SKILL.md` uses no loop construct — it delegates everything to a subagent and
returns. `metta-backlog/SKILL.md` uses sequential `AskUserQuestion` calls (one per action
branch) but no iteration.

### AskUserQuestion usage

All existing invocations are single-shot. The backlog skill chains two separate calls
sequentially (action pick, then slug pick) but neither call loops back. There are no
existing examples of "ask, evaluate, then ask again" in any skill.

### Discovery gate wording

The current `metta-propose` DISCOVERY GATE (step 2) is structured as:
- a scan phase (read files),
- an identification phase (spot ambiguities),
- a single `AskUserQuestion` call (3-6 questions),
- a pass-answers phase.

No format expectation is placed on the questions themselves; the skill trusts AI judgment
on what to ask. The example questions in step 2e are illustrative only.

---

## Decision 1: Loop Expression

**Options evaluated:**

A. "Repeat these steps" bullet — matches the review-fix loop pattern already in both files.
   Reads naturally as a process instruction. The existing pattern ("REVIEW-FIX LOOP
   (repeat until clean):") is already understood by orchestrators working in this codebase.

B. Numbered sub-steps under a "Discovery Loop" heading — adds visual weight, creates a
   named section inside a numbered step. Inconsistent with the rest of the skill body which
   reserves `##` headings for top-level sections only.

C. Pseudocode block (while/until syntax) — precise but alien to the rest of the document.
   Prose skills are instructions to an AI, not a compiler. Pseudocode introduces parsing
   overhead without adding clarity over well-written bullet prose.

**Recommendation: Option A.**

Use a labeled block that mirrors the existing REVIEW-FIX LOOP pattern:

```
**DISCOVERY LOOP (run until exit condition met):**
  a. [round conditions and question asks]
  b. [emit status line]
  c. Repeat with next round if ambiguity remains
  Exit when: (a) you honestly find no further ambiguity, or (b) the user selected an
  early-exit option in any AskUserQuestion.
```

The exit criterion is spelled out at the block level, not buried in a sub-bullet, because
REQ-4 requires it to be visible inside the discovery step.

---

## Decision 2: Exit-Option Wording

**Options evaluated:**

- `I'm done — proceed with these answers` — spec's own canonical phrasing (intent.md line 34,
  spec.md REQ-1). Conversational. The em-dash is consistent with the review-loop style
  already in both files. Clear imperative on both halves: statement of doneness + directive.

- `Stop discovery — use current answers` — imperative but "stop discovery" reads like a
  command to abort rather than a satisfied completion. Slightly negative connotation.

- `Done — no more questions` — too terse; "no more questions" sounds like frustration rather
  than confidence.

**Recommendation: `I'm done — proceed with these answers`.**

This phrase is already established in the spec. It reads as user-initiated completion
(positive intent), not cancellation. It MUST appear as the final option in every
`AskUserQuestion` within the loop. Document it once at the top of the DISCOVERY LOOP block
so the author of each round's questions doesn't have to re-derive it:

```
Every AskUserQuestion in this loop MUST include as its final selectable option:
"I'm done — proceed with these answers"
```

---

## Decision 3: Round-Gate Predicates

**Options evaluated:**

A. Lightweight heuristics the AI applies by reading the change description — no checklist,
   just representative examples. Matches how the current skill trusts AI judgment to
   identify ambiguity. Example phrasing: "Run Round 2 if the change involves file schemas,
   API contracts, external system calls, or store methods."

B. Literal checklist the AI ticks off — enumerate every trigger condition as a checkbox.
   More precise but adds length and implies exhaustiveness (the AI may over-refuse to skip
   if an edge case is not on the list).

C. Keyword scan instruction — tell the AI to scan the change description for specific
   terms. Too brittle; renames or paraphrases break the gate.

**Recommendation: Option A — named-category heuristics with four anchor categories.**

The spec (REQ-1) already names the four categories for Round 2: "file schemas, API
contracts, external system calls, store methods." The skill should repeat these exactly as
the trigger phrase — they are specific enough to guide judgment without being exhaustive.
For Round 3, "touches runtime code paths" is the spec's own predicate; add the negative
example ("docs-only or skill-only changes skip Round 3") so the AI knows the non-trivial
exclusion explicitly.

Format in the skill:

```
Round 2 (data model + integrations) — run when the change involves any of:
file schemas, API contracts, external system calls, or store methods.
Skip if none of those conditions are present.

Round 3 (edge cases + non-functional) — run when the change touches runtime code paths.
Skip for docs-only or skill-only changes.
```

One sentence per round. No table needed — tables add friction to scan.

---

## Decision 4: Between-Round Summary Format

**Options evaluated:**

A. Markdown bullets — clean, easy to parse, consistent with the review.md format used later
   in the same workflow. But multi-line output between AskUserQuestion calls may get lost
   in a long context.

B. Prose sentence — matches the conversational style of the skill body. Low visual
   overhead. But harder for a reader to spot quickly in a long session.

C. Single-line status inline — a compact line the orchestrator emits before each round
   boundary. Easiest to produce, hardest to miss, matches how the review-fix loop states
   its outcome in one line.

**Recommendation: Option C — a single inline status line.**

The spec says "emit a brief status line listing what's resolved and what remains open."
"Brief" and "status line" strongly suggest one line, not bullets. The skill should give a
concrete format template:

```
After each round, emit one line:
"Resolved: <topic A>, <topic B>. Open: <topic C> — proceeding to Round N."
If nothing remains open and no further round is needed:
"Resolved: all questions. Proceeding to proposer subagent."
```

This is short enough to reproduce consistently and specific enough to enforce the REQ-1
requirement without ambiguity about what "brief" means.

---

## Decision 5: Quick-Mode Trivial-Detection Heuristic

**Options evaluated:**

A. List of named example triggers + "apply judgment" — e.g., "single-line fix, typo,
   one-file delete." Matches how `metta-quick` currently phrases its light-discovery gate:
   "If the description is clear and specific (e.g. 'fix typo in header') → proceed without
   questions." Uses examples as anchors, not rules.

B. Enumerate every trivial pattern — exhaustive list. Same problem as Decision 3 Option B:
   the AI may over-refuse when a trigger is not listed.

C. Functional definition only ("no decisions remain unresolved") — too abstract, gives no
   anchor examples.

**Recommendation: Option A — three canonical examples plus the functional definition.**

Use the three examples the spec already names (intent.md, REQ-2): "single-line fix, typo,
one-file delete." Add the functional complement: "any description that leaves no approach,
scope, or integration decisions unresolved." This mirrors the existing metta-quick style:
examples first, then the general principle.

```
Before Round 1, evaluate: is this change trivially scoped?
Trivial examples: single-line fix, typo correction, one-file delete.
Trivial criterion: the description leaves no approach, scope, or integration decisions
unresolved.
If trivial → ask zero questions, proceed to intent.
If not trivial → enter the DISCOVERY LOOP below.
```

The AI uses examples as calibration and the criterion as the decision rule.

---

## Existing Structure to Preserve

The current `metta-propose` DISCOVERY GATE step 2 has three elements worth preserving:

1. The "YOU (the orchestrator, not a subagent)" attribution — critical, must stay.
2. The "mandatory — do NOT skip this step" label — must stay; REQ-4 requires exit criteria
   be inside the active instruction block, not softened.
3. The illustrative example questions block (Auth strategy, Password requirements, etc.) —
   should move or be replaced. The new loop body will include round-specific focal areas
   that subsume what these examples communicated. Keeping the old examples risks implying
   they are the only right questions; dropping them and replacing with round-topic guidance
   is cleaner.

---

## Multi-Round AskUserQuestion: No Existing Precedent

Across all skills in `src/templates/skills/`, there is no existing example of an
AskUserQuestion call that loops back and asks again. The backlog skill chains two calls
sequentially but neither is conditional on the other's answer. This means the loop pattern
being introduced is novel to the skill corpus. The recommendation is to lean on the
REVIEW-FIX LOOP precedent from `metta-propose` step 5 as the structural template — it is
the closest existing pattern and AI orchestrators demonstrably follow it correctly.

---

## Recommendation Summary

| Decision | Recommendation |
|----------|---------------|
| Loop expression | Labeled bullet block matching REVIEW-FIX LOOP pattern |
| Exit-option wording | `I'm done — proceed with these answers` (spec's own canonical phrase) |
| Round-gate predicates | Named-category heuristics, one sentence per round, negative example for Round 3 |
| Between-round summary | Single inline status line with a concrete format template |
| Trivial-detection heuristic | Three canonical examples + functional criterion, matching existing metta-quick style |

The skill body for `metta-propose` step 2 should be renamed from "DISCOVERY GATE" to
"DISCOVERY LOOP" to reflect the iterative nature. `metta-quick` step 2 retains "LIGHT
DISCOVERY" as the section name (the gate check happens first; the loop is a sub-path, not
the whole step).
