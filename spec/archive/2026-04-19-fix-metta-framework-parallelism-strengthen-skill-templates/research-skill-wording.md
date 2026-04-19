# Research: Skill Template Wording for Parallelism Discipline

**Change:** fix-metta-framework-parallelism-strengthen-skill-templates
**Date:** 2026-04-19
**Scope:** Template wording for `metta-propose/SKILL.md` and `metta-quick/SKILL.md` Implementation sections

---

## Context and Baseline

The current `/metta-propose` Implementation section (step 4) already states the intent clearly:

> "If tasks touch DIFFERENT files → spawn one metta-executor per task in a SINGLE message (parallel)"
> "If tasks share files → spawn tasks ONE AT A TIME (sequential)"

The current `/metta-quick` Implementation section (step 5) states:

> "If multiple independent files → spawn one metta-executor per file group in a single message (parallel)"
> "If all changes touch the same files → spawn a single metta-executor (sequential)"

Despite this, orchestrators default to serial execution under load. The diagnostic from
the intent: the path of least resistance — one tool call at a time — is never challenged
by the template, and the orchestrator is not required to produce an explicit, auditable
plan before issuing spawn calls.

The key reference is `metta-fix-issues/SKILL.md` step 4 (single-issue pipeline) and
the `--all` mode. The `--all` mode is the strongest parallelism model in the codebase:
it reads all issue files, extracts file paths, groups issues by file-overlap,
and explicitly spawns one executor per batch in a SINGLE message. The single-issue
pipeline's step 4 mirrors the `metta-propose` structure almost exactly. Both are well-
specified, but neither is stronger than `metta-propose` step 4 — they share the same
structural weakness: the decision is documented but the orchestrator is not required to
narrate the decision before acting.

---

## Approach 1: Mandatory Explicit Self-Check Step

### Description

Before spawning any executors for a batch, the orchestrator MUST produce a written
parallelism plan as a distinct named step. The plan lists every task, its declared
Files field, and an explicit "parallel" or "sequential" verdict with the reason. Only
after the plan is written does the orchestrator issue spawn calls.

Example required output before spawning:

```
Parallelism plan — Batch 1:
  Task 1.1: Files [src/planning/parallel-wave-computer.ts, tests/parallel-wave.test.ts]
  Task 1.2: Files [src/cli/commands/tasks.ts]
  Task 1.3: Files [src/index.ts]
  Overlap check: 1.2 and 1.3 share no files with 1.1. No overlap anywhere.
  Decision: spawn 1.1, 1.2, 1.3 in parallel (single message).
```

### Pros

- Makes the wrong choice visible and auditable in the session transcript — any
  deviation from parallel execution is immediately obvious to a human reviewer.
- Directly addresses the root-cause identified in the intent: the orchestrator is
  forced to reason explicitly rather than defaulting to sequential as the safe choice.
- Low reading burden for the orchestrator — each task already declares a Files field;
  the plan is a mechanical enumeration.
- Consistent with how the review-fix loop already works: the loop explicitly groups
  issues by file before spawning. The self-check step applies the same logic upstream.

### Cons

- Not mechanically enforceable. The template is prose; there is no interpreter that
  rejects a spawn call if the plan was skipped. An orchestrator under load can omit
  the plan and proceed to sequential spawns without consequence.
- Adds a non-trivial number of lines to what the orchestrator must produce before
  acting, which may be skipped when the orchestrator is under token pressure.
- Compliance risk: medium-high. The instruction is new, requires deliberate output
  before action, and has no enforcement hook. Orchestrators that have already formed
  the habit of sequential spawning will not be stopped; they will at worst produce a
  superficial plan that rubber-stamps serial execution.
- The plan format is not validated — an orchestrator can write "Decision: parallel"
  and then spawn sequentially, satisfying the letter of the check while violating the
  spirit.

### Orchestrator compliance risk

