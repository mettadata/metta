# Summary: fix-release-pipeline-mid-cut-failure-restore-path-has-no

## What changed

Resolved issue `release-pipeline-mid-cut-failure-restore-path-has-no-failure`
(minor): the mutation-group restore path in `ReleasePipeline.cut()` had no
failure-injection test.

- `src/release/release-pipeline.ts`
  - New exported `ChangelogGenerator` interface — minimal contract
    (`generate(types?: DocType[]): Promise<unknown>`) satisfied by `DocGenerator`.
  - New optional `docGenerator?: ChangelogGenerator` field on `ReleaseCutOptions`,
    mirroring the existing `ghExec?: GhExec` injection-seam pattern. `cut()` uses
    the injected instance when present; otherwise constructs the real
    `DocGenerator` exactly as before. Production behavior unchanged.
- `tests/release-pipeline.test.ts`
  - New describe block "cut — mid-cut failure restore (fault injection)" with
    two tests that inject a throwing generator:
    1. **First release** — asserts `status: failure`, the failing step is named
       (`{ step: 'regen-changelog', status: 'fail', detail: 'injected changelog
       failure' }`), earlier mutation steps passed, no `commit`/`annotated-tag`
       steps recorded, version file restored to `0.1.0`, `spec/releases.yaml`
       and `docs/changelog.md` removed (absent pre-cut), HEAD unchanged, no
       tags, clean working tree.
    2. **Subsequent release** — after a real successful cut, asserts the
       pre-existing releases record and changelog are restored byte-for-byte,
       the version file rolls back, and no new commit or tag is created.

## Verification

- `npx vitest run tests/release-pipeline.test.ts` — 19/19 pass (2 new)
- `npm test` — 118 files, 2085/2085 pass
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — clean

## Risk notes

- `ReleaseCutOptions` gains one optional field; no existing caller changes.
- No behavior change on the production path (seam defaults to the real generator).
