# Tasks: fix-gate-infrastructure-bundle

## Batch 1: Independent edits (all different files — parallel)

### Task 1.1: Add runWithPolicy + reshape runAll in gate-registry
- **Files:** `src/gates/gate-registry.ts`
- **Action:** Add `async runWithPolicy(name, cwd): Promise<GateResult>` implementing the three `on_failure` branches (`retry_once`, `continue_with_warning`, `stop`) per design.md. Reshape `runAll` to iterate via `runWithPolicy` and track a local `stoppedBy` string; when a `stop`-policy gate returns `fail`, set `stoppedBy = gateName`; subsequent gates become `{status: 'skip', output: 'Skipped due to earlier fail of <stoppedBy>'}`. Keep `runWithRetry` as a delegating alias (`return this.runWithPolicy(name, cwd)`).
- **Verify:** `npx tsc --noEmit` clean; `grep -c 'runWithPolicy' src/gates/gate-registry.ts` returns ≥ 3.
- **Done:** File compiles; `runWithPolicy` method exists; `runAll` uses it; `runWithRetry` is a one-line delegate.

### Task 1.2: Migrate execution-engine to runWithPolicy
- **Files:** `src/execution/execution-engine.ts`
- **Action:** On line ~355, replace `this.gateRegistry.runWithRetry(gate.name, cwd)` with `this.gateRegistry.runWithPolicy(gate.name, cwd)`. No other changes.
- **Verify:** `grep -n 'runWithPolicy\|runWithRetry' src/execution/execution-engine.ts` shows `runWithPolicy` at line ~355 and no lingering `runWithRetry` calls (imports aside).
- **Done:** Call site updated; file compiles.

### Task 1.3: Update verify.ts warn handling [x]
- **Files:** `src/cli/commands/verify.ts`
- **Action:** Expand the `gatesPassed` predicate to include `g.status === 'warn'`. Add a `for` loop over `warn` results that emits `process.stderr.write(\`⚠ ${g.gate}: ${g.output ?? 'warning'}\n\`)` per warn. Place the loop immediately before the `gatesPassed` computation or as a side effect of building it.
- **Verify:** `grep -c "'warn'" src/cli/commands/verify.ts` returns ≥ 2 (predicate + stderr loop).
- **Done:** File compiles; `warn` is in `gatesPassed` predicate; stderr surface emitted.

### Task 1.4: Strip unimpl gates from standard.yaml [x]
- **Files:** `src/templates/workflows/standard.yaml`
- **Action:** Find the three stages with `gates: [<name>]` where name ∈ `{spec-quality, design-review, task-quality}` and change each to `gates: []`. Preserve all other content verbatim.
- **Verify:** `grep -E 'spec-quality|design-review|task-quality|uat' src/templates/workflows/standard.yaml` returns no matches.
- **Done:** File parses as valid YAML; the four gate names do not appear.

### Task 1.5: Strip unimpl gates from full.yaml [x]
- **Files:** `src/templates/workflows/full.yaml`
- **Action:** Find the four stages with `gates:` referencing `spec-quality`, `design-review`, `task-quality`, or `uat` and change each to `gates: []`. Preserve all other content verbatim.
- **Verify:** `grep -E 'spec-quality|design-review|task-quality|uat' src/templates/workflows/full.yaml` returns no matches.
- **Done:** File parses as valid YAML; the four gate names do not appear.

---

## Batch 2: Tests (depends on Batch 1 — parallel within batch, different test files)

### Task 2.1: Expand gate-registry.test.ts
- **Files:** `tests/gate-registry.test.ts`
- **Action:** Add tests for each `on_failure` branch per design.md test plan: `retry_once` (retry on fail, skip retry on pass, fail on retry-fail), `continue_with_warning` (fail → warn, pass unchanged), `stop` (signals batch skip, result array stays full-length, subsequent gates get `skip` with reference to failing gate). Also assert `runWithRetry` delegates to `runWithPolicy`. Use mocked gate commands via test-fixture YAML gates that return controlled exit codes.
- **Verify:** `npx vitest run tests/gate-registry.test.ts` all tests pass; at least 1 test per `on_failure` value.
- **Done:** Test file green; covers all three branches.

### Task 2.2: Add verify warn-pass test
- **Files:** `tests/cli.test.ts` (existing — grep for `metta verify`) OR a new `tests/verify-warn.test.ts`
- **Action:** Add a test that runs `metta verify` against a change whose gate run includes a `warn` status; assert exit code 0 and that stderr contains the warn gate's name. Add a companion test for a `fail` status → non-zero exit.
- **Verify:** Tests pass; grep the test file for `'warn'` ≥ 1 occurrence.
- **Done:** Both warn-pass and fail-nonzero assertions land in a test file and pass.

---

## Batch 3: Full suite verification (sequential)

### Task 3.1: Type check
- **Files:** none (verification)
- **Action:** `npx tsc --noEmit`
- **Verify:** Exit 0, no output.
- **Done:** TypeScript clean.

### Task 3.2: Full test suite
- **Files:** none (verification)
- **Action:** `npm test`
- **Verify:** Exit 0, all tests pass.
- **Done:** 0 failures.

### Task 3.3: Build
- **Files:** none (verification)
- **Action:** `npm run build`
- **Verify:** Exit 0; `dist/gates/gate-registry.js` exists and contains `runWithPolicy`.
- **Done:** Build artifact up-to-date.
