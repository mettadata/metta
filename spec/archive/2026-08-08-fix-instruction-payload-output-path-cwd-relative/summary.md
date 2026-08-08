# Implementation Summary — fix-instruction-payload-output-path-cwd-relative

Resolves issue `instruction-payload-output-path-is-cwd-relative-so-a-main` (major).

## What changed

1. **Absolute, change-rooted instruction payload paths** (`b7999684c`)
   - `src/cli/commands/instructions.ts` passes the resolved `changeRoot` (via `resolveChangeRoot`) into `InstructionGenerator.generate()`.
   - `src/context/instruction-generator.ts` emits `output_path` as `join(changeRoot, 'spec', 'changes', <name>, <generates>)` and a new `change_root` field on `InstructionOutput` carrying the absolute checkout root hosting the change.
   - `--change` argument validated with `assertSafeSlug` before any path join or store lookup.

2. **check-constitution contract re-rooted** (`0fe59d3b3`)
   - `src/cli/commands/check-constitution.ts` resolves `changeRoot`; `spec_path`/`violations_path` are change-rooted, scratch `output_path` absolute, `change_root` included in both JSON payloads.

3. **Skills consume the contract correctly** (`4ed9459b6`)
   - `metta-propose`, `metta-plan`, `metta-check-constitution` SKILL.md files (both `src/templates/skills/` and `.claude/skills/`, kept byte-identical) now write the absolute `{output_path}` verbatim and commit via `git -C {change_root} add/commit` — never against the session cwd.

4. **Slug validation in complete** (`093c6055c`)
   - `src/cli/commands/complete.ts` validates `--change` with `assertSafeSlug` (matching `context.ts`); traversal-shaped names fail fast with exit 4.

5. **Discovered worktree host wins over stored value** (`1d4eb1b92`)
   - `ArtifactStore.getChange()` injects the discovered live host unconditionally when discovery finds one; persisted `metadata.worktree` used only when discovery finds nothing.
   - `updateChange()` never-persist guard tightened: an update whose `worktree` equals the discovered host is treated as an injection round-trip and the stored value (including its absence) is restored.

6. **Consumer tests updated for the deliberate breaking change** (`ba212ef5f`)
   - `tests/cli-issue-backlog.test.ts`, `tests/verify-template-contract.test.ts` assert absolute path semantics.

## Regression finding

The main-root ENOENT for worktree-hosted changes (`metta instructions --change <name>` from the main root) does **not** reproduce against current source — the live failure came from a stale build. A regression test invoking `instructions` from the main root against a worktree-only change is retained.

## Tests

- `npx tsc --noEmit` clean.
- Full suite: 102 files, 1792/1792 tests passing.
- New coverage: absolute `output_path`/`change_root` for worktree-hosted and local changes (`tests/instructions-payload-paths.test.ts`, `tests/instruction-generator.test.ts`), check-constitution path emission (`tests/cli-check-constitution-paths.test.ts`), slug rejection in `complete` (`tests/cli-complete.test.ts`), discovered-host-wins / never-persist (`tests/artifact-store.test.ts`).

## Breaking change (deliberate)

`output_path` (and check-constitution `spec_path`/`violations_path`) changed from repo-relative strings to absolute paths; `change_root` added to the contract. Skill templates updated in the same change; external automation parsing `--json` output must switch to the new semantics.

## Out of scope (unchanged)

Config/workflow main-root anchoring, worktree lifecycle, guard-hook authorization, `metta-init` discovery `output_paths` (main-root by design), slug validation beyond `complete`/`instructions`.

## Verification (3 parallel verifiers, iteration #1)

- **Tests:** full suite 102 files, 1792/1792 passing, 0 skipped, no flakes.
- **Gates:** `npx tsc --noEmit` clean; `npm run lint` (tsc alias) clean; `npm run build` (tsc + copy-templates) clean.
- **Spec coverage:** all 7 intent proposal items and all new/changed context-engine section-10 scenarios traced to implementing code and passing tests (details in verifier evidence: instructions-payload-paths, instruction-generator, cli-check-constitution-paths, cli-complete slug suite, artifact-store, template-deploy-sync, verify-template-contract).
- **Caveat:** skill markdown phrasing (item 3) is verified by template mirror byte-identity + manual inspection; no behavioral test asserts prose content — consistent with existing project practice.
- Review round 1: 3 reviewers PASS_WITH_WARNINGS; the single major (living-spec drift) fixed in c4863cdfc, quoting minor in 7957fc5b1.
