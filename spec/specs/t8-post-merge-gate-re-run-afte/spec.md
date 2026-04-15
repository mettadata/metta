# t8-post-merge-gate-re-run-afte

## Requirement: post-merge-gate-execution

`MergeSafetyPipeline.run()` MUST replace its current unconditional `post-merge-gates: pass` stub with real gate execution against the merged working tree. The pipeline MUST accept an optional `GateRegistry` via constructor injection. When a registry is provided, the pipeline MUST invoke `gateRegistry.runAll(<gateNames>, this.cwd)` after the merge has landed and ancestry is verified. When no registry is provided, the pipeline MUST mark the step `pass` with detail `no gates configured` (backwards compatibility).

### Scenario: post-merge gates all pass
- GIVEN a `MergeSafetyPipeline` constructed with a `GateRegistry` that returns all-pass results
- WHEN `run(sourceBranch, targetBranch)` completes the merge step
- THEN `post-merge-gates` step status is `pass`, the pipeline returns `{status: 'success', steps, mergeCommit, snapshotTag}`, and the working tree HEAD is the merge commit

### Scenario: any post-merge gate fails → rollback
- GIVEN a `MergeSafetyPipeline` constructed with a `GateRegistry` that returns a `fail` result for one gate
- WHEN `run(sourceBranch, targetBranch)` reaches the post-merge-gates step
- THEN the step status is `fail` with detail naming the failing gate name and including the snapshot SHA, AND a follow-up `rollback` step status is `pass`, AND the working tree HEAD is reset to the snapshot tag, AND the pipeline returns `{status: 'failure', steps, snapshotTag}`

### Scenario: rollback failure surfaces clearly
- GIVEN post-merge gates fail AND the rollback `git reset --hard <snapshot>` itself errors
- WHEN the pipeline records the rollback failure
- THEN the `rollback` step status is `fail` with detail `rollback also failed — manual intervention required`, AND the pipeline returns `{status: 'failure', steps, snapshotTag}` without further git operations

### Scenario: no gate registry injected
- GIVEN a `MergeSafetyPipeline` constructed without a `GateRegistry` (backwards-compat path)
- WHEN `run(sourceBranch, targetBranch)` reaches the post-merge-gates step
- THEN the step status is `pass` with detail `no gates configured`, AND the pipeline returns success without attempting any gate runs


## Requirement: ship-cli-passes-gate-registry

`src/cli/commands/ship.ts` MUST construct `MergeSafetyPipeline` with the project's `GateRegistry` from `createCliContext()`, after that registry has been populated via `loadFromDirectory`.

### Scenario: ship passes the loaded registry
- GIVEN a project with gates configured under `.metta/gates/` or built-ins
- WHEN `metta ship --branch <branch>` is invoked
- THEN the pipeline receives a populated `GateRegistry` and the post-merge-gates step exercises the configured gates
