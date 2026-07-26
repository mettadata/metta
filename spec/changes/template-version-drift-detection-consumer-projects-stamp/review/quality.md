VERDICT: PASS_WITH_WARNINGS

# Quality Review: template-version-drift-detection-consumer-projects-stamp

Reviewer focus: dead code, naming consistency, duplication, test gaps, comment quality, convention compliance.
Scope reviewed: full `git diff main...HEAD -- src/ tests/` (11 changed/new files). All 204 tests in the touched suites pass locally (`version-drift.test.ts`, `cli-helpers.test.ts`, `cli-version-drift.test.ts`, `schemas.test.ts`).

## Findings

### Critical
None.

### Major
None.

### Minor

1. **minor — src/index.ts (root barrel) — `version-drift.js` not barrel-exported.**
   The barrel exports the sibling config modules `config-loader.js` (line 4), `config-writer.js` (line 30), and `repair-config.js` (line 31), but not the new `src/config/version-drift.ts`. `repair-config` is equally CLI-internal plumbing and is exported, so consistency argues for adding `export * from './config/version-drift.js'`. Non-blocking: nothing outside `src/cli/` consumes the module today, and its names (`VersionDrift`, `detectVersionDrift`, etc.) collide with nothing in the barrel.

2. **minor — src/config/version-drift.ts:73 — `resetVersionDrift` has no production caller.**
   It is invoked only from tests (`version-drift.test.ts`, `tests/cli-helpers.test.ts`). This is acceptable as the documented test seam of the ADR-2 slot API ("explicitly resettable"), and the slot could not be safely tested without it — recording here so a future dead-code sweep does not remove it without reading the ADR comment.

3. **minor — tests/cli-version-drift.test.ts:8 — no integration-level downgrade case.**
   `STALE = '0.0.0-drift-test'` is always older than the running version, so every integration fixture exercises the upgrade direction only. The spec's downgrade scenario (binary older than stamp) is covered at the unit level (`src/config/version-drift.test.ts:26` — `detectVersionDrift('0.5.0', '0.4.0')`), and the comparison is directionless string inequality, so plumbing coverage is equivalent. A `9999.0.0` integration fixture would close the gap literally but adds little signal.

4. **minor — tests/cli-version-drift.test.ts:206 (failing --json command test) — spec's "exit code 3" example exercised with exit code 4.**
   The `invocation-time-drift-check` scenario names exit code 3 as its non-zero example; the test uses `validate-stories --change does-not-exist` (exit 4). The property under test — drift never alters a failing command's exit code — is fully verified; the specific numeral differs. No action needed unless the verifier maps scenarios literally.

## Checks performed — clean

- **Naming boundaries (installed_version vs installedVersion):** correct throughout. `installed_version` (snake_case) appears only at serialization edges — YAML config key (`version-drift.ts:38`, schema `project-config.ts:117`), JSON payload key `template_version_mismatch` (`helpers.ts:158`). All TS identifiers are camelCase (`installedVersion`, `runningVersion`, `readInstalledVersion`, `stampInstalledVersion`). The `VersionDrift` interface fields `installed`/`running` intentionally mirror the spec-mandated JSON shape.
- **Duplication (install vs init stamping):** none. Each command makes a single `stampInstalledVersion(root, await getPackageVersion())` call against the shared module; the logic lives once in `version-drift.ts`. Doctor and the preAction warning share `templateFreshnessCheck`/`detectVersionDrift` rather than reimplementing comparison, and the comment at `version-drift.ts:53-57` explains why doctor does not reuse `detectVersionDrift` (missing-stamp semantics differ) — good.
- **Init ENOENT hazard:** `stampInstalledVersion` propagates ENOENT by design, but `init.ts:19-33` guards with the existing "run metta install first" precondition before stamping, and `install.ts` stamps only after the config file is guaranteed to exist (created at `install.ts:264` or pre-existing). No unhandled path.
- **Singleton exception:** the module-scoped drift slot carries the required ADR comment (`version-drift.ts:64-69`, "ADR-2: ... documented, deliberate exception to the no-singletons rule"), matching ADR-2 in `design.md:313`. Confined to one file behind record/get/reset; not a service locator.
- **DRIFT_CHECK_EXEMPT_COMMANDS placement/comment:** placed directly after `CONFIG_PARSE_EXEMPT_COMMANDS` in `src/cli/index.ts:143-147` with an explicit comment that the two gates are independent sets and must never be re-merged — exactly the clarity requested. The preAction phase (a)/(b) comments correctly document ordering (drift check before the ConfigParseError fail-fast) and the never-break contract, with a belt-and-braces try/catch.
- **preAction root resolution:** the hook uses `process.cwd()` while commands use `ctx.projectRoot` — verified equivalent, since `createCliContext()` defaults `root` to `process.cwd()` with no upward walk (`helpers.ts:39-40`).
- **Conventions:** kebab-case filename, `.js` import extensions everywhere, no CommonJS, no new string-literal template files, functional core (pure `detectVersionDrift`/`templateFreshnessCheck`) with I/O at the edges (`readInstalledVersion`, `stampInstalledVersion` via the validated comment-preserving `setProjectField` path). Co-located `version-drift.test.ts` preserves the 1:1 test-to-source ratio, matching the pattern of `config-writer.test.ts`/`repair-config.test.ts`.
- **Dead code:** none found beyond finding 2. All exports of `version-drift.ts` have callers (index.ts hook, helpers.ts outputJson, doctor, install, init, tests).
- **Spec scenario coverage:** all 18 Given/When/Then scenarios across the five requirements have corresponding assertions — install/init stamping and overwrite (`cli-install.test.ts:105-133`, `cli-version-drift.test.ts` re-stamping block), schema accept/legacy/reject (`schemas.test.ts:891-950`), single stderr warning with unchanged stdout/exit code, JSON key presence/absence, corrupt-config silence with preserved ConfigParseError remedy, doctor pass/warn/missing-stamp/corrupt-config. `outputJson` edge cases (array payloads, pre-existing key non-displacement) are covered in `tests/cli-helpers.test.ts` outputJson block.

## Verdict

PASS_WITH_WARNINGS — no critical or major issues; four minors, of which only the barrel export (finding 1) suggests a one-line follow-up.
