# Gates

Reference for metta's quality gates — what they check, where they fire, and how the engine interprets their results.

## Overview

A **gate** is a named check that produces a [`GateResult`](../../src/schemas/gate-result.ts): a record with a `gate` name, a `status` (`pass` | `fail` | `warn` | `skip`), a `duration_ms`, an optional `output` string, and an optional `failures[]` array of structured `{ file, line?, message, severity }` entries. Gates fire at two moments:

1. **During a stage** — when a workflow artifact declares a non-empty `gates:` list (e.g. the `implementation` stage declares `gates: [tests, lint, typecheck]`), those gates run after the artifact is authored and before the stage is marked `complete`.
2. **During `metta finalize`** — the terminal gate set is run before the change is archived and its specs are merged. Any gate `fail` blocks finalize.

Gate definitions can be YAML files under `src/templates/gates/` (shell-command gates loaded by `GateRegistry`) or code-driven checks implemented elsewhere in the codebase (described below). The workflow YAMLs reference gates by name; the name must resolve to one of these two definitions or the gate degrades to `status: skip` with the message `Gate '<name>' not configured` (see `GateRegistry.run` in [`src/gates/gate-registry.ts`](../../src/gates/gate-registry.ts)).

## Gate result shape

Source: [`src/schemas/gate-result.ts`](../../src/schemas/gate-result.ts).

```ts
interface GateResult {
  gate: string                       // gate name
  status: 'pass' | 'fail' | 'warn' | 'skip'
  duration_ms: number
  output?: string                    // stdout/stderr from the command
  failures?: GateFailure[]           // structured failures (populated on fail)
}

interface GateFailure {
  file: string                       // file path, or '' if not applicable
  line?: number
  message: string
  severity: 'error' | 'warning'
}
```

For the five YAML-defined gates, `GateRegistry.run` populates `failures[]` with a single synthetic entry on `fail` (see [`src/gates/gate-registry.ts`](../../src/gates/gate-registry.ts) lines 71–93): either a `Timeout` entry when the child process was killed by the `timeout` budget, or a single entry carrying `error.stderr || error.message`. Callers that want per-file structured failures must implement a code-driven gate (see section 3).

### Status semantics

| Status | Meaning | Finalize treatment |
|--------|---------|--------------------|
| `pass` | Command exited 0 | Non-blocking |
| `fail` | Command exited non-zero or timed out | **Blocks** — finalize aborts, no archive, no spec merge |
| `warn` | Reserved for code-driven gates that want to surface non-blocking issues | Non-blocking (treated as pass) |
| `skip` | Gate name not registered, or registered but explicitly skipped | Non-blocking |

`Finalizer` considers a run successful when `gates.every(g => g.status === 'pass' || g.status === 'skip' || g.status === 'warn')` ([`finalizer.ts`](../../src/finalize/finalizer.ts) line 54). `metta verify` is stricter — it only accepts `pass` or `skip` ([`verify.ts`](../../src/cli/commands/verify.ts) line 28) and will exit 1 if a gate returns `warn`. This asymmetry means a `warn`-returning gate will pass `finalize` but fail `verify`. No current gate emits `warn`, so the asymmetry is latent.

## YAML-defined gates

All five live under `src/templates/gates/` and share the same [`GateDefinition`](../../src/schemas/gate-definition.ts) schema:

```yaml
name: <id>
description: <human-readable>
command: <shell command>
timeout: <milliseconds>        # default 120000
required: <bool>               # default true
on_failure: retry_once | stop | continue_with_warning   # default retry_once
```

`GateRegistry.loadFromDirectory` walks the directory, parses every `*.yaml` / `*.yml` with Zod, and registers each gate under its `name`. `runWithRetry` consults `on_failure` — currently only `retry_once` is honoured (one retry on `fail`); `stop` and `continue_with_warning` are parsed and stored but not acted on by `runWithRetry`.

### `on_failure` policy