Medium-high. The self-check step strengthens auditability but does not change the
cost function. Sequential execution remains the path of least resistance; the check
adds friction to the decision but not to the act.

---

## Approach 2: Anti-Example + Rule Inversion (Parallel by Default)

### Description

Flip the default stance. The current rule is phrased as a conditional: "if different
files, spawn in parallel." The new rule is an unconditional default: "spawn in
parallel unless a specific file path conflict is documented."

Pair the inverted rule with a worked anti-example clearly labelled "WRONG" that
shows the serial pattern (one spawn, wait, next spawn) side-by-side with the
corrected single-message pattern ("RIGHT"). The anti-example is concrete — same
task IDs, same file paths, same prompts — so the orchestrator can pattern-match
directly against it.

Anti-example (WRONG):
```
// WRONG — sequential by default
spawn executor for Task 1.1 (src/planning/parallel-wave-computer.ts)
[wait]
spawn executor for Task 1.2 (src/cli/commands/tasks.ts)
[wait]
spawn executor for Task 1.3 (src/index.ts)
```

Corrected example (RIGHT):
```
// RIGHT — parallel because no file overlap
spawn executor for Task 1.1
spawn executor for Task 1.2   <- same message, all three calls
spawn executor for Task 1.3
```

Sequential justification requirement: if and only if two tasks share a file path,
the orchestrator MUST name the specific conflicting file before spawning sequentially.
"Task 1.2 and 1.3 both write src/cli/commands/tasks.ts — running 1.3 after 1.2."

### Pros

- Changes the default stance at the rule level. The wrong choice is no longer the
  comfortable default — sequential now requires explicit justification, which introduces
  friction against the regressive pattern.
- Anti-examples are pedagogically effective for LLM prompt compliance. Concrete labelled
  examples of wrong behavior activate pattern-avoidance more strongly than abstract
  rules.[^1]
- Pairs well with Approach 1 — the self-check step and the inverted default reinforce
  each other.
- The sequential justification requirement makes the reasoning legible in the transcript
  without requiring a separate plan section.
- Shorter than Approach 3 in template length — the anti-example adds ~10 lines but
  does not require a fill-in-the-blank scaffold.

### Cons

- Rule inversion alone is insufficient to change behavior if the anti-example is not
  present. The rule must be read and internalized before it changes the cost function.
- The anti-example must be maintained if task-field formats change — it is not abstract.
- Compliance risk: medium. The inverted default and the named-justification requirement
  increase friction for sequential execution, but they still rely on the orchestrator
  reading the rule and choosing to follow it.

### Orchestrator compliance risk

Medium. Rule inversion is the single highest-leverage change per line of template
text. Naming the conflicting file as a prerequisite for sequential execution is
achievable even under moderate token pressure, because it is a one-line output rather
than a multi-line plan.

[^1]: Relevant observation from prompt-engineering research: labelled counter-examples
("WRONG" / "RIGHT") outperform abstract rules for behavioral correction in LLM instruction
following. Based on general knowledge of prompt engineering best practices; no specific
paper URL, as this is a training-data-period claim well within the August 2025 cutoff.

---

## Approach 3: Structural Fill-in-the-Blank Template

### Description

Replace the Implementation section prose with a mandatory scaffold the orchestrator
must populate before issuing spawn calls. The scaffold is explicitly named "Parallelism
Decision Template" and must appear verbatim (with blanks filled) in the transcript
before any tool calls in that batch.

```
## Parallelism Decision — Batch [N]

Tasks in this batch:
- Task [ID]: Files [list each file]
- Task [ID]: Files [list each file]
...

File-overlap check:
- [ ] No overlap found between any tasks -> Decision: PARALLEL (all in one message)
- [ ] Overlap found: Task [X] and Task [Y] share [filename] -> Decision: SEQUENTIAL for those tasks

Spawn plan:
- Parallel wave: [task IDs]
- Sequential after wave: [task ID] (reason: shares [filename] with [task ID])
```

