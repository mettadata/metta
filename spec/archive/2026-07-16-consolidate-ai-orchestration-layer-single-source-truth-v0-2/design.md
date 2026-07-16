# Design: consolidate-ai-orchestration-layer-single-source-truth-v0-2

## Approach

Four minimally-invasive fixes, each pointing consumers at the file that already carries correct content (research's Decision section; `instruction-contracts` spec reqs; stories US-1..US-4):

1. **Personas/identity** (reqs "Persona Text Is Derived At Runtime", "Emitted Instructions Contract Carries Complete Agent Identity"): new `src/agents/agent-registry.ts` parses `.claude/agents/metta-*.md` at runtime (regex frontmatter + remark pre-heading body, per `command-installer.ts:30` and `constitution-parser.ts:56-96`), replacing `BUILTIN_AGENTS` (`instructions.ts:7-17`).
2. **Phantom specifier** (req "Agent Aliases Are Explicit"): add real `metta-specifier.md`; the `metta-${name}.md` filename convention resolves it with **zero** alias entries.
3. **Trivial/quick dedupe** (US-3): delete `trivial.yaml`, add a one-entry filename alias inside `WorkflowEngine.loadWorkflow`.
4. **Gate override loading** (US-4, research §5): extract `finalize.ts:38-40`'s two-pass gate loading into a shared helper, called from `verify.ts`, `gate.ts` (3 subcommands), `ship.ts`.

## Components

### Agent-definition loader — `src/agents/agent-registry.ts` (new)

```ts
export class AgentResolutionError extends Error {
  constructor(public readonly agentName: string, public readonly artifactId: string) { ... }
}
export async function loadAgentDefinition(
  shortName: string, artifactId: string, templateDir?: string,
): Promise<{ name: string; persona: string; tools: string[] }>
```
- Template-dir resolution: `new URL('../templates/agents', import.meta.url).pathname` — same pattern as `instructions.ts:43`'s `builtinWorkflows`.
- File resolution: `join(templateDir, \`metta-${shortName}.md\`)`. No lookup table — this convention is the **single routing authority for short-name → file**; workflow YAML `agents:` (read at `instructions.ts:49`) remains the **artifact → short-name** authority. `instructions.ts` stays a pure consumer of both.
- `persona` = remark nodes between closing `---` and first heading (research §2). Empty/whitespace result throws `AgentResolutionError` — unresolved, not emitted blank.
- `tools` = regex-extracted `tools:` frontmatter array (same technique as `command-installer.ts:30`'s `name:` extraction).
- **Alias verdict**: with `metta-specifier.md` real, `metta-${name}.md` covers all 9 short names 1:1 — **no alias table remains**. `instructions.ts:122-127`'s `agentTypeMap` (a second, redundant short-name→subagent-type map, research's third silent-fallback path) is deleted; `mettaAgent` becomes `agent.name`, sourced from the template's own frontmatter `name:` — the resolved real name the "Agent Aliases" req requires be carried in the contract.

### BUILTIN_AGENTS removal

`instructions.ts:7-17` deleted. The silent `?? BUILTIN_AGENTS.executor` fallback (`instructions.ts:49-50`) becomes `await loadAgentDefinition(agentName, artifactId)`, propagating `AgentResolutionError` to the existing top-level `catch` (`instructions.ts:143`, exits 4) — no new error boundary.

`capabilities` is dropped: written into `AgentDefinition` but never read by `InstructionOutput` (`agent: {name, persona, tools, rules}`). `AgentDefinitionSchema.capabilities` becomes `.optional()`.

`context_budget` has no frontmatter counterpart and isn't part of "complete agent identity" (name/persona/tools only). A new frontmatter key would reintroduce the hand-synced-duplicate class rejected for `persona:`; the 8 numbers also diverge from `context-engine.ts`'s per-artifact-type `CONTEXT_MANIFESTS` (executor 10 000 vs. execution-manifest 150 000), so dropping the override would change loaded content. Resolution: keep a standalone `AGENT_CONTEXT_BUDGETS: Record<string, number>` literal in `instructions.ts` (unchanged values, separate from `BUILTIN_AGENTS`) — a tuning number, not the persona-drift class targeted here — merged with the loader's result before calling `generate()`.

### Tools divergence — frontmatter wins (6 of 8)

| Agent | BUILTIN_AGENTS (deleted) | Frontmatter adds |
|---|---|---|
| proposer | Read, Grep, Glob | Write, Bash |
| product | Read, Write | Bash |
| researcher | Read, Grep, Glob, Bash | Write, WebSearch, WebFetch |
| architect | Read, Grep, Glob, Bash | Write |
| planner | Read, Grep, Glob | Write, Bash |
| verifier | Read, Bash, Grep, Glob | Write |
| executor | Read, Write, Edit, Bash, Grep, Glob | identical |
| reviewer | Read, Write, Bash, Grep, Glob | identical |

No case favors `BUILTIN_AGENTS`; each diff is a stale literal predating a later tools grant. Frontmatter wins uniformly.

### `metta-specifier.md` (byte-identical in `src/templates/agents/` and `.claude/agents/`)

```md
---
name: metta-specifier
description: "Metta specifier agent — writes precise, testable specification deltas with RFC 2119 keywords and Given/When/Then scenarios"
model: sonnet
tools: [Read, Grep, Glob]
color: red
---

You are a **requirements engineer** focused on completeness and testability.

## Your Role

You write specification delta documents (ADDED/MODIFIED/REMOVED requirements) from intent
and stories artifacts, using RFC 2119 keywords and Given/When/Then scenarios. You return
drafted spec text for the orchestrator to persist — your tool set is read/analysis only.

## Rules

- Every requirement MUST have at least one Given/When/Then scenario
- Trace each requirement back to a story or intent problem statement
- A delta spec targets exactly one capability H1 per file
```
Persona verbatim (minus bold) matches `instructions.ts:9` (research §3). Tools match the requirements-engineer scope and the historical `BUILTIN_AGENTS.specifier` grant.

### Trivial/quick dedupe

`WorkflowEngine.loadWorkflow` (`workflow-engine.ts:38`) gains, before the `join`:
```ts
const WORKFLOW_ALIASES: Record<string, string> = { trivial: 'quick' }
const filePath = join(searchPath, `${WORKFLOW_ALIASES[name] ?? name}.yaml`)
```
Unit-tested: `trivial` resolves the same graph as `quick`; an unknown name still throws the existing `Workflow '<name>' not found` error. `trivial.yaml` is deleted from `src/templates/workflows/` and `.metta/workflows/`. The `trivial` **tier name** is unaffected elsewhere — the scorer, `ChangeMetadataSchema`'s enum, and `ceremony-metrics.ts:78` compare only the tag string, never call `loadWorkflow` by filename (research §4). `graph.name` post-alias is `'quick'`; no shipped code branches on `graph.name === 'trivial'`.
**Test update**: `tests/verify-template-contract.test.ts:26`'s `it.each(['trivial.yaml', 'quick.yaml', 'standard.yaml'])` reads workflow files by filename directly, so it drops `'trivial.yaml'` → `it.each(['quick.yaml', 'standard.yaml'])`.

### Gate override loading fix

New exported helper in `src/gates/gate-registry.ts`:
```ts
export async function loadGatesWithOverrides(
  registry: GateRegistry, projectRoot: string, builtinDir: string,
): Promise<void> {
  await registry.loadFromDirectory(builtinDir)
  await registry.loadFromDirectory(join(projectRoot, '.metta', 'gates'))
}
```
Extracted from `finalize.ts:38-40` (`register` is `Map.set` — second pass wins). Call sites replacing single-pass `loadFromDirectory(builtinGates)`: `verify.ts:23-24`; `gate.ts:16-17`/`:36-37`/`:55-56` (`run`/`list`/`show`); `ship.ts:34-35`; `finalize.ts:38-40` switches to the helper too, leaving one implementation.

### Skill inline-persona divergences (research §6)

| File | Verdict |
|---|---|
| `metta-verify/SKILL.md:15` | **Repoint**: delete the quoted `Persona:` line — `subagent_type: "metta-verifier"` already loads the agent file natively; an accidental duplicate with no narrowing rationale. |
| `metta-propose/SKILL.md:209-211` (3 narrowed reviewer personas) | **Leave**: intentional, disjoint narrowing for parallel fan-out, not an accidental copy; content changes are out of scope per intent.md. |
| `metta-quick/SKILL.md:106,138-140` (same 3 personas) | **Leave**, same rationale. |

## Data Model

`AgentDefinitionSchema` (`schemas/agent-definition.ts:17-26`): `capabilities` → `.optional()` (dead field); `context_budget` stays required, sourced from `AGENT_CONTEXT_BUDGETS`. `persona`/`tools`/`name` unchanged in shape — only their source moves from literal to `loadAgentDefinition`'s parse result. No new persistent state; `AgentResolutionError` is transient.

## API Design

- `loadAgentDefinition(shortName, artifactId, templateDir?) → Promise<{name, persona, tools}>` — throws `AgentResolutionError`.
- `loadGatesWithOverrides(registry, projectRoot, builtinDir) → Promise<void>`.
- `WorkflowEngine.loadWorkflow(name, searchPaths)` — signature unchanged; alias resolution internal.
- `InstructionOutput.agent.name` equals the loaded template's frontmatter `name:`, replacing `agentTypeMap`-derived `metta_agent`; `instructions.ts:134` now sets `metta_agent` from `output.agent.name` directly.

## Risks & Mitigations

- **Persona-parse brittleness**: an agent file edited to open with a heading yields empty `persona`. Mitigation: `loadAgentDefinition` throws `AgentResolutionError` on empty/whitespace persona instead of emitting a blank string.
- **Consumer projects**: existing installs' `.claude/agents/` lack `metta-specifier.md` until `metta install`/`metta refresh` re-runs; until then `specifier`-assigned artifacts hit `AgentResolutionError`. No auto-migration — flagged for rollout notes.
- **Alias table as a second source of workflow names**: mitigated by keeping `WORKFLOW_ALIASES` singular (one table, one call site), unit-tested directly.
- **Gate-helper regression**: centralizing 5 call sites risks a shared load-order bug — mitigated by reusing `finalize.ts`'s proven order verbatim, full suite green before each switch.