Declared by each YAML gate; interpreted by [`GateRegistry.runWithRetry`](../../src/gates/gate-registry.ts) (lines 105–115):

| Policy | Declared by | Runtime behaviour |
|--------|-------------|-------------------|
| `retry_once` | `lint`, `tests`, `typecheck` | On `fail`, run the command once more; return the retry result |
| `stop` | `build`, `stories-valid` | Fail-fast — no retry. Documented intent is to halt the rest of the stage; current runtime returns a single `fail` result and does not short-circuit the outer `runAll` loop |
| `continue_with_warning` | none currently | Not honoured by `runWithRetry`; parsed and stored for future use |

`Finalizer.finalize` calls `runAll`, **not** `runWithRetry` ([`finalizer.ts`](../../src/finalize/finalizer.ts) line 53). This means the retry policy does not apply during `metta finalize` — a `fail` on the terminal gate pass is terminal, with no second attempt. `runWithRetry` **is** invoked during `/metta-execute`: [`ExecutionEngine.runTaskGatesInDir`](../../src/execution/execution-engine.ts) (line 355) iterates every required gate in the registry and calls `this.gateRegistry.runWithRetry(gate.name, cwd)` after each task batch. So `on_failure: retry_once` is honoured at implementation time (one automatic retry on `fail` during execution) but not at finalize time. `stop` and `continue_with_warning` remain parsed-but-not-honoured in either path.

### Project-level gate overrides

`.metta/config.yaml` accepts a `gates:` record mapping gate name to an override object (see [`GateConfigSchema`](../../src/schemas/project-config.ts) lines 11–16):

```yaml
gates:
  tests:
    command: npm run test:ci
    timeout: 600000
  lint:
    on_failure: stop
```

Override fields: `command`, `timeout`, `required`, `on_failure`. The config loader merges these with the built-in YAML gate definitions so projects can retarget a gate's command (e.g. monorepo test runners) without forking the gate file. Gate names that exist only in project config and not in `src/templates/gates/` register as new gates.

### `build`

**Defined in:** [`src/templates/gates/build.yaml`](../../src/templates/gates/build.yaml)
**What it runs:** `npm run build`
**When it fires:** not declared by any built-in workflow's `gates:` list, but loaded into the registry by `metta finalize` and `metta verify`. Because `Finalizer.finalize` currently iterates over every gate in the registry (`this.gateRegistry.list().map(g => g.name)` — see [`src/finalize/finalizer.ts`](../../src/finalize/finalizer.ts) line 51), `build` fires during `metta finalize` alongside the other four YAML gates.
**Pass criterion:** exit code 0 from `npm run build`.
**Fail output shape:** `output` carries `stdout || stderr || error.message`; `failures[]` carries a single synthetic entry. Timeout budget is 120 s; `on_failure: stop`.

### `lint`

**Defined in:** [`src/templates/gates/lint.yaml`](../../src/templates/gates/lint.yaml)
**What it runs:** `npm run lint`
**When it fires:** `implementation` stage of every workflow (`quick`, `standard`, `full`); also during `metta finalize` and `metta verify` (registry-wide sweep).
**Pass criterion:** exit code 0 from `npm run lint`.
**Fail output shape:** `output` + one synthetic `failures[]` entry. Timeout 30 s; `on_failure: retry_once` — `GateRegistry.runWithRetry` re-executes the command once before reporting `fail`.

### `stories-valid`

