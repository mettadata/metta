# template-version-drift-detection-consumer-projects-stamp — Tasks

All paths are relative to the worktree root `/home/utx0/Code/metta/.metta/worktrees/template-version-drift-detection-consumer-projects-stamp`. Batches are sequential; tasks within a batch have disjoint file sets and may run in parallel. Design references are to `spec/changes/template-version-drift-detection-consumer-projects-stamp/design.md`.

## Batch 1 — Foundations (schema + drift module)

### Task 1.1: Add optional `installed_version` to ProjectConfigSchema
**Files:** `src/schemas/project-config.ts`, `tests/schemas.test.ts`
**Action:** Per design.md §8, add `installed_version: z.string().optional()` as the last top-level field of `ProjectConfigSchema` (the `.strict()` object at `src/schemas/project-config.ts:97-117`), after `models`. No other schema changes. Extend `tests/schemas.test.ts` with the three spec scenarios from requirement `project-config-schema-accepts-installed-version`: (a) a full valid project config plus `installed_version: "0.4.0"` parses and the parsed object exposes the string `"0.4.0"`; (b) a legacy config without the key parses and `installed_version` is absent (`undefined`) on the result; (c) a config with `installed_version: 4` fails validation with a Zod issue at path `['installed_version']`.
**Verify:** `npx vitest run tests/schemas.test.ts` and `npx tsc --noEmit`
**Done:** All three new schema test cases pass; typecheck clean; no existing schema tests broken.
**Commit:** `feat(schemas): accept optional installed_version in project config`

