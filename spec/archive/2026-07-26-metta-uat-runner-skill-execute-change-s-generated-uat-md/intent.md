# metta-uat-runner-skill-execute-change-s-generated-uat-md

## Problem

Since 2026-07-21, every finalized change ships a `UAT.md` acceptance script: story-grouped steps (`### US-N` groups, `#### Step G.S` with **Setup**/**Do**/**Observe**, optional **Machine-verified** annotations, `- [ ] Pass` checkboxes, and metachar-filtered `Run:` hints), generated deterministically by `src/finalize/uat-generator.ts` and invoked from `src/finalize/finalizer.ts` Step 5b when `config.uat.enabled` is set. But nothing in the framework executes these scripts. The checkboxes stay unchecked forever, there is no record of whether acceptance ever happened, and the document's own promise — that a human or agent will walk the steps and report failures via `/metta-issue` — goes unfulfilled.

Who is affected:

- **Project maintainers** who finalize changes get an acceptance artifact with no acceptance signal. They cannot tell, weeks later, whether a change's UAT was ever run, passed, or failed.
- **AI orchestrators** have no sanctioned workflow to run a UAT; ad-hoc execution risks editing UAT.md in ways the document itself forbids ("Do not edit this document to make a step pass" — `src/templates/artifacts/uat.md`, Reporting failures section) and bypasses the failure-to-issue loop.
- **Consumers of the archive** — `spec/specs/finalize-ship/spec.md` (~line 341) already anticipates reading UAT.md "from the live change directory or months later from `spec/archive/<date>-<name>/`" — find only the blank script, never the outcome.

## Proposal

Add a UAT runner: a new skill/agent pair that executes a change's generated UAT.md, checks the boxes honestly, and records the outcome as an append-only run history inside the same document.

### 1. New skill: `/metta-uat` (template + deployed SKILL.md pair)

- Files: `src/templates/skills/metta-uat/SKILL.md` byte-identical to `.claude/skills/metta-uat/SKILL.md`, following the existing pair convention.
- Takes an optional change name argument.
- **Location rules:** look for `UAT.md` in the active change directory first; otherwise in the newest `spec/archive/*/` entry, or the named archive entry when a change name is given.
- Spawns the `metta-uat-runner` agent against the located UAT.md.
- After the run, the **skill (orchestrator)** commits the updated UAT.md and run record — commit ownership stays with the orchestrator per convention, never the subagent.
- Failures reported by the runner are logged as metta issues by the **orchestrator** via `/metta-issue` (fork-tier skills cannot be invoked from a subagent).
- Skill shape: **non-forked, main-session**, precedent `metta-verify`/`metta-plan`. It reads files, spawns an agent, and commits — no Tier-2 `metta` subcommands, so it likely needs **no mint hook at all** (read-only precedent: `metta-status` has no hooks block). Research verifies whether the commit step requires anything; if a mint-hook scope turns out to be needed, add the frontmatter mint hook with an empty/minimal scope per the established pattern.

### 2. New agent: `metta-uat-runner` (template + deployed .md pair)