**Defined in:** [`src/templates/gates/stories-valid.yaml`](../../src/templates/gates/stories-valid.yaml)
**What it runs:** `metta validate-stories` — implemented at [`src/cli/commands/validate-stories.ts`](../../src/cli/commands/validate-stories.ts). It parses `spec/changes/<change>/stories.md`, validates schema, cross-checks `Fulfills:` refs in `spec.md` against story IDs, and detects mtime drift between `stories.md` and `spec.md`.
**When it fires:** `spec` stage of the `standard` workflow (`gates: [spec-quality, stories-valid]`). Not declared by `quick` (no stories stage) or `full` (stories folded into spec). Also runs during `metta finalize` and `metta verify` (registry sweep). When invoked post-archive with no active change, the command exits 0 with the message `validate-stories: no active changes to validate`.
**Pass criterion:** exit code 0 — no schema errors and every `Fulfills:` ref resolves to an existing story ID. Drift between `stories.md` and `spec.md` emits a warning but does not fail.
**Fail output shape:** exit code 4 on parse error, missing `stories.md`, or unresolved refs. `GateRegistry` wraps the non-zero exit into a standard `fail` result with one synthetic entry in `failures[]`. The underlying JSON output from `metta validate-stories --json` has richer per-story detail (`errors[]`, `warnings[]`, `drift_warning`) but the gate runner currently captures it only as `output` text.

### `tests`

**Defined in:** [`src/templates/gates/tests.yaml`](../../src/templates/gates/tests.yaml)
**What it runs:** `npm test`
**When it fires:** `implementation` stage of every workflow (`quick`, `standard`, `full`); also during `metta finalize` and `metta verify`.
**Pass criterion:** exit code 0 from `npm test`.
**Fail output shape:** `output` + one synthetic `failures[]` entry. Timeout 300 s (the longest of the five); `on_failure: retry_once`.

### `typecheck`

**Defined in:** [`src/templates/gates/typecheck.yaml`](../../src/templates/gates/typecheck.yaml)
**What it runs:** `npx tsc --noEmit`
**When it fires:** `implementation` stage of every workflow; also during `metta finalize` and `metta verify`.
**Pass criterion:** exit code 0 from `tsc --noEmit`.
**Fail output shape:** `output` + one synthetic `failures[]` entry. Timeout 60 s; `on_failure: retry_once`.

## Code-driven gates (not under `src/templates/gates/`)

The workflow YAMLs reference four gate names that are **not** defined as YAML files and have **no current implementation** in the registry. When `GateRegistry.run(name, cwd)` is asked to execute one of these, it falls through to the `gate: undefined` branch and returns:

```ts
{ gate: name, status: 'skip', duration_ms: 0, output: "Gate '<name>' not configured" }
```

This is a known gap — see below. The intent of each gate, inferred from workflow wiring and the change's [intent.md](../../spec/changes/create-comprehensive-internal/intent.md), is documented here so future implementations preserve the contract.

### `spec-quality`

**Referenced by:** `spec` stage in `standard` (`gates: [spec-quality, stories-valid]`) and `full` (`gates: [spec-quality]`).
**Intended check:** evaluate the authored `spec.md` for completeness and testability — every requirement has `Fulfills:`/`Validation:` metadata, every requirement ID resolves, every scenario follows Given/When/Then, no "TBD"/"TODO" placeholders.
**Implementation status:** **no implementation present.** `grep -r spec-quality src/` matches only the workflow YAMLs, tests, and this doc. The closest existing artifact-quality check is `metta check-constitution` ([`src/cli/commands/check-constitution.ts`](../../src/cli/commands/check-constitution.ts)), but that enforces Conventions/Off-Limits rules, not spec completeness. At runtime this gate returns `status: skip`, so the workflow advances without blocking.

### `design-review`

**Referenced by:** `design` stage in `standard` and `full`.
**Intended check:** architect-style review of the authored `design.md` — coherence with spec, explicit tradeoff analysis, ADRs where warranted, no dangling interface references.
**Implementation status:** **no implementation present.** No code in `src/gates/` or `src/cli/commands/` handles `design-review`. Returns `status: skip` at runtime.

### `task-quality`

**Referenced by:** `tasks` stage in `standard` and `full`.
**Intended check:** validate `tasks.md` — every task is atomic and commit-scoped, dependencies form a DAG, estimates present, each task maps to a spec requirement or design element.
**Implementation status:** **no implementation present.** Returns `status: skip` at runtime.

