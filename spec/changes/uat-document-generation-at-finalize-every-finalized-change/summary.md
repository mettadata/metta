# Summary: uat-document-generation-at-finalize-every-finalized-change

Every finalized change now produces a `UAT.md` — a deterministic, step-by-step acceptance script assembled from the change's own artifacts, written into the change directory immediately before archive so the archive move sweeps it in, and surfaced in finalize output.

## Files changed

| File | Change |
|---|---|
| `src/schemas/project-config.ts` | Added `UatConfigSchema` (`enabled: boolean` default `true`, strict) + `UatConfig` type; registered `uat: UatConfigSchema.default({})` on `ProjectConfigSchema` |
| `src/templates/artifacts/uat.md` | New external skeleton template — four placeholders (`{change_name}`, `{generated_date}`, `{source_tier}`, `{uat_steps}`), `## Reporting failures` prose, `## Acceptance steps` frame; shipped to dist by the existing `copy-templates` step (no build change) |
| `src/finalize/uat-generator.ts` | New pure generator: `generateUat({changeName, changeDir, generatedAt, gates, gatesPassed})` returning `{markdown, tier, warnings}`; tier ladder stories -> delta-spec scenarios -> intent+summary -> floor; AC-driven step mapping with ITC preambles and conservative backtick command hints; delta-scenario folding via `fulfills` with exact-normalized dedupe; honest machine-verified predicate over in-memory gate results + summary cross-reference; never throws on source problems (warn-and-demote); only template load/render errors escape |
| `src/index.ts` | Barrel export for the generator |
| `src/finalize/finalizer.ts` | Step 5b between real spec merge and archive: projectRoot guard, shared lazily-imported `ConfigLoader` (Step 5b + Step 7, independent try/catches), `uat.enabled` check, write via `artifactStore.writeArtifact`, warn-and-continue degradation with partial-file cleanup; `FinalizeResult` gains required `uatPath: string | null` (all six return literals updated) and optional `uatError?: string`; reported path derived from `archive()`'s returned name |
| `src/cli/commands/finalize.ts` | Success JSON gains always-present `uatPath` + conditional `uatWarning`; human mode gains `UAT script:` line and yellow stderr warning on degradation; error shapes and exit codes untouched |
| `tests/config-loader.test.ts` | +4 tests: default, explicit false, strict unknown-key rejection, non-boolean rejection |
| `tests/uat-template-contract.test.ts` | New: placeholder set, sentinel prose, no `{{` tokens, full-substitution round trip, no-template-literal grep guard |
| `tests/uat-generator.test.ts` | New: 22 tests — tier-1 mapping, command extraction accept/reject, delta folding/dedupe, all four tier fallbacks, every annotation clause + guards, error ladder, byte determinism, no-AI guard |
| `tests/finalizer.test.ts` | +8 tests: pre-archive write + archive sweep, full `uatPath` semantics matrix, no stray UAT.md on all abort/dry-run paths, degradation |
| `tests/cli-finalize.test.ts` | +4 tests: success JSON field, disabled semantics, degraded run (`uatWarning`, exit 0, stderr warning), error payloads unchanged |

## Gates

- `npx tsc --noEmit` — clean after every batch
- `npm test` — green after every batch; final: **90 files, 1525 tests, 0 failures**

## Behavior

- Successful finalize with `uat.enabled` (default): `UAT.md` appears in `spec/archive/<date>-<name>/` alongside `gates.yaml` and `summary.md`; JSON carries `uatPath`; human output prints `UAT script: <path>`.
- `uat.enabled: false`: no file, `uatPath: null`, no human line, no warning.
- Any failed finalize (incomplete artifacts, merge conflict, gate failure) or dry-run: exits upstream of generation — no stray `UAT.md`, `uatPath: null`.
- Generation failure (e.g. missing template): finalize still succeeds; `uatPath: null` + `uatWarning`/`uatError`; yellow stderr warning; exit 0.
- Determinism: byte-identical output for identical inputs with fixed `generatedAt`; no AI call anywhere in the generator module graph.

## Task completion

| Task | Commit | Result |
|---|---|---|
| 1.1 UatConfigSchema | `8003a0d04` | Done |
| 1.2 uat.md template + contract test | `28e383dc0` | Done |
| 2.1 uat-generator module | `f4483ea45` | Done |
| 3.1 Finalizer Step 5b + FinalizeResult | `6d91edf49` | Done (noted deviation: inline `rm(force:true)` cleanup instead of out-of-scope `deleteIfExists`) |
| 4.1 CLI output surfacing | `9a2abfc37` | Done |

## Verification

Three parallel verifiers — all gates PASS. Full reports: [verify/tests.md](verify/tests.md), [verify/tsc-lint.md](verify/tsc-lint.md), [verify/scenarios.md](verify/scenarios.md).

| Gate | Result | Evidence |
|---|---|---|
| npm test | PASS | 90 files, 1525 tests, 0 failures (verify/tests.md) |
| tsc --noEmit / lint / build | PASS | exit 0 on all; dist/templates/artifacts/uat.md byte-identical to src (verify/tsc-lint.md) |
| Spec scenario traceability | PASS | all 26 scenarios across 9 ADDED requirements implemented and passing; 24 fully test-covered, 2 partial-by-inspection (error-shape byte-compat for 4 shapes, dist copy step) — details in verify/scenarios.md |
