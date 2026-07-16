# Verification: consolidate-ai-orchestration-layer-single-source-truth-v0-2

Verified 2026-07-16 against `spec.md` (6 ADDED requirements, `instruction-contracts` capability)
plus US-3/US-4 acceptance criteria per the spec's scope note. All checks were exercised live
against the built CLI (`node dist/cli/index.js`) in throwaway fixture projects, plus static
sweeps and the full gate run. Fixtures were deleted after verification.

## Requirement verdicts

### R1 — Persona Text Is Derived At Runtime From The Agent Definition — PASS

- **Live (fixture project, standard workflow):** `metta --json instructions research` emitted
  `agent.persona = "You are a technical researcher focused on evaluating implementation
  approaches."` — exactly the body-before-first-heading of
  `src/templates/agents/metta-researcher.md:9` with the documented bold-stripping (`**technical
  researcher**` → `technical researcher`).
- **Live edit scenario:** edited the persona sentence in the deployed template asset
  (`dist/templates/agents/metta-researcher.md`, i.e. the re-copied build asset — zero TypeScript
  changes) to a sentinel sentence; re-ran `instructions research` → output contained the sentinel
  and no longer contained the original sentence. Restored via `npm run build` (copy-templates);
  `diff` vs source confirmed restoration.
- **No literals scenario:** `grep -rn "BUILTIN_AGENTS\|agentTypeMap" src/` → zero matches.
  `grep -rn "You are a|You are an" src/**/*.ts` → the only hit is
  `src/cli/commands/discovery-helpers.ts:93`, which is the `metta init` discovery interviewer —
  explicitly out of scope (research.md:15 excludes `metta-discovery` from the persona-bearing
  set; it is not part of the artifact-instruction generation path). The instructions path resolves
  personas solely via `loadAgentDefinition` (`src/agents/agent-registry.ts:66`, called from
  `src/cli/commands/instructions.ts:59`). The remaining literal in `instructions.ts:11`
  (`AGENT_CONTEXT_BUDGETS`) is loader budget tuning, not agent identity — no persona/tool/name data.
- **Tests:** `tests/instructions-agent-registry.test.ts:67` (persona/tools from file, not
  literals), `:106` (file edit changes resolved persona, no code change);
  `tests/agent-registry.test.ts` (parse + failure modes). `loadAgentDefinition` reads the file
  per invocation with no cache, so edits take effect on the next generation.

### R2 — Every Referenced Agent Name Resolves To An Existing Agent Definition — PASS

- **Live enumeration (shipped set):** collected every `agents:` entry across
  `src/templates/workflows/{quick,standard,full}.yaml` → {architect, executor, planner, product,
  proposer, researcher, specifier, verifier}; each has a backing
  `src/templates/agents/metta-<name>.md`. No unresolved references in the shipped workflow set.
- **Live detectability scenario:** ran the same enumeration against a workflow set containing a
  copy of standard.yaml edited to `agents: [phantom]` → check reported `phantom UNRESOLVED`
  while all 8 real names passed. The runtime path independently reports the same condition
  (see R3).
- **Note:** there is no dedicated automated test that enumerates workflow `agents:` entries
  against agent files (verified by search of `tests/`). The requirement's normative text ("MUST be
  possible to enumerate... and confirm") is satisfied — the check is mechanical and was executed
  both directions live — but an enumeration test would pin this against future workflow edits.
  Recorded as an observation, not a defect (runtime failure R3 plus byte-identity R6 tests provide
  overlapping protection).

### R3 — Agent Resolution Failure Fails Loudly, Never Silently Substitutes — PASS

- **Live:** fixture `.metta/workflows/standard.yaml` overriding the research artifact to
  `agents: [phantom]`; `metta --json instructions research` exited **4** with
  `{"error":{"code":4,"type":"instructions_error","message":"Could not resolve agent 'phantom'
  for artifact 'research': no valid agent definition file 'metta-phantom.md' was found"}}` —
  agent AND artifact named; no instructions contract, no substituted persona emitted.
- **Live happy path:** every resolvable agent exercised (researcher, specifier, executor) emitted
  its own definition's persona with no failure raised.
- **Code:** typed `AgentResolutionError` carrying `agentName` + `artifactId`
  (`src/agents/agent-registry.ts:16-27`); `instructions.ts:54-59` has no fallback branch — the
  error propagates to the exit-4 boundary.
- **Tests:** `tests/instructions-agent-registry.test.ts:129` (exit 4, names both),
  `tests/agent-registry.test.ts:42` (typed error fields).

### R4 — Agent Aliases Are Explicit And Resolve To The Real Agent's Identity — PASS

- The previously-phantom `specifier` was made a real agent rather than an alias:
  `src/templates/agents/metta-specifier.md` exists (template + `.claude/agents/` deployed copy,
  byte-identical) carrying the requirements-engineer persona. Agent short-name → file routing is
  the filename convention alone; no fallback table exists in `agent-registry.ts`.
- **Live:** `metta --json instructions spec` (standard workflow, `agents: [specifier]`) emitted
  `name: metta-specifier`, persona "You are a requirements engineer focused on completeness and
  testability.", `tools: [Read, Grep, Glob]`, `metta_agent: metta-specifier` — the real agent's
  own identity, not another agent's persona under an alias.