### `uat`

**Referenced by:** `verification` stage in **every** workflow (`quick`, `standard`, `full`).
**Intended check:** user-acceptance verification — confirm each Given/When/Then scenario in `spec.md` has a passing test citing evidence, and that `summary.md` accounts for every spec requirement. The [`metta-verifier`](../../src/templates/agents/metta-verifier.md) subagent persona is the human-in-the-loop analogue invoked by the `/metta-verify` skill.
**Implementation status:** **no programmatic gate implementation.** The `uat` gate name resolves to `skip` in the registry. Verification rigor today comes from the verifier subagent spawned by `/metta-verify`, which authors `summary.md` and confirms gate results — but that subagent is not a `GateRegistry` entry and therefore does not appear in `FinalizeResult.gates`.

## Stages → gates matrix

Every stage across the three built-in workflows and the gates it fires. Gates in **bold** are YAML-defined and execute; gates in *italic* are referenced but return `skip` (known gap).

| Workflow | Stage | `gates:` list |
|----------|-------|---------------|
| quick | intent | — |
| quick | implementation | **tests**, **lint**, **typecheck** |
| quick | verification | *uat* |
| standard | intent | — |
| standard | stories | — |
| standard | spec | *spec-quality*, **stories-valid** |
| standard | research | — |
| standard | design | *design-review* |
| standard | tasks | *task-quality* |
| standard | implementation | **tests**, **lint**, **typecheck** |
| standard | verification | *uat* |
| full | domain-research | — |
| full | intent | — |
| full | spec | *spec-quality* |
| full | research | — |
| full | design | *design-review* |
| full | architecture | — |
| full | tasks | *task-quality* |
| full | ux-spec | — |
| full | implementation | **tests**, **lint**, **typecheck** |
| full | verification | *uat* |

Sources: [`src/templates/workflows/quick.yaml`](../../src/templates/workflows/quick.yaml), [`src/templates/workflows/standard.yaml`](../../src/templates/workflows/standard.yaml), [`src/templates/workflows/full.yaml`](../../src/templates/workflows/full.yaml).

Note: the `build` gate is registered but not referenced by any stage's `gates:` list. It still runs during `metta finalize` because the finalize loop sweeps the entire gate registry.

## The finalize gate loop

Source: [`src/cli/commands/finalize.ts`](../../src/cli/commands/finalize.ts) and [`src/finalize/finalizer.ts`](../../src/finalize/finalizer.ts).

### Sequence

1. **Load builtin gates.** The command resolves `src/templates/gates/` relative to its module and calls `ctx.gateRegistry.loadFromDirectory(builtinGates)` ([`finalize.ts`](../../src/cli/commands/finalize.ts) lines 28–29). This registers all five YAML gates.
2. **Merge delta specs.** `Finalizer` first runs `SpecMerger.merge` to check for requirement-level conflicts between the change's spec delta and `spec/specs/`. If `specMerge.status === 'conflict'`, finalize exits with code 2 before any gate runs.
3. **Run all registered gates.** `Finalizer.finalize` reads `this.gateRegistry.list().map(g => g.name)` and calls `runAll(gateNames, projectRoot)` ([`finalizer.ts`](../../src/finalize/finalizer.ts) lines 51–53). Gates execute **sequentially** in registry-insertion order — no parallelism, no stage filtering. Every YAML gate runs, regardless of which stages declared it.
4. **Evaluate pass/fail.** `gatesPassed` is true iff every result's status is `pass`, `skip`, or `warn`. A single `fail` flips it to false ([`finalizer.ts`](../../src/finalize/finalizer.ts) line 54).
5. **Block on failure.** If `!gatesPassed` and we are not in `--dry-run`, `Finalizer.finalize` returns early with `archiveName: ''`, `docsGenerated: []`, `refreshed: false`. The change is not archived and specs are not merged.
6. **Report failure.** [`finalize.ts`](../../src/cli/commands/finalize.ts) lines 42–80 handle the failure path:
   - In `--json` mode, emits `{ status: 'gates_failed', change, gates, message }` and exits 1.
   - In human mode, prints `Quality gates failed:`, then one line per gate with a pass/skip/fail icon and duration. For each failing gate it prints the gate name in red, followed by structured `failures[]` entries (`file:line — message`) when present, or the raw `output` text otherwise. This structured-failures rendering came from the `finalize-surfaces-failing-gate` change and replaces the older "opaque gate names with no error detail" behaviour.
