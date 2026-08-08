# UAT: fix-root-invoked-instructions-context-complete-emit-main

- **Change**: fix-root-invoked-instructions-context-complete-emit-main
- **Generated**: 2026-08-08
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
- **Do**: Confirm: Add a shared change-root resolution helper (e.g. `resolveChangeRoot(ctx, changeName)`) in `src/cli/helpers.ts` (or a sibling module with its own test file, per the 1:1 ratio). It returns the worktree checkout root when the change's metadata carries a hosting `worktree` path — `ArtifactStore.getChange()` already injects this transiently at `src/artifacts/artifact-store.ts:145-147` — and falls back to `ctx.projectRoot` otherwise. The helper is pure given the metadata (functional core); the store lookup stays at the command edge.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Re-root all change-scoped paths in the three commands through the helper:
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Behavioral guarantee: for a worktree-hosted change, root invocation and in-worktree invocation produce identical emitted paths and identical git side-effect targets. For non-worktree changes, all paths remain exactly `ctx.projectRoot`-rooted — no behavior change.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Tests covering both roots for each command: main-root invocation of a worktree-hosted change emits worktree paths; in-worktree invocation is unchanged; non-worktree changes are unchanged; git auto-commit `cwd` lands in the hosting checkout.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Three parallel verifiers (test suite, static gates, intent-coverage evidence). Verify iteration #1 — all green on the first pass.

#### Step 2.1
- **Do**: Confirm: [x] Shared `resolveChangeRoot` helper — pure, metadata-driven, projectRoot fallback: `tests/cli-helpers.test.ts:116,121,126`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: [x] `metta instructions` re-rooted (changePath/specDir into the generator): `tests/cli-worktree-change-root.test.ts:180` — worktree-only capability listed, main-only absent, worktree project.md marker
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: [x] `metta context stats` re-rooted: `tests/cli-worktree-change-root.test.ts:105` — reads worktree artifacts instead of erroring
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.4
- **Do**: Confirm: [x] `metta complete` gates re-rooted — spec-delta gate + capability existence check: `:215`; stories-valid gate: `:232`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.5
- **Do**: Confirm: [x] Git auto-commit cwd re-rooted — instructions `:276`, complete `:305`; both assert main-checkout HEAD unchanged and no leaked change dir
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.6
- **Do**: Confirm: [x] Parity guarantee — main-root vs in-worktree invocations identical: context stats deep-equal `:117`, instruction payloads `:199`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.7
- **Do**: Confirm: [x] Non-worktree changes byte-identical — `:131`; canonical not_found preserved `:148`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.8
- **Do**: Confirm: [x] Containment hardening (review addition) — worktree metadata honored only under `<root>/.metta/worktrees/`: `tests/cli-helpers.test.ts:132,137,142,150,160`; corrupt metadata propagates as error, not not_found: `tests/cli-worktree-change-root.test.ts:161`
- **Observe**: behaves as described
- [ ] Pass