- The one remaining alias in the system is the workflow alias, declared explicitly and
  inspectably: `WORKFLOW_ALIASES = { trivial: 'quick' }` (`src/workflow/workflow-engine.ts:24`).
- **Undeclared-name scenario:** live phantom test (R3) shows an undeclared name is never treated
  as an implicit alias — the failure path applies.
- **Tests:** `tests/instructions-agent-registry.test.ts:162` (specifier end-to-end, not
  metta-proposer), `tests/workflow-engine.test.ts:240/:250` (alias resolves; unknown non-alias
  names still throw).

### R5 — Emitted Instructions Contract Carries Complete Agent Identity — PASS

- **Live:** `instructions research --json` agent object carried all three fields sourced from
  `metta-researcher.md`: `name: metta-researcher` (frontmatter `name:`), persona (body), and
  `tools: [Read, Write, Grep, Glob, Bash, WebSearch, WebFetch]` — exactly the frontmatter
  `tools:` array, including the spot-checked WebSearch/WebFetch that the old literal lacked.
- **Tool-change scenario:** tools are parsed from the same file read as the persona on every
  invocation (`agent-registry.ts:84-90`, no cache); the live persona-edit test (R1) proves the
  next-generation propagation mechanism for the file's content.
- **Tests:** `tests/instructions-agent-registry.test.ts:86` (frontmatter tools incl.
  WebSearch/WebFetch), `:67` (name/persona/tools + `metta_agent` from the same definition),
  `tests/agent-registry.test.ts:90` (tools array parse).

### R6 — Source And Deployed Agent Definitions Remain Byte-Identical — PASS

- **Live:** `diff -r src/templates/agents .claude/agents` → identical (all 12 files);
  `diff -r src/templates/skills .claude/skills` → identical (touched skills included).
- **Divergence detectability:** `tests/template-deploy-sync.test.ts` auto-discovers every file in
  the agents/skills/hooks/statusline families and asserts source ↔ deployed byte-equality plus
  no orphan deployed files — a one-sided edit fails the suite.

## US-3 — One workflow definition per distinct behavior — PASS

- `find` across the repo: **no `trivial.yaml` anywhere** (source, dist, or deployed).
- **Live end-to-end (fixture):** `metta propose "us3 downscale check" --json --auto` (no
  `--workflow` → standard) → authored an intent with a 1-file `## Impact` →
  `metta complete intent` printed "Auto-accepting recommendation: downscale to /metta-trivial
  (was standard, scored trivial)"; change metadata persisted `workflow: trivial`; subsequent
  `metta --json instructions implementation` loaded the graph through the alias
  (`WORKFLOW_ALIASES: trivial → quick.yaml`) and emitted the metta-executor contract. Artifact
  sequence matched quick's (intent → implementation → verification), i.e. today's trivial-tier
  behavior.
- Decision + rationale recorded in research.md/design.md (dedupe via alias, delete trivial.yaml).
- **Tests:** `tests/workflow-engine.test.ts:240` (alias), `:250` (unknown names still error).

## US-4 — Gate scaffolds match reality for non-JS stacks — PASS

- Research recorded the liveness finding (scaffolds reachable; the real bug was override
  loading), so the scaffolds were kept and the loading path fixed.
- **Live (Cargo.toml-only fixture):** `metta install --git-init` → "Detected stack: rust",
  scaffolded 4 gate YAMLs into `.metta/gates/`. Then, in that project:
  - `metta --json gate list` → build=`cargo build`, lint=`cargo clippy`, tests=`cargo test`,
    typecheck=`cargo check` (plus builtin stories-valid). No npm commands.
  - `metta verify --json` executed the cargo commands live (real cargo manifest errors on the
    stub crate, from `cargo build`/`cargo clippy` — not npm); after adding `src/lib.rs`,
    `metta --json gate run build` → `status: pass` via `cargo build`.
- **Single loading path:** `loadGatesWithOverrides` (`src/gates/gate-registry.ts:16`) is called
  from all six call sites — `verify.ts:25`, `finalize.ts:37`, `ship.ts:36`, `gate.ts:18/:38/:57`
  (gate run/list/show).
- **Tests:** `tests/cli-gate-overrides.test.ts`, `tests/gate-registry.test.ts`.

## Gates

| Gate | Command | Result |
|------|---------|--------|
| tests | `npx vitest run` | PASS — 1074/1074 tests, 82/82 files |
| typecheck | `npx tsc --noEmit` | PASS (exit 0) |
| lint | `npm run lint` (= `tsc --noEmit`) | PASS |
| build | `npm run build` | PASS (compile + copy-templates) |

## Observations (non-blocking)

1. No automated test enumerates workflow `agents:` entries against agent definition files
   (R2 scenario 1); the check was performed live and is covered indirectly by the runtime
   failure path and template-sync tests.
2. `metta verify` in a quick-workflow change runs the builtin `stories-valid` gate even when the
   workflow has no stories artifact (observed in the US-4 fixture). Pre-existing behavior,
   unrelated to this change's requirements.

## Overall verdict

**PASS** — all 6 instruction-contracts requirements verified with live evidence; US-3 and US-4
acceptance criteria verified end-to-end; all gates green; source/deployed template pairs
byte-identical; no defects found in scope.
