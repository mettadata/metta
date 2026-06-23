# Gates

Reference for metta's quality gates — what they check, where they fire, and how the engine interprets their results.

## Overview

A **gate** is a named check that produces a [`GateResult`](../../src/schemas/gate-result.ts): a record with a `gate` name, a `status` (`pass` | `fail` | `warn` | `skip`), a `duration_ms`, an optional `output` string, and an optional `failures[]` array of structured `{ file, line?, message, severity }` entries. Gates fire at two moments:

1. **During a stage** — when a workflow artifact declares a non-empty `gates:` list (e.g. the `implementation` stage declares `gates: [tests, lint, typecheck, build]`), those gates run after the artifact is authored and before the stage is marked `complete`.
2. **During `metta finalize`** — the workflow-scoped gate set (the union of every artifact's `gates:` list in the active workflow) is run before the change is archived and its specs are merged. Any gate `fail` blocks finalize.

Gate definitions are YAML files under `src/templates/gates/` (shell-command gates loaded by `GateRegistry`). Exactly five gates are registered: `tests`, `lint`, `typecheck`, `build`, and `stories-valid`. The workflow YAMLs reference gates by name; if a referenced name is not registered, the gate degrades to `status: skip` with the message `Gate '<name>' not configured` (see `GateRegistry.run` in [`src/gates/gate-registry.ts`](../../src/gates/gate-registry.ts)).

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

For the five YAML-defined gates, `GateRegistry.run` populates `failures[]` with a single synthetic entry on `fail` (see [`src/gates/gate-registry.ts`](../../src/gates/gate-registry.ts) lines 121–152): either a `Timeout` entry when the child process was killed by the `timeout` budget, or a single entry carrying `stderr || error.message`. Callers that want per-file structured failures would need a richer gate implementation; none exists today.

### Status semantics

| Status | Meaning | Finalize treatment |
|--------|---------|--------------------|
| `pass` | Command exited 0 | Non-blocking |
| `fail` | Command exited non-zero or timed out | **Blocks** — finalize aborts, no archive, no spec merge |
| `warn` | Reserved for code-driven gates that want to surface non-blocking issues | Non-blocking (treated as pass) |
| `skip` | Gate name not registered, or skipped because an earlier `stop` gate failed | Non-blocking |

`Finalizer` considers a run successful when `gates.every(g => g.status === 'pass' || g.status === 'skip' || g.status === 'warn')` ([`finalizer.ts`](../../src/finalize/finalizer.ts) line 71). `metta verify` also accepts `pass`, `skip`, and `warn` ([`verify.ts`](../../src/cli/commands/verify.ts) line 32), but it surfaces every `warn` to stderr and reports "All gates passed (with warnings)" — whereas finalize treats `warn` silently as a pass. No YAML gate emits `warn` directly; a gate only becomes `warn` when its `on_failure` policy is `continue_with_warning`, which no built-in gate declares. So the asymmetry is latent today.

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

`GateRegistry.loadFromDirectory` walks the directory, parses every `*.yaml` / `*.yml` with Zod, and registers each gate under its `name`. The runner consults `on_failure` in `runWithPolicy`: `retry_once` re-runs the command once on `fail`; `continue_with_warning` converts a `fail` into a `warn`; `stop` leaves the `fail` as-is and, inside `runAll`, short-circuits the rest of the gate list (every subsequent gate is marked `skip` with `Skipped due to earlier fail of <name>`).

### `on_failure` policy

Declared by each YAML gate; interpreted by [`GateRegistry.runWithPolicy`](../../src/gates/gate-registry.ts) (lines 195–211):

| Policy | Declared by | Runtime behaviour |
|--------|-------------|-------------------|
| `retry_once` | `lint`, `typecheck` | On `fail`, run the command once more; return the retry result |
| `stop` | `tests`, `build`, `stories-valid` | Fail-fast — no retry. The `fail` is returned as-is, and inside `runAll` it short-circuits the rest of the gate list (every later gate is marked `skip`) |
| `continue_with_warning` | none currently | Converts a `fail` into a `warn`; parsed but declared by no built-in gate |

`Finalizer.finalize` calls `runAll` ([`finalizer.ts`](../../src/finalize/finalizer.ts) line 70), and `runAll` runs each gate through `runWithPolicy`. So the `on_failure` policy **is** honoured at finalize time: `retry_once` gates get one automatic retry on `fail`, and a `stop` gate's failure skips the remaining gates in the run. The same `runWithPolicy` path is used during `/metta-execute` via `runWithRetry` (a thin alias for `runWithPolicy`).

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
**When it fires:** `implementation` stage of the `trivial`, `quick`, and `standard` workflows (each declares `gates: [tests, lint, typecheck, build]`). The `full` workflow's `implementation` stage omits `build`. `build` therefore also runs during `metta finalize` for `trivial`/`quick`/`standard` (those workflows' gate union includes it) and always runs under `metta verify` (registry-wide sweep).
**Pass criterion:** exit code 0 from `npm run build`.
**Fail output shape:** `output` carries `stdout || stderr || error.message`; `failures[]` carries a single synthetic entry. Timeout budget is 120 s; `on_failure: stop`.

