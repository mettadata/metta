# fix-release-pipeline-mid-cut-failure-restore-path-has-no

## Problem

The mutation-group restore path in `ReleasePipeline.cut()` is verified only by code
inspection. When any of the three mutation steps (`write-version-file`,
`write-releases-record`, `regen-changelog`) throws, `cut()` must restore the version
file, the releases record, and the changelog to their pre-cut contents, record the
failing step by name, and return failure **before** `commit` and `annotated-tag` run.
No test in `tests/release-pipeline.test.ts` induces a failure inside that window — the
existing suite covers only pre-mutation aborts (dirty tree, pre-existing tag, user
decline) and the post-commit tag failure.

This is a verification gap, not a runtime bug: a regression in the restore logic
(a file silently left mutated, a missing step name, an accidental commit after
failure) would ship undetected. It was flagged PARTIAL during verification of
`fix-automatic-versioning-release-capability-metta` (PR #66) and logged as issue
`release-pipeline-mid-cut-failure-restore-path-has-no-failure`.

The root cause of untestability is structural: `DocGenerator` is constructed inline
inside `cut()` (`src/release/release-pipeline.ts:451`), so there is no seam through
which a test can inject a mid-mutation failure deterministically.

## Proposal

Make the mid-cut failure path deterministically testable and cover it with tests:

1. **Add an injection seam for the changelog generator** on `ReleaseCutOptions`,
   mirroring the existing `ghExec?: GhExec` seam ("tests inject; production uses the
   default"). An optional `docGenerator` field typed against a minimal
   `ChangelogGenerator` contract (interface with the `generate` method the pipeline
   calls). `cut()` uses the injected instance when present, otherwise constructs the
   real `DocGenerator` exactly as today.
2. **Add failure-injection tests** in `tests/release-pipeline.test.ts` that run a real
   git fixture repo, inject a throwing generator, and assert:
   - the result is `failure` with a step `{ step: 'regen-changelog', status: 'fail' }`,
   - the version file, `spec/releases.yaml`, and the changelog all match their
     pre-cut contents (including the "file did not exist before" case being removed),
   - no new commit and no new tag were created.

## Impact

- `ReleaseCutOptions` gains one optional field; all existing callers are unaffected
  (the CLI does not set it, production behavior is byte-for-byte identical).
- `tests/release-pipeline.test.ts` gains a new describe block; no existing tests change.
- No behavior change to `ReleasePipeline.cut()` beyond consulting the optional seam.

## Out of Scope

- Fault-injection seams for `write-version-file` and `write-releases-record` — those
  steps run pipeline-internal code with no inline collaborator; their catch blocks
  share the same `restoreFiles()` helper exercised by the changelog test. Adding
  seams solely to reach them is not justified by this issue.
- Environmental fault injection (chmod / path-as-directory tricks) — rejected as
  platform-brittle.
- Module-level mocking of `doc-generator.js` — rejected; the existing test file
  imports the real `DocGenerator` behavior transitively and a module mock would
  force a separate test file and couple tests to import paths.
- Any change to restore semantics, step naming, or the commit/tag flow.
