# Design — template-version-drift-detection-consumer-projects-stamp

## 1. Overview

Version drift detection is implemented as a functional-core/imperative-shell split: a new dedicated module `src/config/version-drift.ts` holds a pure comparison function, a pure doctor-freshness function, a tolerant never-throws reader scoped to the *project* `.metta/config.yaml` only, a stamp writer that wraps the existing validated `setProjectField` path, and a single explicit process-lifetime drift slot. The restructured global `preAction` hook in `src/cli/index.ts` calls the reader + comparator on every command except `install`/`init` (before the existing `ConfigParseError` fail-fast, which is preserved byte-for-byte in behavior), emits the one-line stderr warning, and records the mismatch in the slot; `outputJson` in `src/cli/helpers.ts` merges the recorded mismatch into `--json` payloads as `template_version_mismatch`. `install`/`init` call `stampInstalledVersion` unconditionally, and `doctor` gains a "Template freshness" check. This is the research recommendation (Approach B as the factoring, Approach A as the call site — `research.md` Recommendation section) and satisfies all five spec requirements in `spec.md`.

## 2. New module: `src/config/version-drift.ts`

Lands next to `config-loader.ts`, `config-writer.ts`, and `repair-config.ts` with a co-located test file (matching `src/config/config-writer.test.ts` / `src/config/repair-config.test.ts`).

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import { setProjectField } from './config-writer.js'

/** A detected mismatch between the stamped and running versions. */
export interface VersionDrift {
  installed: string
  running: string
}

/**
 * Pure. Exact string inequality — no semver logic (spec: invocation-time-drift-check).
 * Returns null when the stamp is absent (legacy install) or when versions match.
 */
export function detectVersionDrift(
  installedVersion: string | undefined,
  runningVersion: string,
): VersionDrift | null

/**
 * Tolerant reader — never throws. Reads ONLY <root>/.metta/config.yaml raw
 * (no ConfigLoader: no global ~/.metta/config.yaml layer, no local.yaml, no
 * METTA_* env overrides — see ADR-1). Returns the top-level installed_version
 * when it is a string; returns undefined on missing file, unreadable file,
 * unparseable YAML, non-object document, absent field, or non-string value.
 */
export async function readInstalledVersion(root: string): Promise<string | undefined>

/**
 * Imperative shell. Writes the top-level installed_version field via the
 * validated, comment-preserving setProjectField path:
 *   setProjectField(root, ['installed_version'], version)
 * Propagates errors (including ENOENT when config.yaml does not exist) to the
 * caller — install/init own their error handling.
 */
export async function stampInstalledVersion(root: string, version: string): Promise<void>

/**
 * Pure. Doctor semantics differ from the invocation check: a MISSING stamp
 * warns here but stays silent at invocation time (spec: doctor-template-
 * freshness-check vs invocation-time-drift-check) — which is why this is a
 * separate function rather than doctor reusing detectVersionDrift.
 *   match    → { status: 'pass', detail: runningVersion }
 *   mismatch → { status: 'warn', detail: `installed ${i}, running ${r} — run 'metta install' to refresh` }
 *   missing  → { status: 'warn', detail: `no installed_version stamp — run 'metta install' to stamp` }
 */
export function templateFreshnessCheck(
  installedVersion: string | undefined,
  runningVersion: string,
): { status: 'pass' | 'warn'; detail: string }

// --- drift slot (see §3) ---
export function recordVersionDrift(drift: VersionDrift): void
export function getVersionDrift(): VersionDrift | null
export function resetVersionDrift(): void
```

`readInstalledVersion` implementation shape (whole body inside one `try`; `catch { return undefined }`):

```ts
export async function readInstalledVersion(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(root, '.metta', 'config.yaml'), 'utf8')
    const doc: unknown = YAML.parse(raw)
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return undefined
    const value = (doc as Record<string, unknown>).installed_version
    return typeof value === 'string' ? value : undefined
  } catch {
    return undefined
  }
}
```

It deliberately does not reuse `loadYamlFile` from `config-loader.ts` — that helper throws `ConfigParseError` on bad YAML (`config-loader.ts:63-67`), and the drift reader must never throw.

## 3. Drift state slot

A single module-scoped variable in `version-drift.ts`:

```ts
let recordedDrift: VersionDrift | null = null

