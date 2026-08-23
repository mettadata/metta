# Summary: enforce-agent-executed-uat-run-results-attached-pr-before

## What was built

Every ship-path skill now runs the archived UAT.md through the metta-uat-runner subagent between `metta finalize` and `git push`, attaches a `## UAT results` summary to the PR (body at create, `gh pr comment` on an existing PR), and treats any failed step as a hand-back blocker — the PR stays open, unmerged, and flagged. Manual-acceptance steps skip and never block; machine-verified steps pass automatically. Opt-out is `uat.enforce_on_ship: false` (default true).

## Changes by area

- **Config schema** (`src/schemas/project-config.ts`): `enforce_on_ship: z.boolean().default(true)` added to the strict `UatConfigSchema`. Omitted key, omitted `uat` block, or missing config file all default to enforced; unknown keys and non-booleans still reject.
- **Install scaffold** (`src/cli/commands/install.ts`): fresh `metta install` writes an explicit `uat:` block with `enforce_on_ship: true` and an opt-out comment; existing configs remain byte-untouched (`wx` flag preserved).
- **Finalizer** (`src/finalize/finalizer.ts`): required `uatEnforceOnShip: boolean` on `FinalizeResult` — real config value on the success return (read before the `uat.enabled` branch so it is reported even when `uatPath` is null); hardcoded `true` on all abort paths and dry-run (fail-toward-enforce).
- **Finalize CLI** (`src/cli/commands/finalize.ts`): emits `uatEnforceOnShip` beside `uatPath` in the `--json` success payload; human output prints `UAT enforcement: off` only when disabled.
- **Six skill pairs** (template + deployed, 12 files, byte-identical per pair): shared frozen "UAT gate (before hand-back)" block (steps U0–U6) inserted between finalize and push in metta-ship, metta-propose, metta-quick, metta-auto, metta-fix-issues, metta-fix-gap. The canonical pinned sentence is byte-identical across all 12 files. Extras: metta-ship gained `Agent` in allowed-tools plus an already-finalized branch (archive glob fallback, reuse short-circuit, fail-toward-enforce); metta-propose's default-path hand-back now distinguishes "PR open, flagged — UAT failed" from the ready message while preserving the pinned handoff string; fix-issues/fix-gap tie issue/gap removal to a passed gate.
- **Tests**: new `tests/skill-uat-ship-gate.test.ts` (39 assertions — sentence exactly-once, gate-before-`gh pr create --title`, gate-before-merge across all 12 files, metta-ship Agent frontmatter, aggregate offender listing); extensions to `tests/config-loader.test.ts`, `tests/cli-install.test.ts`, `tests/finalizer.test.ts`, `tests/cli-finalize.test.ts`; one Rule-1 fix in `tests/cli-finalize.test.ts` (duplicate YAML key from raw append → parse/stringify merge).
- **Docs**: dated changelog entry covering the behavior change, the opt-out, and the new JSON field.

## Gate results

`npm test`: 135 files, 2756 passed, 2 skipped, 0 failed. `npx tsc --noEmit`: clean. `npm run lint`: clean. `npm run build`: clean. Unchanged-by-design confirmed: metta-uat-runner agent pair, metta-uat skill, both guard-hook copies, and uat-generator carry no diff versus main.

## Notable decisions

- Toggle rides `metta finalize --json` (no guard-hook changes); absent field in older payloads is treated as `true`.
- Reuse short-circuit: HEAD commit subject `docs(<change>): UAT run record` means the branch is unchanged since a recorded run — reuse as evidence, comment on the PR, no double-append.
- Dry-run finalize reports hardcoded `true` (config never loaded there); skills gate only on the real payload.
