# Verification: fix-finalize-spec-merge-pipeline-hardening

Verified 2026-07-15 on branch `metta/fix-finalize-spec-merge-pipeline-hardening` by live-exercising a throwaway scaffolded project (`metta install --git-init` in a temp dir, driven via `node dist/cli/index.js` from a fresh build) plus direct `SpecMerger` invocation against `dist/`. All 5 finalize-ship delta requirements verified.

## Overall verdict: PASS

## Requirement verdicts

### 1. Explicit Capability Target Selection In Spec Authoring (ADDED, US-1) — PASS

- **Instructions surface existing capabilities**: with a pre-existing capability `authcap` in the fixture's spec store, `metta --json instructions spec --change target-probe-case` returned `context.existing_specs: ['authcap']`. Implementation: `src/context/instruction-generator.ts:96-101` (populates `existing_specs` for the spec artifact only).
- **Scaffold carries explicit target field, not implicit slug default**: the rendered scaffold for change `target-probe-case` opens with the H1 followed by the merge-target HTML comment: "the H1 above must name an existing capability (see existing_specs in your instructions). To create a NET-NEW capability instead, add an HTML comment line containing exactly new-capability immediately under the H1". Template: `src/templates/artifacts/spec.md:3`, propagated to `dist/templates/artifacts/spec.md`.
- Observation (non-blocking): the human-readable (non-`--json`) output of `metta instructions spec` prints the scaffold guidance but does not print the `existing_specs` slug list itself; the list is carried in the JSON payload, which is the orchestration contract consumed by the skills.

### 2. Merge Target Confirmation At Completion (ADDED, US-2) — PASS

- **Unconfirmed self-slug target refused**: delta with H1 `# target-probe-case` (equal to change slug, no such capability, no marker) → `metta complete spec` exited 4 with: "Delta spec's merge target 'target-probe-case' matches this change's own slug and no such capability exists yet. Add '<!-- new-capability -->' directly under the H1...". No folder appeared under `spec/specs/` (only `authcap` remained) and the `spec` artifact stayed `pending` in `.metta.yaml`. Implementation: `SpecTargetError` thrown before `markArtifact` in `src/cli/commands/complete.ts:193-203`.
- **Marker allows completion**: adding `<!-- new-capability -->` directly under the H1 → `complete spec` exited 0; subsequent `metta finalize` exited 0, minted `spec/specs/target-probe-case/spec.md` containing exactly 1 `## Requirement: Session Management` section, and archived the change as `2026-07-15-target-probe-case`.
- **Non-ADDED operations still hard-fail**: a `MODIFIED` delta with H1 `# ghostcap` (nonexistent capability) → `complete spec` exited 4 with "Delta 'MODIFIED: Requirement: Phantom Behavior' targets unknown capability 'ghostcap'. Did you mean 'ADDED: ...'?" and no `ghostcap` folder was created (`src/cli/commands/complete.ts:205-215`).

### 3. Spec Delta Merge — idempotent ADDED (MODIFIED, US-5) — PASS

Drove `SpecMerger.merge` directly against `dist/finalize/spec-merger.js` in an isolated spec dir with an ADDED delta for capability `auth` / requirement "Session Management":

- merge #1 (`baseVersions = {}`): `{"status":"clean","merged":["auth"],"conflicts":[],"noops":[]}` — capability created.
- merge #2 (same delta, still no `base_versions` entry — the "capability created by this same change" case): `{"status":"clean","merged":[],"conflicts":[],"noops":["auth/session-management"]}`.
- On-disk count of `^## Requirement: Session Management$` after both merges: **1**. No duplicate append; second application reported as a no-op via the new `noops` field. Implementation: `sections.has(...)` noop branch at `src/finalize/spec-merger.ts:177-181`, independent of the base_versions comparison at lines 100-119.

### 4. Finalizer Orchestration — completeness gate and gates-before-write (MODIFIED, US-3/US-6) — PASS

- **Incomplete artifact blocks finalize (US-3)**: change `incomplete-artifact-case` (clean ADDED delta targeting existing `authcap`, all artifacts `complete` except `verification: pending`) → `metta finalize` exited **3** printing "Cannot finalize: required artifacts are not complete:" / "verification: pending". No gate output appeared, a sha256 snapshot of every file under `spec/specs/` + `spec/archive/` was byte-identical before/after, and the change remained in `spec/changes/`. Exit-code ordering (incomplete=3 → conflict=2 → gate fail=1) implemented in `src/cli/commands/finalize.ts:58-98`.
- **Gate failure leaves capability spec untouched (US-6)**: same change with `verification` completed and `.metta/gates/tests.yaml` overridden to `command: "false"` → finalize exited **1** ("Quality gates failed: ✗ tests: fail"); `sha256sum spec/specs/authcap/spec.md` before and after: `a55f5b06...c7af01d` both times — byte-identical. Change still active.
- **Retry after fixed gate applies merge exactly once**: gate restored to `command: "true"` → finalize exited 0, "Specs merged: authcap/password-reset", and `spec/specs/authcap/spec.md` contained exactly 1 `## Requirement: Password Reset` section (alongside the pre-existing `Login`).

### 5. Trivial Workflow Verification Artifact Contract Agreement (ADDED, US-4) — PASS

- **Declared contract and instructed behavior agree**: `dist/templates/workflows/trivial.yaml` verification stage declares `generates: summary.md`; `metta --json instructions verification --change trivial-contract-case` (change proposed with `--workflow trivial`) returned `output_path: spec/changes/trivial-contract-case/summary.md` and the rendered template says "Save this file as `summary.md` in the change directory" (`src/templates/artifacts/verify.md:3`). No mention of `verification.md` anywhere in the payload.
- **Following instructions lets completion succeed**: after writing `summary.md` exactly as instructed, `metta complete verification` exited **0** and `.metta.yaml` showed `verification: complete` — satisfying the finalize completeness gate without any manual file creation or renaming.

## Gate results

| Gate | Result |
|------|--------|
| `npx vitest run` | PASS — 82 files, 1096/1096 tests |
| `npx tsc --noEmit` (also `npm run lint`) | PASS — exit 0 |
| `npm run build` | PASS — exit 0, templates copied to dist |

The suite includes the change's own coverage: `tests/cli-complete.test.ts` capability-target gate block (refusal, marker, pre-existing-capability, MODIFIED hard-fail), `tests/finalizer.test.ts` ordering coverage, and spec-merger ADDED-idempotency tests — all passing.

## Fixtures

All throwaway fixture projects were created under the session scratchpad and deleted after verification. No repository source files were modified.
