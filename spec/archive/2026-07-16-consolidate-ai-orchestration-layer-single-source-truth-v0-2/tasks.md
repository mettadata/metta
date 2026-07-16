# Tasks: consolidate-ai-orchestration-layer-single-source-truth-v0-2

<!--
Requirement -> Task mapping (spec.md, instruction-contracts capability):

- "Persona Text Is Derived At Runtime From The Agent Definition"      -> 1.1, 1.2, 2.1, 2.2
- "Every Referenced Agent Name Resolves To An Existing Agent Definition" -> 1.1, 1.2, 2.1, 2.2
- "Agent Resolution Failure Fails Loudly, Never Silently Substitutes" -> 1.1, 1.2, 2.1, 2.2
- "Agent Aliases Are Explicit And Resolve To The Real Agent's Identity" -> 1.1, 2.1, 2.2
- "Emitted Instructions Contract Carries Complete Agent Identity"     -> 1.1, 2.1, 2.2, 6.1
- "Source And Deployed Agent Definitions Remain Byte-Identical"       -> 1.1, 5.1, 6.1

User story -> Task mapping (stories.md):

- US-1 (personas come from one place)                 -> 1.1, 1.2, 2.1, 2.2, 5.1, 6.1
- US-2 (no phantom agents, no silent aliasing)         -> 1.1, 1.2, 2.1, 2.2
- US-3 (one workflow definition per distinct behavior) -> 3.1
- US-4 (gate scaffolds match reality for non-JS stacks) -> 4.1, 4.2
-->

## Batch 1: Agent registry core

### 1.1 [x] Agent-definition loader module + real specifier agent

**Files:**
- `src/agents/agent-registry.ts` (new)
- `src/agents/index.ts` (new — barrel: `export * from './agent-registry.js'`)
- `src/index.ts` (add `export * from './agents/index.js'` to the root barrel)
- `src/schemas/agent-definition.ts` (make `capabilities` `.optional()`)
- `src/templates/agents/metta-specifier.md` (new)
- `.claude/agents/metta-specifier.md` (new, byte-identical to the template copy)

