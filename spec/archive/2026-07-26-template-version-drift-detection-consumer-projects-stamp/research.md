# template-version-drift-detection-consumer-projects-stamp — Research Synthesis

Three implementation approaches were explored in parallel. Per-approach detail lives in:

- `research-preaction-hook.md` — extend the existing global `preAction` hook
- `research-pure-drift-module.md` — dedicated pure drift module in `src/config/`
- `research-lazy-output-check.md` — lazy check at output time (no preAction involvement)

## Approach A: Extend the existing preAction hook (`research-preaction-hook.md`)

The global `preAction` hook in `src/cli/index.ts` already instantiates a `ConfigLoader` per invocation; the drift check can piggyback on that load with near-zero extra I/O. Warning goes to stderr immediately; the mismatch `{ installed, running }` is recorded in a process-lifetime slot that `outputJson` reads when merging `template_version_mismatch`.

- **Pros:** minimal new surface; spec's `invocation-time-drift-check` requirement literally names this hook; zero extra config reads for non-exempt commands; integration harness (subprocess-per-test) resets module state for free.
- **Cons / risks:** the hook currently early-returns for `CONFIG_PARSE_EXEMPT_COMMANDS` (`doctor`, `update`, `completion`) *before* loading config, but the spec requires the drift check on every command except `install`/`init` — the hook must be restructured into (1) tolerant load + drift check gated only on install/init, then (2) the existing `ConfigParseError` fail-fast gated on the exempt set. The fail-fast is load-bearing and must not regress. Reusing `ConfigLoader.load()` for the drift read also merges global/local config layers, which could produce false drift from a stray `installed_version` in `~/.metta/config.yaml`.
- **Complexity:** S–M.

## Approach B: Dedicated pure drift module (`research-pure-drift-module.md`)

New `src/config/version-drift.ts` exporting a pure `detectVersionDrift(config, runningVersion): { installed, running } | null`, a tolerant never-throws raw-YAML reader scoped to the *project* `.metta/config.yaml` only, a `stampInstalledVersion(root, version)` wrapper over `setProjectField`, and a `templateFreshnessCheck` helper for doctor (missing-stamp semantics differ: doctor warns, invocation check stays silent).

- **Pros:** textbook "functional core, imperative shell"; lands next to `config-loader.ts`/`config-writer.ts`/`repair-config.ts` with co-located tests (near-1:1 ratio); one shared extraction path reused by preAction, doctor, install, and init; the tolerant reader sidesteps both the `ConfigParseError` throw and the global/local layer-merge false-drift problem; doctor (config-parse-exempt) can call it directly.
- **Cons:** the `outputJson` merge still needs a module-scoped drift holder (explicit `record/get/reset` setter in one place) because Commander's `preAction` has no channel to action handlers and ~150+ `outputJson` call sites make parameter-threading impractical. This brushes the "no singletons" rule; documented as a deliberate exception for a run-once CLI process.
- **Complexity:** S.

## Approach C: Lazy check at output time (`research-lazy-output-check.md`)

Perform the drift check on demand inside `outputJson` plus a `process.on('exit')` listener for human mode.

- **Pros:** `outputJson` is the natural merge point for the JSON field (a preAction design gets this for free anyway).
- **Cons:** `outputJson` is synchronous with 156 call sites across 39 files — the check needs sync fs reads or an async ripple across all call sites; human-mode paths never call `outputJson`, so an exit listener is required, but `beforeExit` never fires (the CLI calls `process.exit()` widely) and `'exit'`-time stderr writes can be lost on piped output; install/init skipping needs a suppression side channel; double-emission guards needed because `handleError` also routes through `outputJson`; conflicts with the spec, which mandates the preAction hook.
- **Complexity:** M–L. **Not recommended.**

## Recommendation

**Combine A + B (B as the factoring, A as the call site).** Implement a dedicated pure module `src/config/version-drift.ts` (tolerant project-scoped reader + pure comparison + stamp helper + doctor freshness helper), call it from a restructured `preAction` hook in `src/cli/index.ts` (drift check for every command except `install`/`init`, preserving the existing `ConfigParseError` fail-fast semantics for non-exempt commands), record the mismatch in a single explicit `record/get/reset` slot consumed by `outputJson` in `helpers.ts`, and have `install`/`init` call `stampInstalledVersion` and `doctor` call `templateFreshnessCheck`. This satisfies every spec requirement, keeps the functional core pure and independently testable, and confines the one pragmatic piece of process state to a single documented location. Design note carried forward: decide whether `template_version_mismatch` also appears on `--json` *error* payloads via `handleError` — recommended yes, for consistency (spec is silent).