The fill-in-the-blank format is structural: it requires specific fields and boxes to
be populated, not free-form prose. If a field is blank or contains "N/A" without
justification, the plan is incomplete.

### Pros

- Maximum auditability — every decision has a named field that must be populated.
- The scaffold structure makes it harder to skip the check, because an incomplete
  scaffold is visible as missing text (empty checkboxes, blank lines).
- Makes the Implementation section self-documenting: the pattern is the same for every
  batch, and any human reviewing the transcript can compare batches against the scaffold.
- Highest information density for post-hoc debugging: when a change runs slowly, the
  transcript will show the exact parallelism decisions and their justifications.

### Cons

- Highest orchestrator compliance risk. The scaffold is longer than either of the other
  approaches and must be produced completely before acting. Under token pressure or
  when the orchestrator is fast-pathing, the scaffold is the most skippable element
  because it is entirely text-before-action with no mechanical enforcement.
- Adds significant line count to the SKILL.md templates, which increases the reading
  burden on the orchestrator at the start of every batch.
- The scaffold format may become stale as `tasks.md` format evolves (e.g., if `Files`
  is renamed or restructured).
- The checkbox notation (`- [ ]`) is a markdown-rendered convention; in raw session
  transcripts it is just text, which reduces its visual salience.
- A partially-filled scaffold (e.g., tasks listed but overlap check skipped) is
  functionally indistinguishable from a complete scaffold to the orchestrator — there
  is no enforcement boundary.

### Orchestrator compliance risk

High. The fill-in-the-blank format is the most demanding on the orchestrator and the
least enforceable. Orchestrators that are optimizing for throughput will produce a
minimal version of the scaffold that satisfies pattern recognition without performing
the actual overlap analysis.

---

## Tradeoff Summary

| Criterion                              | Approach 1 (Self-Check) | Approach 2 (Anti-Example + Inversion) | Approach 3 (Fill-in-Blank) |
|----------------------------------------|:-----------------------:|:-------------------------------------:|:--------------------------:|
| Auditability                           | High                    | Medium-High                           | Highest                    |
| Template length added                  | Medium (+12 lines)      | Medium (+10 lines)                    | High (+20 lines)           |
| Orchestrator compliance risk           | Medium-High             | Medium                                | High                       |
| Changes default cost function          | No                      | Yes (inversion)                       | No                         |
| Requires named justification for seq.  | No                      | Yes                                   | Yes                        |
| Anti-example present                   | No                      | Yes                                   | No                         |
| Mechanically enforceable               | No                      | No                                    | No                         |
| Composable with other approaches       | Yes                     | Yes                                   | Partially                  |

---

## Recommendation: Combined Approach 2 + Approach 1 (Inversion as Default, Self-Check as Narration)

None of the three approaches is maximally effective alone. The highest-ROI combination
is:

1. **Rule inversion (Approach 2, primary):** make parallel the unconditional default.
   Sequential requires naming the specific conflicting file. This changes the cost
   function — the wrong choice now costs more than the right choice.

2. **Anti-examples (Approach 2, secondary):** include one concrete WRONG/RIGHT pair
   per template, showing serial spawns versus single-message parallel spawns for the
   same task set. This activates pattern-avoidance.