7. **On success, archive + write `gates.yaml`.** After all gates pass, `Finalizer` archives the change directory, then writes `spec/archive/<archive-name>/gates.yaml` capturing `finalized_at`, `all_passed`, and one record per gate (`gate`, `status`, `duration_ms`) — see [`finalizer.ts`](../../src/finalize/finalizer.ts) lines 87–100. This is the permanent audit trail for the gate run.
8. **Generate docs, commit archive.** If `.metta/config` declares `docs.generate_on: finalize`, `DocGenerator.generate()` runs. Finally the command stages `spec/archive/<archive-name>`, `spec/changes/<name>`, and any merged `spec/specs/<cap>` paths, and commits with message `chore(<name>): archive and finalize` — scoped to avoid sweeping unrelated untracked files into the archive commit.

### Archive record: `gates.yaml`

On success, `Finalizer` writes one `gates.yaml` per archived change under `spec/archive/<archive-name>/gates.yaml`. Shape (from [`finalizer.ts`](../../src/finalize/finalizer.ts) lines 87–100):

```yaml
finalized_at: 2026-04-17T14:32:11.012Z
all_passed: true
results:
  - gate: build
    status: pass
    duration_ms: 14230
  - gate: lint
    status: pass
    duration_ms: 1852
  - gate: stories-valid
    status: skip
    duration_ms: 0
  - gate: tests
    status: pass
    duration_ms: 42117
  - gate: typecheck
    status: pass
    duration_ms: 6221
```

Only `gate`, `status`, and `duration_ms` are persisted — `output` and `failures[]` are dropped because by the time this record is written the change has already passed its gates. The file is committed alongside the archive with message `chore(<change-name>): archive and finalize`. This is the permanent gate audit trail; `spec/changes/<change>/` is removed when the change is archived.

### `metta verify` vs `metta finalize`

[`metta verify`](../../src/cli/commands/verify.ts) performs the same registry-wide sweep (`runAll` over every gate name in the registry) but does not archive, does not merge specs, and does not write `gates.yaml`. It exits 1 if any gate fails. Treat `metta verify` as the pre-flight check for `metta finalize`.

### Exit codes

| Code | Condition |
|------|-----------|
| 0 | Finalize succeeded (or `--dry-run` preview succeeded) |
| 1 | One or more gates failed |
| 2 | Spec merge conflict |
| 4 | Unhandled error (missing change, invalid state, etc.) |

## Cross-links

- [`workflows.md`](workflows.md) — per-workflow stage DAGs and the `gates:` binding on each artifact.
- [`walkthroughs.md`](walkthroughs.md) — end-to-end finalize walkthrough showing a gate-failure loop (forthcoming; sibling doc referenced from [`README.md`](README.md)).
- [`../../src/gates/gate-registry.ts`](../../src/gates/gate-registry.ts) — gate loader and runner.
- [`../../src/schemas/gate-result.ts`](../../src/schemas/gate-result.ts) — the result shape consumed by `Finalizer` and `metta verify`.
- [`../../src/schemas/gate-definition.ts`](../../src/schemas/gate-definition.ts) — the YAML gate definition schema.
- [`../../src/finalize/finalizer.ts`](../../src/finalize/finalizer.ts) — the finalize orchestration that runs gates, archives, and merges.
- [`../../src/cli/commands/finalize.ts`](../../src/cli/commands/finalize.ts) — the CLI surface and failure-rendering logic.