### `lint`

**Defined in:** [`src/templates/gates/lint.yaml`](../../src/templates/gates/lint.yaml)
**What it runs:** `npm run lint`
**When it fires:** `implementation` stage of every workflow (`trivial`, `quick`, `standard`, `full`); also during `metta finalize` (in the workflow gate union) and `metta verify` (registry-wide sweep).
**Pass criterion:** exit code 0 from `npm run lint`.
**Fail output shape:** `output` + one synthetic `failures[]` entry. Timeout 30 s; `on_failure: retry_once` — `GateRegistry.runWithRetry` re-executes the command once before reporting `fail`.

### `stories-valid`

**Defined in:** [`src/templates/gates/stories-valid.yaml`](../../src/templates/gates/stories-valid.yaml)
**What it runs:** `metta validate-stories` — implemented at [`src/cli/commands/validate-stories.ts`](../../src/cli/commands/validate-stories.ts). It parses `spec/changes/<change>/stories.md`, validates schema, cross-checks `Fulfills:` refs in `spec.md` against story IDs, and detects mtime drift between `stories.md` and `spec.md`.
**When it fires:** `spec` stage of the `standard` workflow (`gates: [stories-valid]`). Not declared by `trivial`/`quick` (no stories stage) or `full` (whose `spec` stage declares no gates). It therefore runs during `metta finalize` only for the `standard` workflow (its gate union is the only one that includes `stories-valid`), and always under `metta verify` (registry-wide sweep). When invoked post-archive with no active change, the command exits 0 with the message `validate-stories: no active changes to validate`.
**Pass criterion:** exit code 0 — no schema errors and every `Fulfills:` ref resolves to an existing story ID. Drift between `stories.md` and `spec.md` emits a warning but does not fail.
**Fail output shape:** exit code 4 on parse error, missing `stories.md`, or unresolved refs. `GateRegistry` wraps the non-zero exit into a standard `fail` result with one synthetic entry in `failures[]`. The underlying JSON output from `metta validate-stories --json` has richer per-story detail (`errors[]`, `warnings[]`, `drift_warning`) but the gate runner currently captures it only as `output` text.

### `tests`

**Defined in:** [`src/templates/gates/tests.yaml`](../../src/templates/gates/tests.yaml)
**What it runs:** `npm test`
**When it fires:** `implementation` stage of every workflow (`trivial`, `quick`, `standard`, `full`); also during `metta finalize` (workflow gate union) and `metta verify`.
**Pass criterion:** exit code 0 from `npm test`.
**Fail output shape:** `output` + one synthetic `failures[]` entry. Timeout 300 s (the longest of the five); `on_failure: stop` — no retry, and a failure short-circuits the rest of the gate run inside `runAll`.

### `typecheck`

**Defined in:** [`src/templates/gates/typecheck.yaml`](../../src/templates/gates/typecheck.yaml)
**What it runs:** `npx tsc --noEmit`
**When it fires:** `implementation` stage of every workflow (`trivial`, `quick`, `standard`, `full`); also during `metta finalize` (workflow gate union) and `metta verify`.
**Pass criterion:** exit code 0 from `tsc --noEmit`.
**Fail output shape:** `output` + one synthetic `failures[]` entry. Timeout 60 s; `on_failure: retry_once`.

## Gate names described in older docs but not implemented