### Task 1.2: Create `src/config/version-drift.ts` module with unit tests
**Files:** `src/config/version-drift.ts` (new), `src/config/version-drift.test.ts` (new)
**Action:** Implement the module exactly as specified in design.md §2–§3:
- `interface VersionDrift { installed: string; running: string }`.
- `detectVersionDrift(installedVersion: string | undefined, runningVersion: string): VersionDrift | null` — pure; returns `null` when the stamp is `undefined` or when the strings are exactly equal; otherwise returns `{ installed, running }`. Exact string inequality, no semver logic.
- `readInstalledVersion(root: string): Promise<string | undefined>` — tolerant, never-throws raw read of `<root>/.metta/config.yaml` only (no ConfigLoader, no global/local layers, no env — ADR-1). Use the exact implementation shape from design.md §2 (whole body in one `try`, `catch { return undefined }`; `YAML.parse`; reject null/non-object/array documents; return the value only when `typeof value === 'string'`). Import `readFile` from `node:fs/promises`, `join` from `node:path`, `YAML` from `yaml`.
- `stampInstalledVersion(root: string, version: string): Promise<void>` — delegates to `setProjectField(root, ['installed_version'], version)` from `./config-writer.js`; propagates errors including ENOENT.
- `templateFreshnessCheck(installedVersion: string | undefined, runningVersion: string): { status: 'pass' | 'warn'; detail: string }` — match → `{ status: 'pass', detail: runningVersion }`; mismatch → `{ status: 'warn', detail: "installed ${i}, running ${r} — run 'metta install' to refresh" }`; missing stamp → `{ status: 'warn', detail: "no installed_version stamp — run 'metta install' to stamp" }`.
- Drift slot (design §3, ADR-2): module-scoped `let recordedDrift: VersionDrift | null = null` with `recordVersionDrift(drift)`, `getVersionDrift()`, `resetVersionDrift()`. Include the ADR-2 comment noting this is a documented, invocation-scoped exception to the no-singletons rule.
All imports use `.js` extensions (Node16 ESM). Write `src/config/version-drift.test.ts` co-located (matching `config-writer.test.ts` convention) covering the design §9 unit matrix: `detectVersionDrift` (match → null; upgrade mismatch; downgrade mismatch; undefined stamp → null; empty-string stamp vs version → drift); `templateFreshnessCheck` (pass with running-version detail; warn naming both versions; warn naming missing stamp); `readInstalledVersion` against `fs.mkdtemp` temp dirs (valid stamp → string; field absent → undefined; missing file → undefined; missing `.metta/` dir → undefined; corrupt YAML `foo: [unclosed` → undefined without throwing; `installed_version: 4` → undefined; YAML scalar document → undefined; ignores a stray `installed_version` written to a separate fake-global dir since the reader takes only `root`); `stampInstalledVersion` (fresh write parseable; overwrite of existing stamp; YAML comments preserved via `setProjectField`'s `parseDocument`; ENOENT rejection when config.yaml absent); slot (`beforeEach(resetVersionDrift)`; get-before-record → null; record → get returns it; reset → null).
**Verify:** `npx vitest run src/config/version-drift.test.ts` and `npx tsc --noEmit`
**Done:** Module exports all seven symbols with the design signatures; all unit tests pass; typecheck clean.
**Commit:** `feat(config): add version-drift module with tolerant reader, stamp writer, and drift slot`

## Batch 2 — Wiring (hook, JSON merge, doctor, stamping) — depends on Batch 1

### Task 2.1: Restructure `preAction` hook in `src/cli/index.ts` into two gated phases
**Files:** `src/cli/index.ts`
**Action:** Per design.md §4. Add imports of `readInstalledVersion`, `detectVersionDrift`, `recordVersionDrift` from `'../config/version-drift.js'`. Add `const DRIFT_CHECK_EXEMPT_COMMANDS = new Set(['install', 'init'])` near `CONFIG_PARSE_EXEMPT_COMMANDS` (index.ts:102-108) with a comment stating the two gates are independent sets and must never be re-merged (design §10). Restructure the hook at index.ts:115-129 to the exact two-phase shape in design §4: phase (a) — when the leaf command name is not in `DRIFT_CHECK_EXEMPT_COMMANDS`, inside a `try { ... } catch { /* advisory */ }`, call `readInstalledVersion(process.cwd())`, `await getPackageVersion()`, `detectVersionDrift(...)`; on drift, `recordVersionDrift(drift)` then `process.stderr.write(` + "`Warning: metta assets were installed by v${drift.installed} but you are running v${drift.running} — run 'metta install' to refresh.\n`" + `)`. Phase (a) runs before phase (b) and must not gate on `--json` (ADR-4), must never write stdout, and must never alter control flow or exit codes. Phase (b) — the existing `ConfigParseError` fail-fast — is preserved byte-for-byte in behavior: same `CONFIG_PARSE_EXEMPT_COMMANDS` early return, same `ConfigLoader`/`handleError` routing, same comments. Do not add unit tests in this task; hook behavior is covered by the Batch 3 integration suite (design §9) — index.ts has no co-located test file today and the fail-fast is already exercised by existing propose/status integration tests.
**Verify:** `npx tsc --noEmit && npx vitest run tests/cli-status.test.ts tests/cli-propose.test.ts` (fail-fast regression guard)
**Done:** Typecheck clean; existing status/propose integration tests pass unchanged, proving the fail-fast phase regressed nothing; drift phase compiles with the exact exempt set `{install, init}`.
**Commit:** `feat(cli): emit version-drift warning in preAction hook for all commands except install/init`

### Task 2.2: Merge `template_version_mismatch` into `outputJson` in `src/cli/helpers.ts`
**Files:** `src/cli/helpers.ts`, `tests/cli-helpers.test.ts`
**Action:** Per design.md §5. Import `getVersionDrift` from `'../config/version-drift.js'`. Replace the `outputJson` body (helpers.ts:146-148) with the design §5 implementation: read the slot; when drift is non-null AND `data` is a non-null, non-array object AND does not already contain a `template_version_mismatch` key, spread `data` and append `template_version_mismatch: { installed: drift.installed, running: drift.running }`; then `console.log(JSON.stringify(data, null, 2))` as before. Arrays and primitives pass through untouched; when the slot is null the payload is byte-identical to today. Extend `tests/cli-helpers.test.ts` with `outputJson` merge cases using a spied `console.log` and `resetVersionDrift` in `beforeEach`/`afterEach` (design §9): key appended when drift recorded; key absent when slot empty; array payload untouched even with drift recorded; a payload that already carries `template_version_mismatch` is not displaced.
**Verify:** `npx vitest run tests/cli-helpers.test.ts` and `npx tsc --noEmit`
**Done:** All four merge behaviors covered by passing tests; no existing helpers tests broken; typecheck clean.
**Commit:** `feat(cli): merge template_version_mismatch drift signal into --json payloads`

### Task 2.3: Add "Template freshness" check to `src/cli/commands/doctor.ts`
**Files:** `src/cli/commands/doctor.ts`
**Action:** Per design.md §7. Import `readInstalledVersion` and `templateFreshnessCheck` from `'../../config/version-drift.js'` (`getPackageVersion` is already imported). In the checks array construction (doctor.ts:84-142), hoist the inline `await getPackageVersion()` from the "Framework version" check (line 96) into `const runningVersion = await getPackageVersion()`, use it for that check, then immediately after push `{ check: 'Template freshness', ...templateFreshnessCheck(await readInstalledVersion(ctx.projectRoot), runningVersion) }` with the design comment noting it is a pure comparison over a tolerant read and can never error the doctor run. Do not touch the rendering loop (doctor.ts:147-151), the `outputJson({ checks })` call, or the fail-count summary — the new check's status is only ever `pass`/`warn` so it cannot affect the issue count. Behavioral tests for pass/warn/missing-stamp/corrupt-config land in the Batch 3 integration suite (design §9 places doctor coverage there; no dedicated doctor test file exists).
**Verify:** `npx tsc --noEmit` and `npx vitest run tests/cli-install.test.ts` (nearest suite exercising install/doctor context; full doctor scenarios verified in Batch 3)
**Done:** Typecheck clean; doctor builds the checks array with "Template freshness" directly after "Framework version"; no rendering or summary changes.
**Commit:** `feat(doctor): add Template freshness check comparing stamped vs running version`

### Task 2.4: Stamp `installed_version` in `metta install`
**Files:** `src/cli/commands/install.ts`, `tests/cli-install.test.ts`
**Action:** Per design.md §6. In `src/cli/commands/install.ts`: import `stampInstalledVersion` from `'../../config/version-drift.js'` and add `getPackageVersion` to the existing helpers import. Immediately after the `writeFile(..., { flag: 'wx' }).catch(() => {})` config-create block (install.ts:263-265), insert unconditionally: `await stampInstalledVersion(root, await getPackageVersion())` with the design comment ("Always re-stamp — re-running install after an upgrade/downgrade is the documented way to clear drift."). Placement must be before the `git add .metta/ spec/` commit block (install.ts:388-399) so the stamp lands in the `chore: initialize metta` commit. Do not add any try/catch — errors propagate to install's existing outer catch (exit 4, design §6/§10). Extend `tests/cli-install.test.ts`: (a) fresh install writes `installed_version` equal to the version in `package.json` and the resulting config parses under `ProjectConfigSchema`; (b) re-running install over a config pre-seeded with `installed_version: "0.0.0-stale"` overwrites it with the running version.
**Verify:** `npx vitest run tests/cli-install.test.ts` and `npx tsc --noEmit`
**Done:** Both new install-stamping tests pass; existing install tests unchanged; typecheck clean.
**Commit:** `feat(install): stamp running package version into installed_version on every run`

### Task 2.5: Stamp `installed_version` in `metta init`
**Files:** `src/cli/commands/init.ts`
**Action:** Per design.md §6. In `src/cli/commands/init.ts`: import `stampInstalledVersion` from `'../../config/version-drift.js'` and `getPackageVersion` from the helpers module (add to existing import if present). Insert as the first statement inside the existing `try` block (init.ts:34), before `detectBrownfield`: `await stampInstalledVersion(root, await getPackageVersion())` with the comment "Re-stamp the running binary version (same overwrite semantics as install)." The precondition check (init.ts:18-32) guarantees `.metta/config.yaml` exists, satisfying `setProjectField`'s ENOENT contract; errors propagate to init's existing catch (exit 4). No try/catch around the stamp. Init-stamping behavioral tests (stamp written, stale stamp refreshed) land in `tests/cli-version-drift.test.ts` in Batch 3 per design §9 — do not create that file here (it belongs to Task 3.1's file set).
**Verify:** `npx tsc --noEmit && npx vitest run tests/skill-structure-metta-init.test.ts`
**Done:** Typecheck clean; stamp call is the first statement of init's try block; existing init-related tests pass.
**Commit:** `feat(init): re-stamp installed_version on every init run`

## Batch 3 — Integration tests and full gates — depends on Batch 2

### Task 3.1: End-to-end drift integration suite `tests/cli-version-drift.test.ts`
**Files:** `tests/cli-version-drift.test.ts` (new)
**Action:** New integration suite using the `runCli` subprocess helper from `tests/helpers/cli.ts` (fresh process per invocation, so the drift slot resets for free — design §3). Force drift by writing `installed_version: "0.0.0-drift-test"` into a temp project's `.metta/config.yaml`; force a match by stamping the real `package.json` version. Cover the design §9 integration matrix:
- Drifted project + `metta status`: exactly one stderr line naming both `0.0.0-drift-test` and the running version; stdout unaffected; exit code unchanged from the non-drifted baseline.
- Drifted project + a `--json` command: stdout parses as a single well-formed JSON document containing `template_version_mismatch: { installed, running }` alongside the command's normal payload keys; the warning appears only on stderr.
- Matching stamp, absent stamp, and corrupt-YAML config: no stderr warning, no `template_version_mismatch` key in `--json`, normal behavior and exit codes (corrupt config for a non-exempt command still fails with the existing `ConfigParseError` remedy and no drift warning preceding it).
- Drifted project + `metta install`, then any subsequent command: no warning — re-stamp cleared drift (also covers the install-exemption scenario); same refresh assertion after `metta init` on a stale-stamped project (covers init stamping per Task 2.5's deferred coverage).
- Drifted project + a failing `--json` command: the JSON error payload carries `template_version_mismatch` (ADR-3 lock-in).
- Doctor scenarios (design §9 doctor coverage): "Template freshness" reports pass on match; warn naming both versions on mismatch; warn indicating a missing stamp on a legacy config with doctor completing normally and all other checks (including "Framework version") intact; corrupt config → doctor still runs and freshness warns.
Follow the structure/idioms of an existing subprocess suite such as `tests/cli-status.test.ts` or `tests/cli-install.test.ts` (temp dir setup, git init where required).
**Verify:** `npx vitest run tests/cli-version-drift.test.ts`
**Done:** All integration scenarios above pass in the new suite.
**Commit:** `test(cli): add end-to-end version-drift integration suite`

### Task 3.2: Full gate run
**Files:** none (verification only; fix-forward edits allowed only for regressions surfaced by the gates, in whichever file regressed)
**Action:** Run the full project gates over the completed change: complete unit + integration test suite and strict typecheck. Investigate and fix any failure caused by this change (e.g. a snapshot or fixture config that now needs `installed_version`, or a test asserting exact doctor check counts — design §7 notes the check count shifts by one). Do not modify unrelated failing tests without flagging them.
**Verify:** `npm test && npx tsc --noEmit`
**Done:** Full test suite green and typecheck clean on the worktree.
**Commit:** `test(cli): green full suite for version-drift change` (only if fixes were needed; otherwise no commit)