export function recordVersionDrift(drift: VersionDrift): void { recordedDrift = drift }
export function getVersionDrift(): VersionDrift | null { return recordedDrift }
export function resetVersionDrift(): void { recordedDrift = null }
```

**Why this is acceptable under the "no singletons" constitution rule** (documented as a deliberate, scoped exception — ADR-2):

- Commander's `preAction` hook has no data channel to action handlers, and `outputJson` has ~150+ call sites across the CLI (research Approach C findings) — threading a parameter through every command is impractical and would be a far larger blast radius.
- One process = one CLI invocation. The slot is written at most once (in the hook, before any action runs) and read at most once per output call. There is no shared-service lifetime, no lazy global construction, no cross-request state — it is invocation-scoped state that happens to live at module scope because the process *is* the invocation.
- The state is confined to exactly one file with an explicit, named `record/get/reset` API — not an exported mutable, not a class instance held globally.

**Test reset:** unit tests call `resetVersionDrift()` in `beforeEach`. Integration tests need nothing: the existing harness (`tests/helpers/cli.ts` `runCli`) spawns a fresh `npx tsx src/cli/index.ts` subprocess per invocation, so module state resets for free.

## 4. `preAction` hook restructuring in `src/cli/index.ts`

**Current structure (the critical constraint):** the hook at `index.ts:115-129` early-returns at line 117 (`if (CONFIG_PARSE_EXEMPT_COMMANDS.has(name)) return`) *before* the `ConfigLoader` is instantiated. `CONFIG_PARSE_EXEMPT_COMMANDS` (`index.ts:102-108`) is `{install, init, doctor, update, completion}`. The spec requires the drift check on every command except `install`/`init` — so `doctor`, `update`, and `completion` must get the drift check while keeping their config-parse exemption. The hook must therefore be split into two independently-gated phases.

New hook:

```ts
// Drift check is skipped only for the commands that re-stamp.
const DRIFT_CHECK_EXEMPT_COMMANDS = new Set(['install', 'init'])

program.hook('preAction', async (_thisCommand, actionCommand) => {
  const name = actionCommand.name()

  // Phase (a): version drift check — every command except install/init.
  // Fully isolated: readInstalledVersion never throws by contract, and the
  // whole phase is additionally wrapped so a drift-check bug can never break
  // a CLI invocation (spec: "MUST silently skip ... never break a CLI
  // invocation"). Runs BEFORE the fail-fast so drifted-but-corrupt projects
  // still fail with the existing ConfigParseError remedy, not a drift error.
  if (!DRIFT_CHECK_EXEMPT_COMMANDS.has(name)) {
    try {
      const installed = await readInstalledVersion(process.cwd())
      const running = await getPackageVersion()
      const drift = detectVersionDrift(installed, running)
      if (drift) {
        recordVersionDrift(drift)
        process.stderr.write(
          `Warning: metta assets were installed by v${drift.installed} but you are running v${drift.running} — run 'metta install' to refresh.\n`,
        )
      }
    } catch {
      // Drift detection is advisory; never surface its failures.
    }
  }

  // Phase (b): existing ConfigParseError fail-fast — UNCHANGED.
  if (CONFIG_PARSE_EXEMPT_COMMANDS.has(name)) return
  const json = program.opts().json ?? false
  const loader = new ConfigLoader(process.cwd())
  try {
    await loader.load()
  } catch (err) {
    if (err instanceof ConfigParseError) {
      handleError(err, json)
    }
    // Non-parse errors (e.g. schema validation) belong to the individual
    // command's own error handling — let them through.
  }
})
```

Imports added to `index.ts`: `readInstalledVersion`, `detectVersionDrift`, `recordVersionDrift` from `'../config/version-drift.js'` (`.js` extension per Node16 ESM convention).

**Ordering and isolation guarantees:**

- Phase (a) runs first so drift is recorded even when phase (b) subsequently `process.exit(4)`s via `handleError` — but on a corrupt config `readInstalledVersion` returns `undefined`, so no drift is recorded and no warning precedes the parse error. The two phases cannot interleave badly.
- The load-bearing fail-fast (comment block `index.ts:110-114`) keeps its exact gating (`CONFIG_PARSE_EXEMPT_COMMANDS`), its exact error routing (`handleError`), and its exact exemption comment semantics. No regression surface.
- **Warning is emitted to stderr unconditionally, including under `--json`** (ADR-4). The spec mandates the warning in human mode and, for JSON mode, only requires that stdout remain a single well-formed JSON document ("stderr warning does not corrupt stdout JSON" scenario). `process.stderr.write` never touches stdout, so JSON cleanliness holds without gating on the `--json` flag — simpler, and machine callers get both signals.
- Exit codes: the hook changes no control flow on drift (no `process.exit`, no throw escapes the `try`), satisfying the "drift never changes exit codes" scenario.
- Subcommand note: `actionCommand.name()` returns the leaf name (e.g. `add` for `metta backlog add`); `install` and `init` are top-level leaf commands, so the exemption gate is exact.
- Cost: one extra `readFile` of a small YAML per invocation, in addition to the loader's read in phase (b). Accepted — see §10.

## 5. `outputJson` merge in `src/cli/helpers.ts`

Current implementation (`helpers.ts:146-148`) is a bare `console.log(JSON.stringify(data, null, 2))`. New:

```ts
import { getVersionDrift } from '../config/version-drift.js'

