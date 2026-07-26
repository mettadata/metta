# Correctness Review: template-version-drift-detection-consumer-projects-stamp

VERDICT: PASS

Reviewer scope: logic errors, off-by-one, edge cases, spec compliance. All changed source and test files read in full; targeted unit suites (192 tests) and both integration suites (45 tests) executed in the worktree — all green.

## Spec traceability

Every Given/When/Then scenario in `spec.md` maps to implemented behavior and a test:

| Requirement | Scenario | Code | Test |
|---|---|---|---|
| install-stamps-installed-version | fresh install stamps | `src/cli/commands/install.ts:270` | `tests/cli-install.test.ts` "fresh install stamps..." |
| install-stamps-installed-version | re-install overwrites stale stamp | same (unconditional, after `wx` write at :264) | `tests/cli-install.test.ts` "re-running install overwrites..." |
| init-stamps-installed-version | init stamps / refreshes | `src/cli/commands/init.ts:37` (first stmt of try, after precondition guarantees config exists) | `tests/cli-version-drift.test.ts` "metta init on a stale-stamped project" |
| schema-accepts-installed-version | all 3 scenarios | `src/schemas/project-config.ts:117` `z.string().optional()` under `.strict()` | `tests/schemas.test.ts` (3 new cases, incl. path assertion on rejection) |
| invocation-time-drift-check | upgrade warns once on stderr | `src/cli/index.ts:133-149` | integration "emits exactly one stderr warning..." |
| invocation-time-drift-check | downgrade warns | `detectVersionDrift` is direction-blind (`!==` only) | unit `version-drift.test.ts` downgrade case |
| invocation-time-drift-check | match / absent stamp silent | `detectVersionDrift` returns null on `undefined` or equality | unit + integration "matching stamp" / "absent stamp" |
| invocation-time-drift-check | install/init skip + re-stamp | `DRIFT_CHECK_EXEMPT_COMMANDS` `src/cli/index.ts:119` | integration "re-stamping clears drift" (both commands) |
| invocation-time-drift-check | missing/corrupt config silent | `readInstalledVersion` whole-body try/catch, `src/config/version-drift.ts:30-40`; hook additionally wrapped | unit (5 tolerant-read cases) + integration corrupt-config case |
| invocation-time-drift-check | never changes exit codes | hook has no exit/throw escape | integration exit-0 baseline compare + exit-4 failing `--json` case |
| json-output-carries-mismatch | all 4 scenarios | `src/cli/helpers.ts:147-160` merge with null/object/array/existing-key guards | `tests/cli-helpers.test.ts` (4 cases) + integration JSON cases |
| doctor-template-freshness-check | pass / warn-mismatch / warn-missing | `templateFreshnessCheck` (`version-drift.ts:61-77`), pushed at `doctor.ts:99-105`; return type is pass-or-warn only, so it structurally cannot fail the run | integration doctor block (4 cases incl. corrupt config) |

## Focus-area verification

- **Never throws / never blocks:** `readInstalledVersion` wraps its entire body in try/catch; the preAction drift phase is additionally wrapped in its own try/catch (`index.ts:133-148`) and contains no `process.exit` or rethrow. Confirmed correct.
- **Exact-string edge cases:** empty-string stamp → drift (unit-tested); whitespace-differing stamp → drift by `!==`; both match the spec's "exact string inequality, no semver" mandate. `undefined` (absent) → null, correct. Non-string YAML values (number, scalar doc, null doc, array doc) → `undefined` via the type guards at `version-drift.ts:34-36`.
- **Two independent preAction phases:** `DRIFT_CHECK_EXEMPT_COMMANDS = {install, init}` at `index.ts:119` vs `CONFIG_PARSE_EXEMPT_COMMANDS = {install, init, doctor, update, completion}` at `index.ts:107-113`. Phase (a) runs before phase (b)'s early return, so doctor/update/completion get the drift check while keeping their parse exemption. Phase (b) is byte-identical to main. Verified in diff. No nested subcommand shares the leaf names `install`/`init` (grepped all `.command(` registrations), so the leaf-name gate is exact.
- **outputJson merge guards:** null-drift, null-data, non-object, array, and pre-existing-key guards all present (`helpers.ts:148-154`); merge is spread-then-append so no existing key is displaced; non-object payloads pass through untouched. All four guard paths unit-tested.
- **Stamp ordering:** install stamps at `install.ts:270`, immediately after the `wx` config write (file guaranteed to exist, so `setProjectField`'s ENOENT contract is satisfied) and before the `chore: initialize metta` commit block. init stamps only after the existence precondition (`init.ts:19-33`) exits 3 on missing config. Correct on both paths.
- **Doctor can never fail from this check:** `templateFreshnessCheck`'s return type excludes `'fail'`, and its inputs come from the never-throws reader plus `getPackageVersion` (already awaited by the pre-existing Framework version check). Confirmed.
- **`metta update` interplay:** update only upgrades the global binary and tells the user to run `metta install`; keeping update non-exempt from the drift check is correct — after an update, drift warns until install re-stamps.

## Findings

### Critical (must fix)
None.

### Major (should fix)
None.

### Minor (informational / accepted trade-offs)
1. `src/config/version-drift.ts:66` — On a corrupt config, doctor's freshness check reports "no installed_version stamp — run 'metta install' to stamp", but `metta install` on a corrupt config will itself fail at `stampInstalledVersion` (setProjectField parse error). The honest remedy in that state is `metta doctor --fix` first. Doctor's separate config-validity check surfaces the corruption, so the user is not stranded; message is merely slightly misleading in one unusual state.
2. `src/cli/commands/init.ts:37` / `src/cli/commands/install.ts:270` — Behavior change: install/init on a parse-corrupt pre-existing config now fail unconditionally (exit 4, `Failed to parse ...`) where init previously succeeded and install failed only when stack markers existed. Design §6/§10 explicitly accepts loud failure over a silently missing stamp; noted here because the propagated error message lacks the `doctor --fix` remedy hint.
3. Downgrade drift is covered only at unit level (`version-drift.test.ts`), not integration. Acceptable — direction-blindness is structural (`!==`), and the unit test locks it.
4. `src/cli/commands/update.ts:37,45` — the non-`--check` `--json` path calls `outputJson` twice, so a drifted project would emit `template_version_mismatch` in both stdout documents. The double-document emission is pre-existing behavior of update, not introduced by this change; the drift key merely rides along.

## Verdict

PASS — all five spec requirements and all 19 scenarios are implemented and traceable to passing tests; the isolation, ordering, and guard invariants called out in the design hold in the code as written.
