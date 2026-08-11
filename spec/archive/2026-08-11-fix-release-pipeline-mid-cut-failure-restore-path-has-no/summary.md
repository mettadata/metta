# Verification: fix-release-pipeline-mid-cut-failure-restore-path-has-no

## Spec Scenarios

Trivial-tier change (no spec.md); scenarios derive from the intent / issue
`release-pipeline-mid-cut-failure-restore-path-has-no-failure`:

- [x] **Mid-cut failure is reported with the failing step** — covered by
  `tests/release-pipeline.test.ts` › "cut — mid-cut failure restore (fault
  injection)" › first-release test: injected `regen-changelog` throw yields
  `status: 'failure'` with `{ step: 'regen-changelog', status: 'fail', detail:
  'injected changelog failure' }`.
- [x] **All mutated files restored to pre-cut contents** — first-release test
  asserts version file back to `0.1.0` and previously-absent
  `spec/releases.yaml` / `docs/changelog.md` removed; subsequent-release test
  asserts byte-for-byte restoration of pre-existing record and changelog.
- [x] **No commit or tag after a mid-cut failure** — both tests assert HEAD
  unchanged, tag list unchanged, working tree clean, and no
  `commit`/`annotated-tag` steps recorded.
- [x] **Production path unchanged** — seam is optional (`docGenerator?` on
  `ReleaseCutOptions`, defaulting to the real `DocGenerator`); all 17
  pre-existing release-pipeline tests still pass unmodified.

## Gate Results

- tests: PASS — `npm test`: 118 files, 2085/2085 (includes 2 new fault-injection tests)
- typecheck: PASS — `npx tsc --noEmit` clean
- lint: PASS — `npm run lint` clean
- build: PASS — `npm run build` clean

## Summary

Added a `ChangelogGenerator` injection seam to `ReleaseCutOptions` in
`src/release/release-pipeline.ts` (mirroring the existing `ghExec` seam) so the
`regen-changelog` step can be made to throw deterministically, and added a
fault-injection describe block to `tests/release-pipeline.test.ts` covering the
mutation-group restore path: failing step named, all three files restored
(both absent-before and existing-before cases), and no commit/tag created.
Closes the verification gap flagged PARTIAL in PR #66; no runtime behavior
change.
