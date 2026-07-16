# Implementation Summary: consolidate-ai-orchestration-layer-single-source-truth-v0-2

## What changed

The orchestration layer now has one source of truth per concern: agent identity lives only in the agent definition files, workflow routing only in the YAML + one explicit alias table, and gate definitions load consistently across every command.

- **Agent registry** (`src/agents/agent-registry.ts`, new): `loadAgentDefinition` parses `{name, persona, tools}` from the agent template files at runtime (frontmatter + body-before-first-heading persona convention), Zod-validates via a co-located `AgentFrontmatterSchema`, and fails loudly with typed `AgentResolutionError` naming the missing agent and artifact — no silent executor fallback.
- **Shadow registry deleted** (`src/cli/commands/instructions.ts`): `BUILTIN_AGENTS` and `agentTypeMap` are gone; the emitted contract's persona/tools/`metta_agent` all derive from the resolved agent file. Frontmatter is authoritative for the 6-of-8 tools divergences.
- **Phantom specifier made real** (`metta-specifier.md`, template + deployed): the "requirements engineer" persona previously defined-then-discarded by the alias now exists as a real agent; workflow YAMLs' `agents: [specifier]` resolves to it end-to-end. (Confirmed live: the harness auto-discovered the new agent type during this change's own execution.)
- **Workflow dedupe** (`workflow-engine.ts`, `trivial.yaml` deleted): `WORKFLOW_ALIASES = {trivial: 'quick'}` in `loadWorkflow`; the trivial tier still routes end-to-end while the duplicate file is gone.
- **Gate overrides everywhere** (`gate-registry.ts` + 5 call sites): research disproved the review's "dead scaffolds" claim — a live Rust fixture install produces correct cargo gates. The real bug: only `finalize` loaded `.metta/gates/` overrides; `verify`, `gate run/list/show`, and `ship` ran npm builtins regardless. New shared `loadGatesWithOverrides` is now the single loading path for all six call sites.
- **Skill persona sync**: metta-verify's divergent inline persona line removed (both copies); the intentionally-narrowed reviewer personas in metta-propose/metta-quick left per design verdicts.

## Requirement coverage

All 6 requirements of the new `instruction-contracts` capability (US-1, US-2); US-3 via the workflow alias; US-4 via the gate-override fix — both covered by stories acceptance criteria + tests per the spec's scope note.

## Verification

Suite 1074/1074 (82 files, +20 new tests) green after every batch; tsc/build clean; sweep proofs: zero BUILTIN_AGENTS/agentTypeMap/inline-persona literals in src, all agent/skill template pairs byte-identical, no trivial.yaml anywhere.

## Commits

`76bd76bf4` (registry + specifier), `ca13841a6` (registry tests), `353f29bb2` (instructions rewiring), `4f7b9f278` (contract tests), `466db6617` (workflow dedupe), `ce06e5f32` (gate overrides), `298c2c096` (gate tests), `92346326c` (skill sync).

## Notes

- Review-claim corrected: gate scaffolds are live and correct; the fix landed in the loading path instead of deletion.
- schemas.test.ts capabilities-required case updated with the schema change (executor-logged deviation, atomic with 1.1).
- Consumer projects need `metta install` re-run to receive metta-specifier.md and the updated skills.
