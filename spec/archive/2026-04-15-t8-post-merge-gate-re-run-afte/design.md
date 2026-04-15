# Design: t8-post-merge-gate-re-run-afte

## Approach
Replace the unconditional `post-merge-gates: pass` stub at the end of `MergeSafetyPipeline.run()` with real gate execution. Pipeline accepts an optional injected `GateRegistry`. On any gate failure, roll back via `git reset --hard <snapshotTag>`. Pre-existing snapshot tag becomes load-bearing for both in-merge AND post-merge rollback.

## Components

### `src/ship/merge-safety.ts`
- Constructor: `constructor(private cwd: string, private gateRegistry?: GateRegistry)`.
- Replace stub at end of `run()`:
```ts
// Step 9: Post-merge gates (real execution)
if (!this.gateRegistry) {
  steps.push({ step: 'post-merge-gates', status: 'pass', detail: 'no gates configured' })
  return { status: 'success', steps, mergeCommit, snapshotTag }
}
const gateNames = this.gateRegistry.list().map(g => g.name)
if (gateNames.length === 0) {
  steps.push({ step: 'post-merge-gates', status: 'pass', detail: 'no gates configured' })
  return { status: 'success', steps, mergeCommit, snapshotTag }
}
const results = await this.gateRegistry.runAll(gateNames, this.cwd)
const failed = results.find(r => r.status === 'fail')
if (!failed) {
  steps.push({ step: 'post-merge-gates', status: 'pass', detail: `${results.length} gates passed` })
  return { status: 'success', steps, mergeCommit, snapshotTag }
}
// Failure path: roll back
steps.push({
  step: 'post-merge-gates',
  status: 'fail',
  detail: `${failed.gate} failed; rolled back to ${snapshotTag}`,
})
try {
  await this.git(`reset --hard ${snapshotTag}`)
  steps.push({ step: 'rollback', status: 'pass' })
} catch (err) {
  steps.push({
    step: 'rollback',
    status: 'fail',
    detail: 'rollback also failed — manual intervention required',
  })
}
return { status: 'failure', steps, snapshotTag }
```

### `src/cli/commands/ship.ts`
- Before constructing pipeline, call `await ctx.gateRegistry.loadFromDirectory(<gates dir>)`.
- Pass `ctx.gateRegistry` as second arg: `new MergeSafetyPipeline(ctx.projectRoot, ctx.gateRegistry)`.

### `tests/merge-safety.test.ts`
- 3 new cases per spec:
  1. All-pass mock registry → `success` status, working tree on merge commit.
  2. Failing gate mock → `failure` status, rollback step pass, HEAD == snapshot SHA.
  3. No registry → step pass with `no gates configured` detail, success.

## Risks
- Risk: `gateRegistry.list()` empty after load (no gates dir) → silent pass. Mitigation: explicit `no gates configured` detail makes it visible.
- Risk: rollback `git reset --hard` succeeds but working tree has stale build artifacts. Mitigation: out of scope; gates rerunning will catch.
- Risk: in real ship, gate run takes 3+ minutes → ship feels slow. Mitigation: accepted per discovery.

## Test Strategy
Mock GateRegistry with `runAll` returning canned results. No real gate execution.