**Action:**
Implement `agent-registry.ts` per design.md's "Agent-definition loader" section:
- `export class AgentResolutionError extends Error { constructor(public readonly agentName: string, public readonly artifactId: string) { ... } }` with a message naming both the agent and the artifact.
- `export async function loadAgentDefinition(shortName: string, artifactId: string, templateDir?: string): Promise<{ name: string; persona: string; tools: string[] }>`.
  - Default `templateDir` resolves via `new URL('../templates/agents', import.meta.url).pathname` (same pattern as `instructions.ts:43`'s `builtinWorkflows`).
  - File path: `join(templateDir, \`metta-${shortName}.md\`)`. No lookup table.
  - On missing file / read failure: throw `AgentResolutionError(shortName, artifactId)`.
  - `name` = regex-extracted `name:` frontmatter field (pattern from `command-installer.ts:30`).
  - `tools` = regex-extracted `tools:` frontmatter array (single-line array literal, e.g. `tools: [Read, Grep, Glob]`), parsed into `string[]`.
  - `persona` = remark-parsed (`remark-parse` + `unified`, per `constitution-parser.ts:56-96`) markdown content between the closing `---` and the first heading node, rendered to a plain-text string.
  - If the resulting `persona` is empty or whitespace-only after trimming, throw `AgentResolutionError(shortName, artifactId)` — never emit a blank persona (design.md Risks & Mitigations).
  - Before returning, validate the assembled object with a Zod parse (constitution-check finding): use `AgentDefinitionSchema` from `src/schemas/agent-definition.ts` if its shape fits the `{name, persona, tools}` result (or a dedicated `AgentFrontmatterSchema` subset co-located in that schema file if it doesn't), wrapping any ZodError in `AgentResolutionError` — mirrors the WorkflowEngine precedent of Zod-validating parsed template content.
- Create `src/templates/agents/metta-specifier.md` using the exact frontmatter/body given in design.md's "`metta-specifier.md`" section (name, description, `model: sonnet`, `tools: [Read, Grep, Glob]`, `color: red`, persona paragraph, `## Your Role`, `## Rules`).
- Copy it byte-for-byte to `.claude/agents/metta-specifier.md`.
- In `src/schemas/agent-definition.ts`, change `capabilities: z.array(z.string())` to `capabilities: z.array(z.string()).optional()`.

**Verify:**
```
npx tsc --noEmit
diff src/templates/agents/metta-specifier.md .claude/agents/metta-specifier.md
```
Both commands must exit 0.

**Done:** `agent-registry.ts` exports `AgentResolutionError` and `loadAgentDefinition` matching the design.md signature; `metta-specifier.md` exists as a byte-identical pair; `AgentDefinitionSchema.capabilities` is optional; project type-checks clean.

---

### 1.2 [x] Agent registry unit tests

**Files:**
- `tests/agent-registry.test.ts` (new)

**Action:**
Write unit tests for `loadAgentDefinition` covering:
- Each of the 9 real short names (`proposer`, `specifier`, `product`, `researcher`, `architect`, `planner`, `executor`, `verifier`, `reviewer`) resolves against the real `src/templates/agents/` directory (pass it explicitly as `templateDir`) to a `{name, persona, tools}` object whose `persona` is non-empty and whose `name` equals `metta-${shortName}`.
- `tools` for `metta-proposer` includes `Write` and `Bash` (frontmatter values, not the old `BUILTIN_AGENTS` literal) — proves frontmatter is the source, per design.md's tools-divergence table.
- An unknown short name (e.g. `'nonexistent'`) against the real template dir throws `AgentResolutionError`, and the thrown error's `.agentName` and `.artifactId` match the arguments passed in.
- A fixture agent file (write a temp `.md` file to a temp dir via `mkdtemp`) whose body opens directly with a `##` heading (no persona paragraph) throws `AgentResolutionError` for empty persona.
- A fixture agent file with a `tools:` frontmatter array is parsed into the expected `string[]`.

**Verify:**
```
npx vitest run tests/agent-registry.test.ts
```

**Done:** All new tests pass; coverage includes every real agent short name, the missing-agent path, and the empty-persona fixture edge case.

---

## Batch 2: Wire instructions command to the registry

### 2.1 [x] Delete BUILTIN_AGENTS and agentTypeMap, resolve via agent-registry

**Files:**
- `src/cli/commands/instructions.ts`

**Action:**
- Delete the `BUILTIN_AGENTS` record (`instructions.ts:7-17`) entirely.
- Delete the inline `agentTypeMap` record and its `?? 'metta-executor'` fallback (`instructions.ts:122-128`).
- Import `loadAgentDefinition`, `AgentResolutionError` from `../../agents/index.js`.
- Replace `const agent = BUILTIN_AGENTS[agentName] ?? BUILTIN_AGENTS.executor` with `const agent = await loadAgentDefinition(agentName, artifactId)` (no default `templateDir` argument — production call site uses the registry's own default resolution). Let `AgentResolutionError` propagate to the existing top-level `catch` (exit code 4) — no new error boundary.
- Keep `AGENT_CONTEXT_BUDGETS: Record<string, number>` as a standalone literal (unchanged values, carried over from the old `BUILTIN_AGENTS[*].context_budget` fields) in `instructions.ts`, merged into the object passed to `ctx.instructionGenerator.generate({ agent: { ...loaded, context_budget: AGENT_CONTEXT_BUDGETS[agentName] ?? <executor's prior default> }, ... })`.
- Replace `mettaAgent` (previously `agentTypeMap[agentName] ?? 'metta-executor'`) with `output.agent.name` directly (design.md API Design: "`instructions.ts:134` now sets `metta_agent` from `output.agent.name` directly"). Update the `agentBanner` call and the `outputJson({ ...output, metta_agent: mettaAgent })` call to use this value.
- `capabilities` is no longer read or constructed anywhere in this file.

**Verify:**
```
npx tsc --noEmit
grep -n "BUILTIN_AGENTS\|agentTypeMap" src/cli/commands/instructions.ts
```
The `grep` must produce no matches (exit 1).

**Done:** `instructions.ts` contains zero persona/tools/capabilities string literals for any agent; all agent identity is sourced from `loadAgentDefinition`; `metta_agent` in the emitted JSON equals the resolved agent's real frontmatter `name`.

---

### 2.2 [x] CLI-level proof: persona matches the agent file, unresolved agent fails loudly

**Files:**
- `tests/instructions-stamps-timings.test.ts` (existing — extend, or add adjacent `tests/instructions-agent-registry.test.ts` if a cleaner fixture setup is warranted)
- `tests/cli-complete.test.ts` (only if an existing assertion there hardcodes an old `BUILTIN_AGENTS` persona/tools string that must be updated to match frontmatter-sourced values)

**Action:**
Add/extend tests proving:
- Running `metta instructions <artifact-id> --change <name> --json` for an artifact whose workflow assigns a known agent (e.g. `executor` on the `implementation` artifact) emits `agent.persona` that is a substring match (after markdown-bold stripping) of the corresponding `src/templates/agents/metta-<agent>.md` body's opening paragraph, and `agent.tools` equal to that file's `tools:` frontmatter array — not the deleted `BUILTIN_AGENTS` literal values (assert on the previously-diverging tools, e.g. `researcher` includes `WebSearch`/`WebFetch`, per design.md's divergence table).
- Editing the on-disk agent `.md` file's persona sentence between two `metta instructions` invocations (within a temp project fixture pointed at a temp `templateDir`, or by monkey-patching the registry's `templateDir` default via a temp copy of `src/templates/agents/`) changes the emitted persona with no code change — satisfies the "Editing an agent definition file changes the emitted persona" scenario.
- A change whose active workflow YAML is a fixture with `agents: [nonexistent-agent]` on an artifact causes `metta instructions <that-artifact>` to exit with code `4` and a JSON `error.message` naming `nonexistent-agent` and the artifact id — proves `AgentResolutionError` propagates through the CLI boundary instead of falling back to executor.
- `agents: [specifier]` resolves successfully end-to-end (proves the phantom-agent fix — `metta-specifier.md` now exists) and the emitted `agent.name` is `metta-specifier`, not `metta-proposer`.

**Verify:**
```
npx vitest run tests/instructions-stamps-timings.test.ts tests/cli-complete.test.ts
npm run build && npm test
```

**Done:** Full suite green; CLI-level tests demonstrate frontmatter-sourced persona/tools, an unresolved agent name failing with exit 4 and a named error, and `specifier` resolving to a real `metta-specifier` agent end-to-end.

---

## Batch 3: Trivial/quick workflow dedupe

### 3.1 [x] Delete trivial.yaml, add WORKFLOW_ALIASES to loadWorkflow

**Files:**
- `src/workflow/workflow-engine.ts`
- `src/templates/workflows/trivial.yaml` (delete)
- `dist/templates/workflows/trivial.yaml` (delete — stale build artifact; `npm run build` regenerates `dist/` from `src/templates/` so this should self-clean, but delete explicitly if the build doesn't remove stale files)
- `tests/workflow-engine.test.ts`
- `tests/verify-template-contract.test.ts`

**Action:**
- In `workflow-engine.ts`, add a module-level `const WORKFLOW_ALIASES: Record<string, string> = { trivial: 'quick' }` above the `WorkflowEngine` class.
- In `loadWorkflow`, change `const filePath = join(searchPath, \`${name}.yaml\`)` to `const filePath = join(searchPath, \`${WORKFLOW_ALIASES[name] ?? name}.yaml\`)`.
- Delete `src/templates/workflows/trivial.yaml`.
- Confirm no other copy exists outside `src/templates/workflows/` and `dist/templates/workflows/` (there is no `.metta/workflows/trivial.yaml` deployed copy in this repo today — verify with `find . -iname trivial.yaml -not -path './node_modules/*'` before and after; it must show only the two paths above before this task and zero after `npm run build`).
- In `tests/workflow-engine.test.ts`, add a test in the `'workflow loading from YAML'` describe block: `engine.loadWorkflow('trivial', searchPaths)` against the real `src/templates/workflows` search path resolves a graph whose `buildOrder`/`artifacts` are identical to `engine.loadWorkflow('quick', searchPaths)` (assert on `graph.artifacts` deep-equality, ignoring `graph.name` which legitimately differs — `'quick'` vs. the alias target). Add a second test confirming an unrelated unknown name (e.g. `'bogus'`) still throws `Workflow 'bogus' not found` unchanged.
- In `tests/verify-template-contract.test.ts:26`, change `it.each(['trivial.yaml', 'quick.yaml', 'standard.yaml'])` to `it.each(['quick.yaml', 'standard.yaml'])`.

**Verify:**
```
find /home/utx0/Code/metta -iname "trivial.yaml" -not -path "*/node_modules/*"
npx vitest run tests/workflow-engine.test.ts tests/verify-template-contract.test.ts
npm run build && npm test
```
The `find` must print nothing after `npm run build` regenerates `dist/`.

**Done:** `trivial.yaml` no longer exists anywhere in `src/templates/` or `dist/templates/`; `loadWorkflow('trivial', ...)` resolves the same artifact graph as `loadWorkflow('quick', ...)`; full suite green, including the existing `complexity-tracking.test.ts`/`cli-complete.test.ts`/`ceremony-metrics.test.ts` assertions that compare `metadata.workflow === 'trivial'` as a tag string (unaffected — they never call `loadWorkflow('trivial', ...)` by filename).

---

## Batch 4: Gate override loading

### 4.1 [x] Extract loadGatesWithOverrides and wire the 5 call sites

**Files:**
- `src/gates/gate-registry.ts`
- `src/cli/commands/finalize.ts`
- `src/cli/commands/verify.ts`
- `src/cli/commands/gate.ts`
- `src/cli/commands/ship.ts`

**Action:**
- In `gate-registry.ts`, add:
```ts
export async function loadGatesWithOverrides(
  registry: GateRegistry, projectRoot: string, builtinDir: string,
): Promise<void> {
  await registry.loadFromDirectory(builtinDir)
  await registry.loadFromDirectory(join(projectRoot, '.metta', 'gates'))
}
```
  (import `join` from `node:path`, already imported in this file).
- `finalize.ts:38-40`: replace the two-line `loadFromDirectory(builtinGates)` + `loadFromDirectory(join(ctx.projectRoot, '.metta', 'gates'))` pair with `await loadGatesWithOverrides(ctx.gateRegistry, ctx.projectRoot, builtinGates)`, importing `loadGatesWithOverrides` from `../../gates/gate-registry.js`.
- `verify.ts:23-24`: replace the single-pass `loadFromDirectory(builtinGates)` with the same `loadGatesWithOverrides(ctx.gateRegistry, ctx.projectRoot, builtinGates)` call.
- `gate.ts`: apply the same replacement at all three call sites (`:16-17` `run`, `:36-37` `list`, `:55-56` `show`).
- `ship.ts:34-35`: same replacement.
- Each call site keeps its existing `builtinGates` computation (`new URL('../../templates/gates', import.meta.url).pathname`) unchanged — only the loading calls collapse to the helper.

**Verify:**
```
npx tsc --noEmit
grep -rn "loadFromDirectory" src/cli/commands/verify.ts src/cli/commands/gate.ts src/cli/commands/ship.ts src/cli/commands/finalize.ts
```
The `grep` must show zero remaining direct `loadFromDirectory` calls in those 4 command files (all replaced by `loadGatesWithOverrides`).

**Done:** One implementation of the two-pass gate load order exists in `gate-registry.ts`; `verify`, all three `gate` subcommands, `ship`, and `finalize` all call it; project type-checks clean.

---

### 4.2 [x] Tests: helper unit test + CLI-level non-JS override proof

**Files:**
- `tests/gate-registry.test.ts`
- `tests/cli-verify.test.ts` or an equivalent existing `verify`-command test file (extend), OR a new `tests/cli-gate-overrides.test.ts` if no suitable existing file loads a fixture project through `verify`/`gate run`

**Action:**
- In `tests/gate-registry.test.ts`, add a test for `loadGatesWithOverrides`: given a temp `builtinDir` with one gate YAML (`name: tests`, npm-style command) and a temp `projectRoot/.metta/gates/` with a same-named gate YAML overriding the command (e.g. `cargo test`), calling `loadGatesWithOverrides(registry, projectRoot, builtinDir)` results in `registry.get('tests').command` equal to the override command, not the builtin one — proves second-pass-wins load order, matching the existing `'project-local override precedence'` describe block's pattern (`gate-registry.test.ts:300-`).
- Add a CLI-level test: build a fixture project directory containing `.metta/gates/tests.yaml` with a non-npm command (e.g. `cargo test`) and the minimal `.metta/` scaffolding a `metta verify` (or `metta gate run tests`) invocation needs to resolve gates for an active change; assert the CLI's gate output reflects the overriding non-npm command was loaded (e.g. via `--json` gate listing, or by asserting the spawned command string if the test harness captures it) rather than the npm builtin. If `metta gate list --json` is the lowest-friction proof point (no process spawn required), prefer it over `gate run`/`verify` to keep the test fast and side-effect-free.

**Verify:**
```
npx vitest run tests/gate-registry.test.ts
npm run build && npm test
```

**Done:** `loadGatesWithOverrides` has a direct unit test proving override precedence; at least one CLI-level test proves a non-JS project's `.metta/gates/` override is honored by a command other than `finalize` (which already had this behavior); full suite green.

---

## Batch 5: Skill inline-persona sync

### 5.1 [x] Apply design.md's per-file skill verdicts

**Files:**
- `src/templates/skills/metta-verify/SKILL.md`
- `.claude/skills/metta-verify/SKILL.md`

**Action:**
Per design.md's "Skill inline-persona divergences" table:
- In both `metta-verify/SKILL.md` copies, delete the quoted `Persona: "You are a verification engineer focused on spec compliance."` line (currently line 15) — the `subagent_type: "metta-verifier"` spawn already loads the full agent file natively; this line is an accidental duplicate with no narrowing rationale, per the design's explicit verdict.
- Do NOT touch `metta-propose/SKILL.md:209-211` or `metta-quick/SKILL.md:106,138-140` — design.md's verdict for both is **Leave** (intentional, disjoint narrowing for parallel `metta-reviewer` fan-out spawns; content changes there are out of scope for this change).
- Apply the identical edit to both the `src/templates/skills/` copy and the `.claude/skills/` copy so they remain byte-identical.

**Verify:**
```
diff src/templates/skills/metta-verify/SKILL.md .claude/skills/metta-verify/SKILL.md
grep -n "You are a verification engineer focused on spec compliance" src/templates/skills/metta-verify/SKILL.md .claude/skills/metta-verify/SKILL.md
```
The `diff` must exit 0; the `grep` must produce no matches (exit 1).

**Done:** `metta-verify/SKILL.md`'s duplicate inline persona line is removed from both the template and deployed copy, which remain byte-identical; `metta-propose`/`metta-quick`'s intentionally-narrowed reviewer personas are left untouched.

---

## Batch 6: Full sweep and grep proof

### 6.1 [x] Repo-wide verification sweep

**Files:**
- None (verification-only batch; no source edits expected — if the sweep finds a residual literal or byte-mismatch, fix it in the owning file from the batch above rather than introducing a new file)

**Action:**
Run the full set of proof commands the spec's scenarios require, across the whole repo (not just the files touched in prior batches), and resolve any failure by correcting the relevant file from Batches 1-5:
1. No `BUILTIN_AGENTS` or `agentTypeMap` symbol remains anywhere in `src/`.
2. No hardcoded persona sentence for any of the 9 agents appears as a string literal in any `.ts` file under `src/` (spot-check each of the 9 known persona sentences from the old `BUILTIN_AGENTS` map).
3. Every `agents:` entry across every workflow YAML in `src/templates/workflows/` has a backing `src/templates/agents/metta-<name>.md` file (enumerate both sets and diff).
4. Every agent template file pair (`src/templates/agents/*.md` vs `.claude/agents/*.md`) is byte-identical.
5. Every skill file pair (`src/templates/skills/*/SKILL.md` vs `.claude/skills/*/SKILL.md`) is byte-identical.
6. `trivial.yaml` does not exist anywhere under `src/templates/` or `dist/templates/`.
7. `npm run build && npm test` is fully green.

**Verify:**
```
grep -rn "BUILTIN_AGENTS\|agentTypeMap" src/ || echo "CLEAN: no BUILTIN_AGENTS/agentTypeMap"
grep -rln "You are a product-minded engineer focused on clear problem definition\|You are a requirements engineer focused on completeness and testability\|You are a product-thinking engineer translating engineering intent into user stories\|You are a technical researcher focused on evaluating implementation approaches\|You are a senior systems architect focused on simplicity and maintainability\|You are a task planner focused on decomposition and dependency ordering\|You are an implementation engineer. Write clean, tested code\|You are a verification engineer focused on spec compliance\|You are a senior code reviewer focused on quality, security, and correctness" --include="*.ts" src/ || echo "CLEAN: no persona literals in .ts source"
diff -rq src/templates/agents .claude/agents
diff -rq src/templates/skills .claude/skills
find /home/utx0/Code/metta -iname "trivial.yaml" -not -path "*/node_modules/*"
npm run build && npm test
```
Both `grep` commands must print only their `CLEAN:` echo (no matches); both `diff -rq` commands must produce no output (exit 0); the `find` must print nothing; `npm test` must report all suites passing with zero failures.

**Done:** All seven checks pass with no residual literals, no byte-mismatches, no orphaned `trivial.yaml`, and a fully green suite — the change's "single source of truth" claim is grep-provable, not just believed.