Earlier drafts of this doc and some design notes referred to four additional gate names — `spec-quality`, `design-review`, `task-quality`, and `uat` — wired into the `spec`, `design`, `tasks`, and `verification` stages. **None of these is implemented.** They appear in **zero** source files: no YAML under `src/templates/gates/`, no registry code, and no workflow YAML references them. The four built-in workflows (`trivial`, `quick`, `standard`, `full`) declare gates on their `implementation` stage (and, for `standard`, its `spec` stage); every other stage declares `gates: []`.

If one of these names were ever referenced by a workflow, `GateRegistry.run(name, cwd)` would fall through to the `gate: undefined` branch and return:

```ts
{ gate: name, status: 'skip', duration_ms: 0, output: "Gate '<name>' not configured" }
```

Verification rigor today comes not from a `uat` gate but from the verifier subagent spawned by `/metta-verify` (see [`src/templates/agents/metta-verifier.md`](../../src/templates/agents/metta-verifier.md)), which authors `summary.md` and confirms the YAML gate results. That subagent is not a `GateRegistry` entry and does not appear in `FinalizeResult.gates`.

## Stages → gates matrix

Every stage across the four built-in workflows and the gates it fires. All listed gates are the five registered YAML gates; every unlisted stage declares `gates: []`.

| Workflow | Stage | `gates:` list |
|----------|-------|---------------|
| trivial | intent | — |
| trivial | implementation | tests, lint, typecheck, build |
| trivial | verification | — |
| quick | intent | — |
| quick | implementation | tests, lint, typecheck, build |
| quick | verification | — |
| standard | intent | — |
| standard | stories | — |
| standard | spec | stories-valid |
| standard | research | — |
| standard | design | — |
| standard | tasks | — |
| standard | implementation | tests, lint, typecheck, build |
| standard | verification | — |
| full | domain-research | — |
| full | intent | — |
| full | spec | — |
| full | research | — |
| full | design | — |
| full | architecture | — |
| full | tasks | — |
| full | ux-spec | — |
| full | implementation | tests, lint, typecheck |
| full | verification | — |

Sources: [`src/templates/workflows/trivial.yaml`](../../src/templates/workflows/trivial.yaml), [`src/templates/workflows/quick.yaml`](../../src/templates/workflows/quick.yaml), [`src/templates/workflows/standard.yaml`](../../src/templates/workflows/standard.yaml), [`src/templates/workflows/full.yaml`](../../src/templates/workflows/full.yaml).

Note: `build` is referenced by the `implementation` stage of `trivial`, `quick`, and `standard`, but **not** `full`. So `metta finalize` runs `build` for the first three workflows (it is in their gate union) but not for `full`, while `metta verify` always runs `build` because it sweeps the whole registry.

## The finalize gate loop

Source: [`src/cli/commands/finalize.ts`](../../src/cli/commands/finalize.ts) and [`src/finalize/finalizer.ts`](../../src/finalize/finalizer.ts).

### Sequence

1. **Load builtin gates.** The command resolves `src/templates/gates/` relative to its module and calls `ctx.gateRegistry.loadFromDirectory(builtinGates)` ([`finalize.ts`](../../src/cli/commands/finalize.ts) lines 28–29). This registers all five YAML gates.
2. **Merge delta specs.** `Finalizer` first runs `SpecMerger.merge` to check for requirement-level conflicts between the change's spec delta and `spec/specs/`. If `specMerge.status === 'conflict'`, finalize exits with code 2 before any gate runs.
3. **Run the workflow-scoped gate set.** `Finalizer.finalize` is **workflow-scoped**: it loads the active change's workflow YAML and unions the `gates:` arrays declared across every artifact (`workflow.artifacts.flatMap(a => a.gates ?? [])`, deduplicated — see [`finalizer.ts`](../../src/finalize/finalizer.ts) lines 34–41). It then calls `runAll(gateNames, projectRoot)` with that scoped set ([`finalizer.ts`](../../src/finalize/finalizer.ts) lines 68–70). Gates execute **sequentially** via `runWithPolicy`, so `on_failure` (retry/stop) applies. Only if the workflow fails to load does it fall back to the full registry (`this.gateRegistry.list().map(g => g.name)`). For a `quick`/`trivial`/`standard` change the scoped set is `[tests, lint, typecheck, build]` (plus `stories-valid` for `standard`); for a `full` change it is `[tests, lint, typecheck]`.
4. **Evaluate pass/fail.** `gatesPassed` is true iff every result's status is `pass`, `skip`, or `warn`. A single `fail` flips it to false ([`finalizer.ts`](../../src/finalize/finalizer.ts) line 71).
5. **Block on failure.** If `!gatesPassed` and we are not in `--dry-run`, `Finalizer.finalize` returns early with `archiveName: ''`, `docsGenerated: []`, `refreshed: false`. The change is not archived and specs are not merged.
6. **Report failure.** [`finalize.ts`](../../src/cli/commands/finalize.ts) lines 42–80 handle the failure path:
   - In `--json` mode, emits `{ status: 'gates_failed', change, gates, message }` and exits 1.
   - In human mode, prints `Quality gates failed:`, then one line per gate with a pass/skip/fail icon and duration. For each failing gate it prints the gate name in red, followed by structured `failures[]` entries (`file:line — message`) when present, or the raw `output` text otherwise. This structured-failures rendering came from the `finalize-surfaces-failing-gate` change and replaces the older "opaque gate names with no error detail" behaviour.
