# Spec: fix-issue-metta-ship-merged-fi

## ADDED: Requirement: ship-finalize-check

`MergeSafetyPipeline.run()` in `src/ship/merge-safety.ts` MUST execute a
`finalize-check` step as the very first step — before the existing `preflight` step and
before any git operations.

The step MUST derive the change name by stripping the `metta/` prefix from
`sourceBranch`. Example: `metta/fix-issue-metta-ship-merged-fi` →
`fix-issue-metta-ship-merged-fi`.

The step MUST glob `<cwd>/spec/archive/*-<change-name>/` to detect whether a matching
archive directory exists. Because `metta finalize` only creates this directory when all
quality gates pass, directory existence is the proof of successful finalization.

If `sourceBranch` does not match the `metta/*` pattern the step MUST be skipped with
`{ step: 'finalize-check', status: 'skip', detail: 'non-metta branch — skipping finalize check' }`
and pipeline execution MUST continue to the existing `preflight` step.

If `sourceBranch` matches `metta/*` and zero archive directories match the glob, the
step MUST push
`{ step: 'finalize-check', status: 'fail', detail: 'change not finalized — run metta finalize --change <name> first' }`
and the method MUST return `{ status: 'failure', steps }` immediately. No git mutations
of any kind (merge commit, snapshot tag, branch update) MAY occur after this return.

If `sourceBranch` matches `metta/*` and one or more archive directories match the glob,
the step MUST push `{ step: 'finalize-check', status: 'pass' }` and pipeline execution
MUST continue to the existing `preflight` step.

When `finalize-check` fails, the `metta ship` output MUST display:

```
✗ finalize-check (change not finalized — run metta finalize --change <name> first)
```

### Scenario: unfinalized metta branch is blocked before any git ops

- GIVEN `sourceBranch` is `metta/foo`
- AND no directory matching `spec/archive/*-foo/` exists under `cwd`
- WHEN `MergeSafetyPipeline.run()` is called
- THEN `result.status` equals `'failure'`
- AND `result.steps[0]` equals
  `{ step: 'finalize-check', status: 'fail', detail: 'change not finalized — run metta finalize --change foo first' }`
- AND the target branch HEAD is unchanged (no merge commit was created)

### Scenario: finalized metta branch passes check and pipeline proceeds

- GIVEN `sourceBranch` is `metta/foo`
- AND directory `spec/archive/2026-04-15-foo/` exists under `cwd`
- WHEN `MergeSafetyPipeline.run()` is called
- THEN `result.steps[0]` equals `{ step: 'finalize-check', status: 'pass' }`
- AND the pipeline continues and records at least the `preflight` step in `result.steps`

### Scenario: non-metta branch skips finalize-check and pipeline proceeds

- GIVEN `sourceBranch` is `feature` (no `metta/` prefix)
- AND no archive directory for this branch exists
- WHEN `MergeSafetyPipeline.run()` is called
- THEN `result.steps` does not contain a step with `status: 'fail'` for `finalize-check`
- AND the pipeline continues past the skip to the `preflight` step

### Scenario: finalized metta branch with clean working tree passes all preflights

- GIVEN `sourceBranch` is `metta/foo`
- AND directory `spec/archive/2026-04-15-foo/` exists under `cwd`
- AND the working tree is clean (no uncommitted changes)
- WHEN `MergeSafetyPipeline.run()` is called
- THEN `result.steps` contains `{ step: 'finalize-check', status: 'pass' }`
- AND `result.steps` contains a passing `preflight` step
- AND the pipeline reaches merge execution without aborting
