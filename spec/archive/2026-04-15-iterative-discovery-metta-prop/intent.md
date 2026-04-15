# Intent: iterative-discovery-metta-prop

## Problem

Discovery in both `/metta:propose` and `/metta:quick` is one-shot. Each skill contains a
single "DISCOVERY GATE" or "LIGHT DISCOVERY" step that asks 3–6 questions and moves on.
For anything beyond a trivial change — multi-file features, architectural decisions,
third-party integrations — this single pass routinely misses critical ambiguities:

- **Scope creep hidden in later rounds**: edge cases and non-functional requirements (error
  handling, validation, performance, security) surface only after spec and design are
  drafted, forcing review-fix loops that could have been prevented.
- **Data model assumptions**: field types, relationships, and nullable semantics are never
  surfaced during discovery, so the proposer subagent guesses and that guess propagates
  through spec → design → tasks → implementation.
- **Integration contract gaps**: how the new code connects to existing stores, APIs, or
  services is left implicit; executors then wire things up incorrectly and reviewers
  catch it too late.

The current `metta-propose` SKILL.md step 2c reads: "Ask 3-6 focused questions using
AskUserQuestion with concrete options." The current `metta-quick` SKILL.md step 2 reads:
"ask 1-3 quick questions using AskUserQuestion." Both are static — no mechanism to continue
when ambiguity remains after the first batch of answers.

Users want 100% certainty that the AI is building what they intend, not its best-guess
approximation. Guesses that propagate downstream are the leading cause of review-fix
iterations and specification rework in the current workflow.

## Proposal

Restructure the discovery step in both `metta-propose` and `metta-quick` skills from a
single question batch into an iterative, structured loop with four defined rounds. The
loop terminates when the AI declares "no remaining ambiguity" OR the user selects
"I'm done — proceed with these answers" from any AskUserQuestion.

### Round structure

| Round | Focus | Condition to run |
|-------|-------|-----------------|
| 1 | Scope + architecture | Always — mandatory first round |
| 2 | Data model + integration points | Conditional: skip if change has no data shapes, APIs, or external integrations |
| 3 | Edge cases + non-functional (error handling, validation, perf, security) | Conditional: skip if change is trivially scoped |
| 4+ | Open-ended — "Any remaining unclear points?" | Repeat while AI finds genuine ambiguity; exit when nothing remains |

Each round MUST:

1. Present 2–4 focused questions via `AskUserQuestion` with concrete option sets.
2. Include "I'm done — proceed with these answers" as a selectable option on every question,
   so the user can short-circuit at any point.
3. After answers are received, print a brief summary: what has been resolved and what (if
   anything) remains open.

Between rounds, the AI MUST state which ambiguities were resolved by the previous round's
answers and which open questions remain before proceeding to the next round. This visible
resolution state allows the user to decide whether to continue or stop early.

### Behavior for `/metta:propose`

The existing step 2 "DISCOVERY GATE" is replaced with the iterative loop. All four rounds
are available. Round 1 is always executed — there is no zero-question path for propose.

### Behavior for `/metta:quick`

The existing step 2 "LIGHT DISCOVERY" is replaced with a gated version of the iterative
loop. Before entering Round 1, the AI MUST evaluate whether the change description carries
meaningful ambiguity:

- **No ambiguity** (e.g., "fix typo in README header"): skip the loop entirely — zero
  questions, proceed directly to intent.
- **Meaningful ambiguity** (e.g., "refactor auth module to support OAuth"): enter the
  iterative loop exactly as in propose.

The AI MUST apply judgment at the boundary. A 1-line typo fix → 0 questions.
A 5-file feature or any change touching existing contracts → loop normally.

### Cumulative context passing

The full set of all question-answer pairs from all completed rounds MUST be passed
as structured context to the proposer subagent that writes `intent.md`. Each round's
answers supplement, not replace, the answers from prior rounds.

### Skill file changes

Both files are updated in place (byte-identical between `src/templates/` and `.claude/skills/`):

- `src/templates/skills/metta-propose/SKILL.md` — step 2 replaced with iterative loop.
- `src/templates/skills/metta-quick/SKILL.md` — step 2 replaced with gated iterative loop.

No other skills, CLI commands, or framework modules change.

## Impact

- **User experience**: complex changes receive progressively deeper questioning; trivial
  changes remain zero- or one-round in `/metta:quick` and one-round in `/metta:propose`.
- **Downstream quality**: intent.md, spec.md, design.md, and tasks.md start from richer,
  fully-resolved context, reducing the frequency of review-fix loops.
- **Discovery time**: multi-round loops add wall-clock time to the propose phase for
  non-trivial changes. This is an intentional trade-off for higher spec fidelity.
- **No CLI code changes**: skills are pure markdown orchestration instructions; no
  TypeScript source files are modified.
- **No new dependencies**: `AskUserQuestion` is already the established tool for
  interactive questions in both skills.
- **Skill template sync**: both `src/templates/skills/` and `.claude/skills/` copies of
  each file MUST remain byte-identical after this change, matching the existing convention.

## Out of Scope

- **CLI command changes**: `metta propose` and `metta quick` commands in
  `src/cli/commands/` are not modified. Skills are pure orchestration layers.
- **New flags**: no `--deep`, `--no-discovery`, or `--rounds N` flags are added.
- **Other skills**: `metta-fix-gap`, `metta-fix-issues`, `metta-init`, and all other
  skills are not taught iterative discovery by this change.
- **Persisting discovery answers**: answers exist only in the in-session context passed to
  the proposer subagent. They are not written to disk, not stored in `.metta.yaml`, and
  not tracked as a spec artifact.
- **Discovery completeness tracking**: no gate, metric, or artifact captures whether all
  rounds were executed. Completeness is determined by AI judgment at runtime.
- **Changing AskUserQuestion itself**: the tool interface and option format are used
  as-is.
