# fix-two-cli-paper-cuts-1-instructions-banner-double-prefix

## Problem

Two small but user-visible CLI defects:

**1. Instructions banner renders a double `METTA-` prefix.**
`agentBanner(agentName, message)` in `src/cli/helpers.ts` (lines 231–235) unconditionally builds its label as `` `metta-${agentName}` `` and uppercases it. Since the 5a agent-registry change, `src/cli/commands/instructions.ts` passes `output.agent.name` to `agentBanner` (lines 177 and 182), and that value is now the agent's real frontmatter name — already prefixed, e.g. `metta-proposer`. The result is a rendered tag of `[METTA-METTA-PROPOSER]` / `[METTA-METTA-EXECUTOR]` (observed live 2026-07-17; reproducible today via `metta instructions`). A secondary symptom of the same defect: the `agentColorMap` lookup keys on bare names (`proposer`, `executor`, ...), so a prefixed input also misses the map and falls back to the generic robot icon and cyan color instead of the agent's assigned icon/color.

The other `agentBanner` call sites — `src/cli/commands/complete.ts` (lines 568, 571, 582, 585, 592) — pass bare names from `artifactAgentMap` and render correctly today; `progress.ts` imports `agentBanner` but never calls it. Any fix must keep the bare-name call shape working unchanged.

**2. `metta doctor` hardcodes the framework version.**
Resolves logged issue `metta-doctor-hardcodes-framework-version-0-1-0-instead-of`. `src/cli/commands/doctor.ts` line 96 pushes the "Framework version" check with `detail: '0.1.0'` as a string literal. The package is at 0.2.1, so doctor silently disagrees with `metta --version` and `metta update`, which were migrated to the shared `getPackageVersion()` helper (added to `src/cli/helpers.ts` in commit e4e5657f3, shipped 2026-07-14). This literal is the last remaining hardcoded version in `src/`.

## Proposal

**Banner fix — strip-then-prefix in `agentBanner`.**
In `src/cli/helpers.ts`, normalize the input by stripping any leading `metta-` from `agentName` before doing anything else, then use the normalized bare name for both the `agentColorMap` lookup and the `metta-` label prefix. This makes the helper idempotent across both call shapes:

- `agentBanner('executor', ...)` → `[METTA-EXECUTOR]` (unchanged behavior)
- `agentBanner('metta-executor', ...)` → `[METTA-EXECUTOR]` (bug fixed), with the executor's own icon and color restored

No call-site changes are required; the fix is contained in the helper. As part of verification, sweep all `agentBanner` call sites (`instructions.ts`, `complete.ts`) to confirm no other double-prefix instance of this class remains.

**Doctor fix — use the shared helper.**
In `src/cli/commands/doctor.ts`, replace `detail: '0.1.0'` with `detail: await getPackageVersion()` (the surrounding action handler is already async) and add `getPackageVersion` to the existing import from `../helpers.js`. This mirrors the pattern already applied to `src/cli/index.ts` and `src/cli/commands/update.ts`.

**Tests.**
- Extend `tests/banner-stories.test.ts` (or add a focused sibling case) to assert that a prefixed input renders a single prefix: `agentBanner('metta-executor', ...)` contains `[METTA-EXECUTOR]` and does not contain `[METTA-METTA-`, alongside the existing bare-name assertions.
- Add a doctor assertion that the "Framework version" check reports the version read from `package.json` — the test derives its expectation by reading `package.json` rather than hardcoding a version string, mirroring the pattern in `tests/cli-skills.test.ts` (lines 19–25).

**Issue resolution.**
Move `spec/issues/metta-doctor-hardcodes-framework-version-0-1-0-instead-of.md` to `spec/issues/resolved/` as part of finalization.

## Impact

- **Users / AI orchestrators:** `metta instructions` banners render the correct single-prefix agent tag with the correct per-agent icon and color; `metta doctor` reports the actually installed framework version (currently 0.2.1) consistent with `metta --version` and `metta update`.
- **Code:** two-file source change (`src/cli/helpers.ts`, `src/cli/commands/doctor.ts`), both minimal and localized. No API surface, schema, or state-format changes. Existing bare-name banner call sites in `complete.ts` are unaffected by construction (strip-then-prefix is a no-op for bare names).
- **Tests:** one extended banner test file, one new doctor version assertion. No existing test expectations change — `banner-stories.test.ts` already asserts the single-prefix output for bare names and continues to pass.
- **Specs/issues:** one logged issue resolved and archived to `spec/issues/resolved/`.
- **Risk:** low. The only behavioral edge is an agent literally named with a `metta-` prefix in its bare form; no such agent exists in the registry, and the frontmatter naming convention (`metta-<role>`) makes the strip unambiguous.

## Out of Scope

- Making the doctor "Framework version" check meaningful (e.g. `status: 'warn'` when `getPackageVersion()` returns `'unknown'`) — the check stays unconditionally `pass`, matching candidate solution 1 in the issue.
- Consolidating the ~7 divergent `git commit` sites noted in the `helpers.ts` TODO — unrelated deferred refactor.
- Changing how `instructions.ts` resolves or emits `metta_agent` / `output.agent.name`, or any other agent-registry behavior — the prefixed name is correct data; only the banner rendering is fixed.
- Removing the unused `agentBanner` import in `progress.ts` or touching the duplicated `artifactAgentMap` literals in `complete.ts`/`progress.ts`.
- Adding new doctor checks, `--fix` behavior changes, or any output-format changes beyond the version value.
- Version-bump automation or changes to how `package.json` is read (`getPackageVersion()` is used as-is).