3. **Mandatory narration (Approach 1, lightweight):** require the orchestrator to
   produce a one-line summary before each batch ("Tasks 1.1, 1.2, 1.3 — no overlap —
   spawning in parallel" or "Tasks 2.1, 2.2 — both write src/cli/commands/tasks.ts —
   spawning 2.1 first, 2.2 after"). This is shorter than the full self-check plan but
   still produces an auditable signal.

Approach 3 (fill-in-blank) is rejected as primary. Its compliance risk is highest
precisely when the orchestrator is under the most pressure to skip it, which is the
condition we are trying to defend against. The scaffold's length and the absence of
enforcement make it the worst risk-adjusted option despite its auditability.

**Key insight:** The failure mode is not that orchestrators are unaware of the parallel
rule — the rule already exists. The failure mode is that sequential execution is cheaper
to produce. Rule inversion plus a concrete anti-example are the minimum changes that
raise the cost of sequential execution relative to parallel execution in the instruction
layer, without requiring mechanical enforcement that the template cannot provide.

---

## Draft Replacement Text

### For `metta-propose/SKILL.md` — Step 4 (Implementation)

```markdown
4. **IMPLEMENTATION — PARALLEL BY DEFAULT:**

   **Rule: spawn tasks in parallel unless a specific file conflict prevents it. Sequential execution requires naming the conflicting file.**

   **WRONG (do not do this):**
   ```
   spawn metta-executor for Task 1.1   // wait for it to finish
   spawn metta-executor for Task 1.2   // wait for it to finish
   spawn metta-executor for Task 1.3   // 3 serial calls = 3x wall-clock time
   ```

   **RIGHT (single message, true parallelism):**
   ```
   spawn metta-executor for Task 1.1
   spawn metta-executor for Task 1.2   // all three in one message
   spawn metta-executor for Task 1.3
   ```

   **Procedure:**
   a. Read `spec/changes/<change>/tasks.md` — YOU the orchestrator, not a subagent
   b. For each batch (`## Batch N`):
      - List each task's `Files` field
      - State one line: "Tasks X, Y, Z — no overlap — spawning in parallel" OR "Task W shares [filename] with Task X — spawning W after X"
      - Different files → **spawn all tasks in a SINGLE message** (parallel)
      - Shared file → spawn the conflicting tasks sequentially; name the file
      - Each executor prompt: include ONLY that task's details (Files, Action, Verify, Done) — NOT the entire tasks.md
   c. Wait for ALL executors in the batch to complete before starting the next batch
   d. After all batches: write summary.md and commit
   e. `metta complete implementation --json --change <name>`

   **Sequential requires justification.** If you find yourself spawning one task and waiting before the next, stop and verify: is there a specific shared file, or did you default to sequential by habit? Default is parallel. The only valid justification is a named file path shared between tasks.
```

### For `metta-quick/SKILL.md` — Step 5 (Implementation)

```markdown
5. **Implementation — parallel by default:**

   **Rule: spawn executors in parallel unless tasks share a specific file. Sequential execution requires naming the conflicting file.**

   **WRONG:**
   ```
   spawn metta-executor for file-group A   // wait
   spawn metta-executor for file-group B   // serial = slow
   ```

   **RIGHT:**
   ```
   spawn metta-executor for file-group A
   spawn metta-executor for file-group B   // one message, both at once
   ```

   - Read the intent to identify independent pieces (separate files, separate modules)
   - State one line before spawning: "Groups A, B — no shared files — spawning in parallel" OR "Groups A and B both write [filename] — spawning A first"
   - Independent files → **spawn one metta-executor per file group in a single message** (parallel)
   - Shared file → spawn sequentially, name the file
   - Each executor: implement its piece, run tests, commit with `feat(<change>): <description>`
   - After all executors complete, write `spec/changes/<change>/summary.md` and commit

   **Default is parallel. Sequential is the exception and requires a named file conflict.**
```

---

## Notes on Consistency with `metta-fix-issues`

The `metta-fix-issues` `--all` mode at step 2 already implements file-overlap batching
explicitly ("read each issue file to identify which source files it touches; batch
issues that touch the SAME files together"). The single-issue pipeline step 4 uses
the same language as `metta-propose`. The draft replacement text above is consistent
with the `--all` mode's explicit batching logic, which is the strongest existing model
in the codebase. The one-line narration requirement is new to both templates and is not
present in `metta-fix-issues`; it could be added there in a follow-up but is out of
scope for this change.
