# UAT: fix-release-pipeline-mid-cut-failure-restore-path-has-no

- **Change**: fix-release-pipeline-mid-cut-failure-restore-path-has-no
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Add an injection seam for the changelog generator on `ReleaseCutOptions`, mirroring the existing `ghExec?: GhExec` seam ("tests inject; production uses the default"). An optional `docGenerator` field typed against a minimal `ChangelogGenerator` contract (interface with the `generate` method the pipeline calls). `cut()` uses the injected instance when present, otherwise constructs the real `DocGenerator` exactly as today.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Add failure-injection tests in `tests/release-pipeline.test.ts` that run a real git fixture repo, inject a throwing generator, and assert:
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Trivial-tier change (no spec.md); scenarios derive from the intent / issue `release-pipeline-mid-cut-failure-restore-path-has-no-failure`:

#### Step 2.1
- **Do**: Confirm: [x] Mid-cut failure is reported with the failing step — covered by `tests/release-pipeline.test.ts` › "cut — mid-cut failure restore (fault injection)" › first-release test: injected `regen-changelog` throw yields `status: 'failure'` with `{ step: 'regen-changelog', status: 'fail', detail: 'injected changelog failure' }`.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] All mutated files restored to pre-cut contents — first-release test asserts version file back to `0.1.0` and previously-absent `spec/releases.yaml` / `docs/changelog.md` removed; subsequent-release test asserts byte-for-byte restoration of pre-existing record and changelog.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] No commit or tag after a mid-cut failure — both tests assert HEAD unchanged, tag list unchanged, working tree clean, and no `commit`/`annotated-tag` steps recorded.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] Production path unchanged — seam is optional (`docGenerator?` on `ReleaseCutOptions`, defaulting to the real `DocGenerator`); all 17 pre-existing release-pipeline tests still pass unmodified.
- **Observe**: behaves as described
- [ ] Pass