export function outputJson(data: unknown): void {
  const drift = getVersionDrift()
  if (
    drift !== null &&
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    !('template_version_mismatch' in data)
  ) {
    data = {
      ...data,
      template_version_mismatch: { installed: drift.installed, running: drift.running },
    }
  }
  console.log(JSON.stringify(data, null, 2))
}
```

Properties:

- **Absent when no drift**: slot is `null` → payload passes through untouched, key entirely absent (spec scenarios "no mismatch means no key", "absent stamp means no key").
- **Never displaces existing keys**: spread-then-append means every original key survives; the `'template_version_mismatch' in data` guard makes the merge a no-op in the (never-expected) case a command already emitted that key.
- Non-object payloads (arrays, primitives) pass through unchanged — the key only merges into plain-object payloads, which is every real call site.
- **Error payloads: yes, the field appears** (ADR-3). `handleError` routes its JSON error envelopes through `outputJson` (`helpers.ts:159-167` and `176`), so a `--json` command that fails on a drifted project reports both the error and `template_version_mismatch`. The spec is silent here; consistency wins — a CI consumer diagnosing a failure benefits most from the drift signal. No extra code needed; it falls out of the single merge point.
- Import direction is clean: `cli/helpers.ts → config/version-drift.ts` matches the existing `cli → config` dependency (helpers already imports `ConfigLoader` at `helpers.ts:6`).

## 6. Stamping call sites

Both call sites import `stampInstalledVersion` from `'../../config/version-drift.js'` and `getPackageVersion` (already exported from `helpers.ts:387`; `install.ts` must add it to its helpers import — `doctor.ts` already imports it).

**`src/cli/commands/install.ts`** — the config is created at `install.ts:263-265` with `writeFile(..., { flag: 'wx' }).catch(() => {})`, i.e. EEXIST is swallowed and a pre-existing config is left untouched. The stamp therefore CANNOT ride on that write. Insert immediately after that block, unconditionally:

```ts
// Stamp the running binary version. Always re-stamp — re-running install
// after an upgrade/downgrade is the documented way to clear drift.
await stampInstalledVersion(root, await getPackageVersion())
```

- Runs on both the fresh-create path and the config-already-exists path (spec: "The write MUST occur on every run of `metta install`").
- `setProjectField` requires the file to exist (`config-writer.ts:9` — "Does NOT auto-create ... ENOENT is propagated"); after line 263 the file always exists, so ENOENT is impossible here.
- Placed before the `git add .metta/ spec/` + commit block (`install.ts:388-399`) so the stamp lands in the `chore: initialize metta` commit.
- Errors propagate to install's existing outer `catch` (`install.ts:453-461`) → `install_error`, exit 4. A corrupt pre-existing config already fails install the same way via `writeStacksToConfig` → `setProjectField` (`install.ts:170`, `311`); the remedy is `metta doctor --fix`. Failing loudly is correct — a silently-skipped stamp would permanently disable drift detection.

**`src/cli/commands/init.ts`** — init never writes the config today; its precondition check (`init.ts:18-32`) exits 3 unless `.metta/config.yaml` exists, so `setProjectField`'s ENOENT contract is satisfied. Insert as the first statement of the existing `try` block (`init.ts:34`), before `detectBrownfield`:

```ts
try {
  // Re-stamp the running binary version (same overwrite semantics as install).
  await stampInstalledVersion(root, await getPackageVersion())

  const { isBrownfield, detectedStack, detectedDirs } = await detectBrownfield(root, options.skipScan)
  ...
```

Errors propagate to init's existing `catch` (`init.ts:51-59`) → `init_error`, exit 4.

## 7. Doctor check

In `src/cli/commands/doctor.ts`, the checks array is built at `doctor.ts:84-142`. The "Framework version" check at line 96 currently inlines `await getPackageVersion()`; hoist it and insert "Template freshness" immediately after:

```ts
// Framework version
const runningVersion = await getPackageVersion()
checks.push({ check: 'Framework version', status: 'pass', detail: runningVersion })

// Template freshness — stamped installed_version vs running binary.
// Pure comparison over a tolerant read: cannot throw, so it can never
// error the doctor run (spec: doctor-template-freshness-check).
const installedVersion = await readInstalledVersion(ctx.projectRoot)
checks.push({ check: 'Template freshness', ...templateFreshnessCheck(installedVersion, runningVersion) })
```

- `doctor` is config-parse exempt (`index.ts:105`) and must work on corrupt configs — `readInstalledVersion`'s never-throws contract makes this safe (corrupt YAML → `undefined` → warn "no installed_version stamp", which is the honest diagnostic).
- Status is only ever `pass` or `warn` (function return type), so the new check can never contribute to the `fail` count that drives doctor's "`N issue(s) found`" summary (`doctor.ts:152-157`); it shifts the check count by exactly one entry as the intent's impact section anticipates.
- Rendering (icon, detail-in-parens) reuses the existing loop at `doctor.ts:147-151` unchanged; `--json` output reuses `outputJson({ checks })` at line 145 (which will also carry `template_version_mismatch` when drifted — consistent, since doctor is not drift-exempt).

## 8. Schema change

`ProjectConfigSchema` (`src/schemas/project-config.ts:97-117`) is `.strict()`, so the field must be declared or stamped configs would be rejected on every `ConfigLoader.load()` — schema and stamping ship in the same change (intent impact statement). Add one line at the top level:

```ts
export const ProjectConfigSchema = z.object({
  project: ProjectInfoSchema.optional(),
  ...
  models: ModelsConfigSchema,
  installed_version: z.string().optional(),
}).strict()
```

- Optional → legacy configs without the field remain valid (spec scenario "legacy config without the field remains valid").
- `z.string()` → `installed_version: 4` fails validation (spec scenario "non-string stamp is rejected").
- Env-override interplay: `METTA_INSTALLED_VERSION=x` would inject the key via `applyEnvOverrides` (`config-loader.ts:70-105`), but only into `ConfigLoader.load()`'s merged view — the drift reader reads the raw project file and is immune, so env vars cannot fabricate or mask drift.

## 9. Test plan

Near-1:1 test-to-source convention: one new source file → one new co-located unit test file, plus additions to the existing integration/schema suites.

**New: `src/config/version-drift.test.ts`** (co-located, matching `config-writer.test.ts` / `repair-config.test.ts`):
- `detectVersionDrift`: match → null; mismatch (upgrade) → `{installed, running}`; mismatch (downgrade) → same; `undefined` stamp → null; empty-string stamp vs version → drift (exact inequality).
- `templateFreshnessCheck`: match → pass with running version detail; mismatch → warn naming both versions; `undefined` → warn naming the missing stamp.
- `readInstalledVersion` against temp dirs (`fs.mkdtemp`): valid stamp → string; config without the field → undefined; missing file → undefined; missing `.metta/` dir → undefined; corrupt YAML (`foo: [unclosed`) → undefined, no throw; non-string value (`installed_version: 4`) → undefined; YAML scalar document → undefined. Assert it ignores a stray `installed_version` in a fake global dir (reader takes only `root`).
- `stampInstalledVersion`: fresh write → field present and parseable; overwrite of existing stamp; comments in config.yaml preserved (via `setProjectField`'s `parseDocument`); ENOENT propagates when config.yaml absent.
- Slot: `beforeEach(resetVersionDrift)`; record → get returns it; reset → null; get before record → null.

**Extend `tests/schemas.test.ts`**: the three schema scenarios from `spec.md` — full config + `installed_version: "0.4.0"` parses and exposes the string; legacy config without the field parses with the key absent; `installed_version: 4` rejected with a type issue at path `['installed_version']`.

**New: `tests/cli-version-drift.test.ts`** (integration via `runCli` subprocess helper — fresh module state per invocation, drift forced by writing `installed_version: "0.0.0-drift-test"` into the temp project's config, match forced by stamping the real package.json version):
- Drifted project + `metta status`: exactly one warning line on stderr naming both versions; stdout unaffected; exit code unchanged.
- Drifted project + `--json`: stdout parses as a single JSON document containing `template_version_mismatch: { installed, running }` alongside normal payload keys; warning only on stderr.
- Matching stamp / absent stamp / corrupt config: no warning, no JSON key, normal behavior.
- Drifted project + `metta install` then any command: no warning (re-stamp cleared it) — also covers the install-exemption scenario.
- Drifted project + failing `--json` command: error payload carries `template_version_mismatch` (ADR-3 lock-in).

**Extend `tests/cli-install.test.ts`**: fresh install writes `installed_version` equal to package.json version and the config passes `ProjectConfigSchema`; re-install over a stale stamp overwrites it. Init stamping covered in `tests/cli-version-drift.test.ts` or the existing init suite (stamp written, stale stamp refreshed).

**Doctor coverage** (extend the existing doctor test or add cases to `tests/cli-version-drift.test.ts`): "Template freshness" pass on match; warn naming both versions on mismatch; warn on missing stamp with doctor completing normally and other checks intact; corrupt config → doctor still runs, freshness warns.

**Extend `tests/cli-helpers.test.ts`**: `outputJson` merge behavior with a spied `console.log` — key appended when drift recorded, absent when not, array payload untouched, pre-existing `template_version_mismatch` key not displaced (with `resetVersionDrift` in `beforeEach`/`afterEach`).

## 10. Risks & edge cases

- **Corrupt YAML / missing config**: `readInstalledVersion` returns `undefined` → silent skip; the existing `ConfigParseError` fail-fast still fires afterward for non-exempt commands with its unchanged remedy. Covered by contract + tests.
- **Legacy configs (no stamp)**: `detectVersionDrift(undefined, running)` → null; zero behavior change until the next install/init. Doctor is the only surface that mentions the missing stamp.
- **Downgrade**: exact string inequality is direction-blind — warns identically. Intentional (spec + out-of-scope: no semver logic).
- **Fail-fast regression risk**: highest-consequence risk in this change. Mitigated by keeping phase (b) textually identical, gated by the untouched `CONFIG_PARSE_EXEMPT_COMMANDS`, and by existing propose/status tests that exercise the corrupt-config path.
- **Exempt-command interplay**: `doctor`/`update`/`completion` gain the drift check (spec requires it) while retaining config-parse exemption — the two gates are now independent sets and must never be re-merged. The `DRIFT_CHECK_EXEMPT_COMMANDS` set carries a comment stating this.
- **stderr vs stdout JSON cleanliness**: warning uses `process.stderr.write` only; `outputJson` remains the sole stdout writer for JSON payloads. Scripts that parse stderr may observe a new line on any drifted command (flagged in intent impact; advisory-only).
- **Double config read cost**: non-exempt commands read `.metta/config.yaml` twice per invocation (tolerant raw read + `ConfigLoader.load`). One extra small-file read per process; accepted in exchange for immunity to the global/local layer-merge false-drift problem (a stray `installed_version` in `~/.metta/config.yaml` or `local.yaml` can never trigger or mask a warning).
- **Old binary + `doctor --fix` on a new-stamped config**: a pre-stamping binary's `repairProjectConfig` would treat `installed_version` as a schema-invalid key and strip it, silently erasing the stamp until the next install/init. Accepted — bounded to one unusual downgrade path, and re-stamping restores it.
- **Stamp write failure in install/init**: propagates to each command's existing catch → exit 4. Loud failure preferred over a silently missing stamp (a corrupt config is already fatal to install via `writeStacksToConfig` on the stack-detection path).
- **JSON consumers with strict payload parsers**: `template_version_mismatch` is additive; consumers rejecting unknown keys would need to tolerate it (flagged in intent impact).

## ADRs

**ADR-1 — Dedicated tolerant reader instead of reusing `ConfigLoader`.** `ConfigLoader.load()` merges global (`~/.metta/config.yaml`), project, local, and env layers (`config-loader.ts:126-141`) and throws `ConfigParseError`. The drift stamp is a project-scoped fact; a merged read could fabricate drift from a non-project layer, and the throw violates the never-break contract. A ~10-line raw read of the single project file is simpler and exactly scoped. Trade-off: one duplicate file read per invocation (accepted, §10).

**ADR-2 — Module-scoped drift slot with explicit `record/get/reset`.** Chosen over parameter-threading (150+ `outputJson` call sites) and over Commander context smuggling (no supported channel from `preAction` to actions). Documented exception to the no-singletons rule: invocation-scoped state in a run-once CLI process, confined to one file, write-once, explicitly resettable. Not a service locator, not lazily-constructed shared infrastructure.

**ADR-3 — `template_version_mismatch` appears on `--json` error payloads too.** `handleError` already routes through `outputJson`, so consistency costs zero code; the drift signal is most valuable exactly when a command fails mysteriously on a drifted project. Spec is silent; this is the strictly-more-informative choice.

**ADR-4 — stderr warning emitted unconditionally (not gated on `--json`).** The spec's only JSON-mode constraint is stdout cleanliness, which stderr writes satisfy by construction. Gating on `--json` would add a flag read in the hook for no requirement.

**Lock-in check:** no new dependencies, no vendor coupling — node stdlib + the already-vendored `yaml` package and existing `setProjectField` write path.