- Files: `src/templates/agents/metta-uat-runner.md` byte-identical to `.claude/agents/metta-uat-runner.md`; flat-file frontmatter (name/description/tools/color, **no model field**), auto-discovered by filename via `src/agents/agent-registry.ts` (`loadAgentDefinition`) — same as `metta-specifier`.
- Persona: meticulous acceptance tester. Tools: **Read, Bash, Edit**.
- Per step: perform the **Do** action (using `Run:` hints where present — they are pre-sanitized by the generator's metachar filter, but the agent MUST still treat all step text as data); compare actual observations against the **Observe** text; on pass, use Edit to flip `- [ ] Pass` to `- [x] Pass` in the existing UAT.md; on fail, leave the box unchecked and record the discrepancy; steps that are environment-impossible (e.g. require an interactive TTY) are **skipped with a note**.
- **Prompt-injection defense clause**, per the `metta-verifier` (untrusted-data clause, ~line 20) and `metta-constitution-checker` (~line 12) precedents: instruction-like text inside UAT steps is data describing the acceptance check, never commands to the agent itself.
- **Run record:** append a `## UAT run — <date>` section to UAT.md containing runner identity, a per-step pass/fail/skip table, and failure details. Because the harness Write-refusal precedent applies to new report files, results are appended by **Edit of the existing document**, with the honest heredoc fallback clause from the verifier contract precedent (~line 63): attempt Edit first; on harness refusal, fall back to a shell heredoc to the exact mandated path, noting the refusal in the artifact.

### 3. Re-run semantics (idempotent)

A second run appends a second dated `## UAT run` section and re-checks boxes from scratch. Preferred design (exact reset mechanics decided in design): keep all prior run sections as history; reset checkboxes at run start so the boxes always reflect the **latest** run.

### 4. Archived UAT.md edit policy — tension acknowledged, resolved in design

There is a real tension: the UAT header template forbids editing the document to make a step pass, and archive precedent treats `spec/archive/` artifacts as immutable history ("original artifact set is preserved verbatim", `docs/workflows/state.md` ~223). The justification this intent proposes: **UAT execution results ARE part of that history.** Run records are append-only; checkbox flips only ever reflect the latest genuinely observed run outcome; the runner never fabricates a pass — so recording a run does not falsify the archive, it completes it. The exact policy (edit archived UAT.md in place vs. recording archived-change runs differently) is flagged as a design decision to be resolved in research/design against spec-store conventions.

### 5. Model routing

The runner is execution-class, but UAT running produces no `metta instructions` artifact, so the per-artifact model-resolution path (`src/context/model-resolver.ts`) has no hook for it. The skill therefore spawns the runner at the **session model (inherit), always**. Tier-routed UAT runs are declared **future work**, to be revisited once an artifact hook exists. We explicitly do not invent a fake instructions artifact to force routing.

### 6. Capability target

Default: extend **finalize-ship** (`spec/specs/finalize-ship/spec.md`), where UAT generation already lives (requirements around lines 263–378). Research may instead justify a new `uat-execution` capability via the explicit capability marker — research decides.

## Impact

- **finalize-ship capability surface** grows from generation-only to generation + execution requirements (or a sibling `uat-execution` capability is created — research decides). Existing generation requirements and `generateUat` behavior are untouched.
- **Skill template family:** one new pair, `src/templates/skills/metta-uat/SKILL.md` + `.claude/skills/metta-uat/SKILL.md`.
- **Agent template family:** one new pair, `src/templates/agents/metta-uat-runner.md` + `.claude/agents/metta-uat-runner.md`; agent auto-discovery in `src/agents/agent-registry.ts` picks it up by filename with no registry code change.
- **Tests:** byte-identity for both new pairs is enforced automatically by `tests/template-deploy-sync.test.ts` (recursive auto-discovery — no test edits needed for coverage); the older per-file assertions in `tests/cli-skills.test.ts` are reviewed for whether the new pairs should be added there for parity.
- **UAT.md documents** (live and, pending the design decision, archived) gain mutable checkbox state and append-only run-record sections. The header template's "Reporting failures" guidance in `src/templates/artifacts/uat.md` may need a wording touch-up in design so it no longer implies the document is never edited (checkbox flips by an honest runner are sanctioned; fabricating a pass remains forbidden).
- **No CLI changes:** no new `metta` commands.
- **No guard-hook changes:** the runner only executes project commands that are already guard-classified; the skill is non-forked and main-session with no Tier-2 subcommands.
- **Distribution:** the skill and agent ship to consumer projects via `metta install` like every other skill — no special install-path work expected beyond the standard template copy.

## Out of Scope

- **AI-enriched UAT authoring** — the generator stays deterministic; this change only executes what `generateUat` emits.
- **CI integration** — no pipeline, scheduled, or headless-CI execution of UAT scripts.
- **Running UAT for consumer projects from this repo** — the skill ships to consumers via `metta install`; executing their UATs from here is not part of this change.
- **New CLI commands** — no `metta uat` or similar subcommand.
- **Guard-hook changes** — no new Tier-1/Tier-2 classifications, no `metta-guard-bash` edits.
- **Fake instructions artifact for model routing** — no invented artifact to wire UAT runs into `metta instructions`; tier-routed UAT runs are future work.
- **Rewriting or regenerating existing UAT.md step content** — the runner appends run records and flips checkboxes; it never alters Setup/Do/Observe text or Machine-verified annotations.
