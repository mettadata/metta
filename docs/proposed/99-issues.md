# 99 — Design Review: Issues & Gaps

## Critical Issues

### 1. No error handling for AI provider failures

The docs describe provider plugins and role-based model selection (main/research/fallback), but there's no design for what happens when the AI provider itself fails mid-artifact. The execution engine covers task/batch failure, but the failure mode is always "gate failed" — never "the AI call returned garbage/timed out/hit rate limits." This is a real-world concern that will hit immediately.

### 2. Circular dependency between Context Engine and Agent System

The Context Engine needs agent budgets to determine how much to load (04-context-engine.md). The Agent System needs context to resolve which agent to use (05-agent-system.md). The architecture doc (02-architecture.md) draws them as peer layers, but the actual data flow has a chicken-and-egg problem. Which resolves first?

### 3. Who actually calls the AI?

The architecture has CLI, Workflow Engine, Context Engine, Agent System, Execution Engine — but none of them are described as making the actual LLM call. The data flow in 02-architecture.md shows "AI Tool executes instructions" as an external step. For `metta quick` and `metta auto`, the framework needs to drive the AI, not just hand off instructions. The Provider interface exists in 08-plugins.md but nothing in the architecture shows how it connects to the engines.

### 4. `metta documentation` vs `docs generate` confusion

There's a naming collision. `metta documentation` is a workflow step (archive + merge specs + generate docs + refresh). `metta docs generate` is a standalone command that generates docs. The `docs.generate_on` config value is `documentation` in some places (09-cli-integration.md) and `ship` in others. This will confuse users.

---

## Design Gaps

### 5. No multi-change coordination

The spec model handles parallel changes via content-hash versioning, but there's no way to see what other changes are in-flight that might conflict. You only find out at `metta ship` time. A `metta changes list` command exists but there's no pre-flight "will this conflict?" check at `metta propose` time.

### 6. Token counting is handwaved

The Context Engine is the crown jewel of the design, but how tokens are actually counted is never specified. Different models tokenize differently. The budgets in 04-context-engine.md are hardcoded numbers (20K, 40K, 80K) — are these model-specific? Who provides the tokenizer? This is a core dependency that needs a design decision.

### 7. No team/collaboration model

The docs mention "scalable for teams" (README) but there's no design for multi-user scenarios. Who owns a change? What happens when two people run `metta propose` at the same time? Lock files use optimistic locking, but there's no mechanism for communicating between developers. The state is all local files — is `.metta/state.yaml` committed?

### 8. No rollback/undo story beyond git

Post-merge gate failure triggers `git reset --hard` (07-execution-engine.md). But what about state files? If main rolls back but `.metta/state.yaml` still says the task is complete, state and git are desynchronized. The state store needs rollback coordination with git.

### 9. Spec-compliance gate is undefined

Listed as a built-in gate (07-execution-engine.md) but never explained. How does it work? It can't be a shell command like `npm test`. Does it call the AI to verify? If so, it depends on the provider system, which makes it fundamentally different from other gates. This deserves its own section.

---

## Inconsistencies

### 10. Quick workflow artifact count varies

- README says Quick is "2 artifacts": `intent -> execution`
- 01-philosophy.md says Quick is: `intent -> spec -> execute -> verify` (4 artifacts)
- 03-workflow-engine.md says Quick is "2 artifacts": `intent -> execution`

Pick one. The philosophy doc contradicts the others.

### 11. Workflow definition for "full" varies

- README says 10 artifacts
- 03-workflow-engine.md shows 6 nodes in the full DAG
- 01-philosophy.md shows 9 phases in the full path

The full workflow needs one canonical definition.

### 12. `generate_on` default is inconsistent

- 09-cli-integration.md line 449 says `generate_on: documentation`
- 09-cli-integration.md line 467 says default is `ship`
- 09-cli-integration.md line 735 says `generate_on: documentation`

### 13. Spec path inconsistency

- 00-quickstart-usage.md says `spec/project.md` is created by init
- 09-cli-integration.md shows `spec.output: ./spec` as configurable
- But agent YAML examples in 05-agent-system.md never reference the configurable path

If the spec dir is configurable, all references need to use a variable, not hardcode `spec/`.

---

## Minor Issues

### 14. Missing `metta build` command

Referenced in 03-workflow-engine.md (`metta build design` for partial execution) but never appears in the CLI reference in 09-cli-integration.md.

### 15. No versioning/migration story for Metta itself

ADR-004 mentions schema migrations, but there's no design for what happens when a user updates Metta and the schema changes. `metta update` exists in the CLI but has no doc.

### 16. The `metta gate` subcommand is referenced but not defined

07-execution-engine.md references `metta gate schema-drift` as a command, but `metta gate` doesn't appear in the CLI reference.

### 17. Worktree cleanup on crash

The merge safety section describes clean worktree lifecycle, but if the process crashes mid-execution, orphaned worktrees accumulate. `metta doctor` presumably handles this, but it's not specified.

---

## Strengths Worth Noting

- The merge safety pipeline is thorough and clearly learned from real pain
- The brownfield adoption story is the best part of the design — the 4-level incremental approach is genuinely practical
- Spec deltas with content-hash conflict detection is well thought out
- The "CLI as bridge" pattern for slash commands is the right call — single source of truth

---

## Key Architectural Question

The biggest question to resolve is #3: who calls the AI? The current design reads as if Metta is purely a CLI that generates instructions for external AI tools to follow. But `metta auto` implies an autonomous loop that must drive the AI itself. These are fundamentally different architectures and the docs don't commit to which one Metta is.
