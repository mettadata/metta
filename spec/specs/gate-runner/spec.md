# fix-gate-infrastructure-bundle

## Requirement: Gate execution MUST honor all three `on_failure` policies uniformly

`GateRegistry` MUST expose a method `runWithPolicy(name: string, cwd: string): Promise<GateResult>` that applies the gate's declared `on_failure` value:
Both `Finalizer.runAll` (via `GateRegistry.runAll`) and `ExecutionEngine.runTaskGatesInDir` MUST invoke `runWithPolicy` per gate. The existing `runWithRetry` method MAY remain as a thin alias that delegates to `runWithPolicy`.

### Scenario: retry_once retries on first fail
- GIVEN a gate with `on_failure: retry_once` whose command fails on its first invocation and passes on the second
- WHEN `GateRegistry.runWithPolicy(name, cwd)` is called
- THEN the returned `GateResult.status` is `pass`

### Scenario: retry_once does not retry on initial pass
- GIVEN a gate with `on_failure: retry_once` whose command passes on its first invocation
- WHEN `runWithPolicy` is called
- THEN the command is invoked exactly once and the result status is `pass`

### Scenario: continue_with_warning downgrades fail to warn
- GIVEN a gate with `on_failure: continue_with_warning` whose command fails
- WHEN `runWithPolicy` is called
- THEN the returned `GateResult.status` is `warn`
- AND `failures` and `output` from the failing invocation are preserved on the result

### Scenario: stop on fail causes remaining gates to be skipped
- GIVEN three gates A, B, C registered in order where A has `on_failure: stop` and fails
- WHEN `GateRegistry.runAll(['A', 'B', 'C'], cwd)` is called
- THEN the result array has length 3
- AND result[0].status is `fail`
- AND result[1].status is `skip` with `output` containing `Skipped due to earlier fail of A`
- AND result[2].status is `skip` with `output` containing `Skipped due to earlier fail of A`

### Scenario: stop does not affect gates earlier in the batch
- GIVEN two gates A (passes) and B (`on_failure: stop`, fails)
- WHEN `runAll(['A', 'B'], cwd)` is called
- THEN result[0].status is `pass` and result[1].status is `fail`


## Requirement: Gate `warn` status MUST be treated as pass across CLI commands

All CLI commands that evaluate gate results as pass/fail MUST consider `warn` to be a passing outcome (exit code 0). `warn` results MUST still be surfaced to the user — either in human-readable output or JSON — so the caveat is visible.
Specifically:

### Scenario: verify exits 0 when a gate returns warn
- GIVEN a change whose gate run includes a `warn` status and no `fail` status
- WHEN `metta verify` is invoked
- THEN the process exits with code 0
- AND the `warn` gate's message is written to stderr

### Scenario: verify exits non-zero when any gate returns fail
- GIVEN a change whose gate run includes a `fail` status
- WHEN `metta verify` is invoked
- THEN the process exits with a non-zero code

### Scenario: finalize accepts warn results
- GIVEN a gate returning `warn` during finalize
- WHEN `metta finalize` is invoked
- THEN finalize proceeds to archive and spec-merge
- AND the finalize output includes the `warn` gate's message


## Requirement: Workflow YAMLs MUST NOT reference unimplemented gates

The `spec-quality`, `design-review`, `task-quality`, and `uat` gate names MUST be removed from the `gates:` entries of every workflow YAML under `src/templates/workflows/`. Stage `gates:` lists MAY be empty (`[]`) when no gates apply.

### Scenario: standard.yaml does not reference unimplemented gates
- GIVEN `src/templates/workflows/standard.yaml` is parsed
- WHEN any stage's `gates:` entry is inspected
- THEN it does not contain `spec-quality`, `design-review`, `task-quality`, or `uat`

### Scenario: full.yaml does not reference unimplemented gates
- GIVEN `src/templates/workflows/full.yaml` is parsed
- WHEN any stage's `gates:` entry is inspected
- THEN it does not contain `spec-quality`, `design-review`, `task-quality`, or `uat`

### Scenario: quick.yaml does not reference unimplemented gates
- GIVEN `src/templates/workflows/quick.yaml` is parsed
- WHEN any stage's `gates:` entry is inspected
- THEN it does not contain `spec-quality`, `design-review`, `task-quality`, or `uat`


## Requirement: GateRegistry tests MUST cover each policy branch

Unit tests in `tests/gate-registry.test.ts` (or equivalent) MUST assert:

### Scenario: test suite asserts each on_failure branch
- GIVEN `npm test` is executed
- WHEN the gate-registry test file runs
- THEN every `on_failure` value (`retry_once`, `continue_with_warning`, `stop`) has at least one passing test asserting its behavior
