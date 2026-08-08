# Verification: fix-root-invoked-instructions-context-complete-emit-main

Three parallel verifiers (test suite, static gates, intent-coverage evidence). Verify iteration #1 — all green on the first pass.

## Spec Scenarios

Quick workflow — the intent's behavioral guarantees serve as the spec. Every guarantee has cited passing test evidence (35/35 in the two change suites):

- [x] **Shared `resolveChangeRoot` helper** — pure, metadata-driven, projectRoot fallback: `tests/cli-helpers.test.ts:116,121,126`
- [x] **`metta instructions` re-rooted** (changePath/specDir into the generator): `tests/cli-worktree-change-root.test.ts:180` — worktree-only capability listed, main-only absent, worktree project.md marker
- [x] **`metta context stats` re-rooted**: `tests/cli-worktree-change-root.test.ts:105` — reads worktree artifacts instead of erroring
- [x] **`metta complete` gates re-rooted** — spec-delta gate + capability existence check: `:215`; stories-valid gate: `:232`
- [x] **Git auto-commit cwd re-rooted** — instructions `:276`, complete `:305`; both assert main-checkout HEAD unchanged and no leaked change dir
- [x] **Parity guarantee** — main-root vs in-worktree invocations identical: context stats deep-equal `:117`, instruction payloads `:199`
- [x] **Non-worktree changes byte-identical** — `:131`; canonical not_found preserved `:148`
- [x] **Containment hardening (review addition)** — worktree metadata honored only under `<root>/.metta/worktrees/`: `tests/cli-helpers.test.ts:132,137,142,150,160`; corrupt metadata propagates as error, not not_found: `tests/cli-worktree-change-root.test.ts:161`

No guarantee lacks test evidence.

## Gate Results

| Gate | Result |
|------|--------|
| `npm test` | PASS — 1778/1778 tests, 100 files, 0 failures |
| `npx tsc --noEmit` | PASS — clean, exit 0 |
| `npm run lint` | PASS — clean (script is `tsc --noEmit`; no separate linter configured) |
| `npm run build` | PASS — compile + template copy clean |

## Summary

Fixed the silent main-root path emission for worktree-hosted changes (issue `root-invoked-instructions-context-complete-emit-main`, major). Added pure `resolveChangeRoot(projectRoot, metadata)` in `src/cli/helpers.ts` consuming the hosting-`worktree` metadata `ArtifactStore` already surfaces, with strict containment under `<root>/.metta/worktrees/` (deterministic `resolve(projectRoot, ...)`, `path.relative` check, safe projectRoot fallback). Re-rooted all change-scoped paths and git auto-commit cwds in `instructions.ts`, `context.ts`, `complete.ts`; narrowed context.ts's metadata catch so corruption surfaces instead of masquerading as not_found.

Review: 2 iterations, 3 reviewers each — final verdicts PASS / PASS_WITH_WARNINGS / PASS, no criticals. Major follow-up logged as issue `instruction-payload-output-path-is-cwd-relative-so-a-main` (relative `output_path` in the instruction payload, plus stale-persisted-worktree-path and missing `assertSafeSlug` notes). Known non-blocking limitation: containment anchors on the default `.metta/worktrees` dir; custom `git.worktree.dir` values remain unsupported for root-invoked re-rooting (consistent with existing discovery).

Commits: `1c0ab28d9` (helper + tests), `476b2f939` (command rewiring + integration tests), `85667a8eb` (containment), `2b6cb57b5` (catch narrowing + test polish), `3dfd6a923` (deterministic resolution).