7. **On success, archive + write `gates.yaml`.** After all gates pass, `Finalizer` archives the change directory, then writes `spec/archive/<archive-name>/gates.yaml` capturing `finalized_at`, `all_passed`, and one record per gate (`gate`, `status`, `duration_ms`) — see [`finalizer.ts`](../../src/finalize/finalizer.ts) lines 104–117. This is the permanent audit trail for the gate run.
8. **Generate docs, commit archive.** If `.metta/config` declares `docs.generate_on: finalize`, `DocGenerator.generate()` runs. Finally the command stages `spec/archive/<archive-name>`, `spec/changes/<name>`, and any merged `spec/specs/<cap>` paths, and commits with message `chore(<name>): archive and finalize` — scoped to avoid sweeping unrelated untracked files into the archive commit.

### Archive record: `gates.yaml`

On success, `Finalizer` writes one `gates.yaml` per archived change under `spec/archive/<archive-name>/gates.yaml`. Shape (from [`finalizer.ts`](../../src/finalize/finalizer.ts) lines 104–117). The records reflect the workflow-scoped gate set — this example is from a `quick`/`trivial` change (`[tests, lint, typecheck, build]`); a `standard` change would additionally include `stories-valid`, and a `full` change would omit `build`:

```yaml
finalized_at: 2026-04-17T14:32:11.012Z
all_passed: true
results:
  - gate: tests
    status: pass
    duration_ms: 42117
  - gate: lint
    status: pass
    duration_ms: 1852
  - gate: typecheck
    status: pass
    duration_ms: 6221
  - gate: build
    status: pass
    duration_ms: 14230
```

Only `gate`, `status`, and `duration_ms` are persisted — `output` and `failures[]` are dropped because by the time this record is written the change has already passed its gates. The file is committed alongside the archive with message `chore(<change-name>): archive and finalize`. This is the permanent gate audit trail; `spec/changes/<change>/` is removed when the change is archived.

### `metta verify` vs `metta finalize`

The two commands choose their gate set differently:

- [`metta verify`](../../src/cli/commands/verify.ts) is a **registry-wide sweep**: it loads `src/templates/gates/` and runs `runAll` over `ctx.gateRegistry.list().map(g => g.name)` — all five gates, regardless of the active change's workflow ([`verify.ts`](../../src/cli/commands/verify.ts) lines 24–26). It does not archive, does not merge specs, and does not write `gates.yaml`. It exits 1 if any gate fails.
- [`metta finalize`](../../src/finalize/finalizer.ts) is **workflow-scoped**: it runs only the union of gates declared by the active workflow's artifacts (see "The finalize gate loop" above), falling back to the full registry only if the workflow YAML fails to load.

Because `verify` sweeps the whole registry, it can run gates that `finalize` would skip for that workflow — e.g. `build` and `stories-valid` run under `verify` even for a `full` change, but `finalize` excludes them from a `full` change's scoped set. Treat `metta verify` as a broad pre-flight check; `metta finalize` is the narrower, workflow-accurate gate that actually blocks the archive.

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
