# Research: Dedicated pure drift module (`src/config/version-drift.ts`)

## Approach summary

Add one new file, `src/config/version-drift.ts`, holding the entire drift *decision* as pure logic, plus a tolerant I/O wrapper that never throws. Three call sites consume it:

1. **preAction hook** (`src/cli/index.ts`) — reads the raw project config, calls the pure detector, emits the one-line stderr warning, and records the result so `outputJson` (`src/cli/helpers.ts`) can merge `template_version_mismatch` into the payload.
2. **doctor** (`src/cli/commands/doctor.ts`) — calls the same pure detector to produce the "Template freshness" check (pass / warn-mismatch / warn-missing).
3. **install/init** — call a `stampInstalledVersion(root, version)` helper that wraps the existing `setProjectField` write path (`src/config/config-writer.ts`).

This matches the project's "functional core, imperative shell" convention: comparison and message-shaping are pure; file reads, stderr writes, and the stamp write stay at the edges.

## How it works (proposed module API)

```ts
// src/config/version-drift.ts

export interface VersionDrift {
  installed: string
  running: string
}

/**
 * Pure core. Accepts the raw (unvalidated) parsed YAML of .metta/config.yaml.
 * Returns null when: config is not a plain object, installed_version is
 * absent or not a string, or versions are exactly equal. Exact string
 * inequality only — no semver logic (per spec).
 */
export function detectVersionDrift(rawConfig: unknown, runningVersion: string): VersionDrift | null

/**
 * Tolerant imperative wrapper: reads <root>/.metta/config.yaml directly
 * (single file — deliberately NOT the layered ConfigLoader merge, so a
 * global ~/.metta/config.yaml can never contaminate the project stamp),
 * YAML-parses it, and returns detectVersionDrift(...). Returns null on
 * ENOENT, unreadable file, or YAML parse error. Never throws.
 */
export function readVersionDrift(root: string, runningVersion: string): Promise<VersionDrift | null>

/** Wraps setProjectField(root, ['installed_version'], version). */
export function stampInstalledVersion(root: string, version: string): Promise<void>
```

Wiring details:

- **preAction** (`src/cli/index.ts`): after the existing `CONFIG_PARSE_EXEMPT_COMMANDS` logic, gate on `name !== 'install' && name !== 'init'`, then `const drift = await readVersionDrift(process.cwd(), version)`. On drift: `process.stderr.write(...)` once (stderr only — never stdout, so `--json` stdout stays a single well-formed document) and hand the result to helpers via a small explicit setter, e.g. `setDetectedDrift(drift)` exported from `helpers.ts`. The whole call is additionally wrapped in try/catch-ignore so a bug in the drift path can never change a command's exit code (spec: "a drift-check failure MUST never break a CLI invocation").
- **`outputJson` merge** (`src/cli/helpers.ts`): `outputJson` checks the recorded drift; when present *and* `data` is a plain non-array object, it adds `template_version_mismatch: { installed, running }` to the emitted document as an added key only (never displacing existing fields — if a command ever emits its own `template_version_mismatch`, the command's value wins via a presence check). When `data` is an array or a primitive, the merge is skipped (no such command exists today; documented as a known edge). Whether error payloads from `handleError` also carry the key is a one-line decision — recommend yes-by-default since the spec keys the merge on "the command runs with `--json`", and it costs nothing.
- **doctor** (`src/cli/commands/doctor.ts`): doctor is in `CONFIG_PARSE_EXEMPT_COMMANDS`, so it never gets the preAction result — it calls `readVersionDrift` itself and additionally needs the *missing-stamp* distinction (warn, not silent). Cleanest form: a second tiny pure helper `templateFreshnessCheck(rawConfig: unknown, runningVersion: string): { status: 'pass' | 'warn'; detail: string }` in the same module, so both the tri-state doctor semantics and the binary drift semantics live beside each other and share the same `installed_version` extraction. Doctor pushes the result into its existing `checks` array — no structural change to doctor.
- **install/init**: one `await stampInstalledVersion(ctx.projectRoot, await getPackageVersion())` call each, placed after the config file exists (`setProjectField` propagates ENOENT by design, and install creates the file first).
- **Schema**: `installed_version: z.string().optional()` added to `ProjectConfigSchema` — independent of this module, required regardless of approach.

## Pros

- **Direct fit with stated conventions.** "Functional core, imperative shell" is a checked-in project convention; `detectVersionDrift` is a textbook functional core (data in, decision out), and all I/O (file read, stderr, stamp write) stays in thin wrappers/callers.
- **Single source of truth for the comparison.** preAction, doctor, and the JSON surface all derive from one pure function, so the spec's "exact string inequality, no direction awareness" rule is implemented exactly once. A future change (e.g. semver-aware comparison, currently out of scope) touches one file.
- **Failure isolation is structural, not incidental.** The spec's hardest requirement — "silently skip when config is missing, corrupt, or unreadable; never break an invocation" — is owned by `readVersionDrift`'s contract ("never throws") instead of being re-implemented as try/catch at each call site. It also sidesteps a real subtlety: reusing `ConfigLoader.load()` for drift would (a) throw `ConfigParseError` on corrupt YAML, (b) merge in global `~/.metta/config.yaml` and `local.yaml` layers where a stray `installed_version` could produce false drift, and (c) be unavailable to doctor, which is config-parse-exempt. A dedicated single-file tolerant read avoids all three.
- **Fits the existing file layout.** `src/config/` already holds `config-loader.ts`, `config-writer.ts`, `repair-config.ts` with co-located `*.test.ts` files; `version-drift.ts` + `version-drift.test.ts` lands in the established home for config-file concerns and keeps the near-1:1 test ratio.
- **No fs mocking for the core tests.** The decision matrix (match, upgrade drift, downgrade drift, absent field, non-string field, non-object config, null) is exercised by calling `detectVersionDrift` with literals.
- **Minimal diff to hot files.** `index.ts` gains ~8 lines in the existing hook; `helpers.ts` gains a setter/getter pair and a 3-line merge in `outputJson`; doctor gains one `checks.push(...)`.

## Cons

- **The preAction-to-outputJson hand-off needs module-scoped mutable state.** Commander's `preAction` hook has no built-in channel to the action handler, and commands call `outputJson` directly, so the practical bridge is a module-level `let detectedDrift: VersionDrift | null` in `helpers.ts` with an explicit setter. This brushes against the "no singletons" convention. Mitigations: it is a single primitive value scoped to one CLI process invocation (the process exits after one command — there is no cross-request lifetime); it is exported as explicit `setDetectedDrift`/getter functions rather than a shared service object; and tests can reset it. An alternative — attaching the drift result to the `Command` instance and threading `program` into `outputJson` — avoids module state but changes the signature of `outputJson` at ~40 call sites, a far larger and riskier diff. The module-state bridge is the honest cost of this approach and should be called out in the design artifact.
- **One extra file read per CLI invocation.** `readVersionDrift` re-reads `.metta/config.yaml` even though `preAction` may already have loaded it via `ConfigLoader`. Negligible in practice (one small YAML file per process), and deliberate: the loader's layered/validated read has the wrong semantics for drift (see Pros). Not worth caching machinery.
- **Slight duplication of YAML-read boilerplate.** `readVersionDrift`'s tolerant read overlaps with `loadYamlFile` in `config-loader.ts`; that helper is unexported and throws `ConfigParseError`, so it can't be reused as-is. The duplication is ~10 lines with intentionally different error semantics — acceptable, but a reviewer may ask.
- **Two pure entry points, not one.** Doctor's missing-stamp-warns semantics differ from the invocation check's missing-stamp-silent semantics, so the module ends up exporting both `detectVersionDrift` and `templateFreshnessCheck`. Still small, but the API is not a single function.

## Complexity (S/M/L)

**S.** One new ~70-line module, one new test file, an optional-field schema addition, and small edits to four existing files (`index.ts`, `helpers.ts`, `doctor.ts`, install/init commands). No new dependencies, no data-model or workflow changes, no migration (legacy configs without the field remain valid by construction).

## Testability

Strong — the best property of this factoring:

- `src/config/version-drift.test.ts` covers the entire decision matrix with zero mocking: equal versions → null; upgrade and downgrade drift → `{ installed, running }`; absent field → null; non-string field (`installed_version: 4`) → null for the invocation check; `templateFreshnessCheck` tri-state (pass / warn-mismatch naming both versions / warn-missing). These map 1:1 onto the spec scenarios in `spec.md`.
- `readVersionDrift` needs only a temp-dir test (present file, ENOENT, corrupt YAML → null, never throws) — same pattern as the existing `config-writer.test.ts`.
- `stampInstalledVersion` is a thin pass-through over the already-tested `setProjectField`; one round-trip test (stamp, re-stamp with new version, assert overwrite + comments preserved) suffices.
- The stderr warning, exit-code neutrality, and `--json` merge are CLI-level behaviors testable with the existing spawn-the-CLI style used in `tests/cli-*.test.ts` (e.g. `tests/cli-install.test.ts`), asserting stderr contains the warning while stdout parses as a single JSON document with/without the `template_version_mismatch` key.
- Test-to-source ratio stays near 1:1 (new module ships with its co-located test file).

## Verdict

Recommended. The dedicated pure module is the factoring most consistent with this codebase: it satisfies "functional core, imperative shell" literally, lands in the directory that already owns config-file concerns, implements the spec's exact-string comparison exactly once for all three surfaces (preAction warning, `--json` field, doctor check), and makes the "never break an invocation" guarantee a module contract rather than scattered defensive code. Its one genuine wart is the module-scoped drift holder in `helpers.ts` needed to bridge Commander's `preAction` hook to `outputJson`; the alternatives (threading a context object through ~40 `outputJson` call sites, or re-detecting drift inside `outputJson` with a second file read plus async plumbing) are strictly worse in diff size and risk, and a single per-process value behind explicit setter/getter functions is a defensible, documented exception to the no-singletons rule in a run-once CLI process. Complexity is Small, every spec scenario maps to a cheap test, and the design leaves an obvious seam if comparison semantics ever grow beyond exact equality.
