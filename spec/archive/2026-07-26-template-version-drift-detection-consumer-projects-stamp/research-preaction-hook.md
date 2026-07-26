# Research: Extend the existing global preAction hook (drift check in `src/cli/index.ts`)

## Approach summary

Put the drift comparison inside the global `preAction` hook that already exists in
`src/cli/index.ts` (lines 115–129). The hook already instantiates a `ConfigLoader`
per invocation and calls `loader.load()` for every non-exempt command, so the
comparison piggybacks on config data that is already being read. When
`config.installed_version` is present and differs (exact string inequality) from
`getPackageVersion()`, the hook emits the one-line stderr warning and records
`{ installed, running }` in a small dedicated CLI-layer state module. `outputJson`
in `src/cli/helpers.ts` reads that module and merges `template_version_mismatch`
into every object payload it prints. No command file changes for the JSON surface
— all 198 `outputJson` call sites across `src/cli/commands/*` are covered at the
single choke point.

## How it works

### Hook restructuring

The current hook has an early return for `CONFIG_PARSE_EXEMPT_COMMANDS`
(`install`, `init`, `doctor`, `update`, `completion`) *before* any config load.
The spec requires the drift check on every command except `install`/`init` — so
`doctor`, `update`, and `completion` must still get the check. The hook is
restructured into two ordered concerns sharing one loader:

```ts
program.hook('preAction', async (_thisCommand, actionCommand) => {
  const name = actionCommand.name()
  const json = program.opts().json ?? false
  const loader = new ConfigLoader(process.cwd())

  let config: ProjectConfig | null = null
  let parseError: ConfigParseError | null = null
  try {
    config = await loader.load()
  } catch (err) {
    if (err instanceof ConfigParseError) parseError = err
    // schema/other errors: config stays null; drift check skips silently
  }

  // 1. Drift check — every command except install/init; never throws.
  if (name !== 'install' && name !== 'init' && config?.installed_version) {
    const running = await getPackageVersion()
    const mismatch = detectVersionDrift(config.installed_version, running)  // pure
    if (mismatch) {
      recordVersionMismatch(mismatch)                                       // state module
      process.stderr.write(`Warning: ... installed ${mismatch.installed}, running ${mismatch.running} ...\n`)
    }
  }

  // 2. Existing fail-fast — unchanged semantics, now reuses the same load.
  if (!CONFIG_PARSE_EXEMPT_COMMANDS.has(name) && parseError) {
    handleError(parseError, json)
  }
})
```

All spec edge cases fall out of this shape naturally: missing/corrupt/unreadable
config → `config` is null → drift skips silently; absent stamp → optional-chain
short-circuits; exit codes untouched (the drift branch never throws or exits);
stdout untouched (warning goes to `process.stderr`).

### State-flow mechanism (the concrete recommendation)

Three candidates were evaluated for carrying the mismatch from the hook to
`outputJson`:

1. **Module-level mutable variable inside `helpers.ts`.** Works, but bloats an
   already 400-line grab-bag file, and mixing the mutable slot into the same
   module as `outputJson` makes the coupling implicit.
2. **`process`-level global or env var (`globalThis.__mettaDrift` /
   `process.env`).** Rejected: untyped (env is stringly), invisible to the type
   system, hardest to reset in unit tests, and the closest thing to a genuine
   singleton anti-pattern of the three.
3. **Dedicated module `src/cli/version-drift.ts`** *(recommended)*:

```ts
export interface VersionMismatch { installed: string; running: string }

// functional core: pure, trivially unit-testable
export function detectVersionDrift(
  installed: string | undefined,
  running: string,
): VersionMismatch | null {
  if (installed === undefined || installed === running) return null
  return { installed, running }
}

// imperative shell: one process-lifetime slot
let recorded: VersionMismatch | null = null
export function recordVersionMismatch(m: VersionMismatch): void { recorded = m }
export function getVersionMismatch(): VersionMismatch | null { return recorded }
export function resetVersionMismatch(): void { recorded = null }  // tests only
```

`outputJson` in `helpers.ts` then becomes:

```ts
export function outputJson(data: unknown): void {
  const mismatch = getVersionMismatch()
  const payload =
    mismatch && data !== null && typeof data === 'object' && !Array.isArray(data)
      ? { ...(data as Record<string, unknown>), template_version_mismatch: mismatch }
      : data
  console.log(JSON.stringify(payload, null, 2))
}
```

Spread order (`...data` first, key appended) guarantees existing fields are never
displaced, satisfying the "merged without displacing" requirement. Array/primitive
payloads pass through unmodified — skipping non-objects is the safe conservative
behavior, and no spec scenario requires the key on a non-object payload.

**Is the module-level slot a "singleton" under the constitution?** Defensibly no.
The "no singletons" rule (and the explicit warning in `config-loader.ts` about
long-lived `ConfigLoader` singletons) targets *stateful service objects* whose
cached state can go stale across operations. This slot is a single
process-lifetime scalar in a CLI where one process == one command invocation —
its lifetime is exactly the natural lifetime of the fact it records ("this
invocation detected drift"). The alternative — threading a `mismatch` parameter
through 198 `outputJson` call sites and every command's action signature — is a
massive diff for zero behavioral gain and would still be per-process state, just
manually plumbed. The pure `detectVersionDrift` keeps the decision logic in the
functional core; the slot is the imperative shell, which is precisely the
project's stated architecture. The dedicated module also preserves the near-1:1
test-file ratio (`tests/version-drift.test.ts`).

### Interaction with CONFIG_PARSE_EXEMPT_COMMANDS

- `install`/`init`: drift check skipped by name gate (they re-stamp instead) —
  matches spec exactly.
- `doctor`/`update`/`completion`: previously the hook did *no* config read for
  these; now it performs one tolerant load so the drift check can run. On corrupt
  config the load fails, `parseError` is set, but the exempt check still bypasses
  `handleError` — repair surfaces remain reachable, identical to today.
- Non-exempt commands: fail-fast behavior is byte-identical; the only change is
  that the drift branch runs first (it is silent when config failed to load, so
  ordering is unobservable on the error path).
- Minor note: `actionCommand.name()` on nested subcommands returns the leaf name
  (`backlog add` → `add`). No nested command is named `install` or `init`, so
  name gating is currently safe; worth a one-line comment in code.

### Double-read cost

For non-exempt commands, config was already loaded twice per invocation (once in
the hook, once in the command's own `createCliContext` loader). The drift check
reuses the hook's load — **zero additional reads** on the common path. For the
three exempt-but-checked commands (`doctor`, `update`, `completion`) it adds one
load: three small YAML `readFile`s plus a Zod parse, single-digit milliseconds.
`getPackageVersion()` re-reads `package.json` (~1 KB) once more per invocation on
top of the startup `.version()` call — negligible; could later be memoized inside
`getPackageVersion` itself if desired, but not needed now.

## Pros

- **Single choke point on both ends.** One hook covers every command's stderr
  warning; one `outputJson` covers all 198 JSON call sites. No per-command edits
  for detection or JSON surface (doctor's freshness check is a separate,
  independent addition in `doctor.ts` per its own requirement).
- **Reuses the existing config load** — no new I/O on the common path, and the
  drift check inherits the hook's established per-invocation `ConfigLoader`
  pattern (explicitly endorsed by the comment in `config-loader.ts`).
- **Failure isolation is structural.** The hook's try/catch already swallows
  non-parse errors; the drift branch only runs on a successfully parsed config,
  so "drift check must never break an invocation" holds by construction.
- **Consistent with existing code.** The hook precedent, `handleError`'s stderr
  discipline, and the `helpers.ts` role as the CLI's shared shell all already
  exist; this extends rather than invents.
- **Functional core preserved**: the comparison is a pure function with its own
  unit tests; only the record slot and stderr write are shell.

## Cons

- **Module-level mutable state** is ambient coupling: `outputJson`'s output now
  depends on something a distant hook did. Mitigated by the dedicated, typed,
  resettable module and a doc comment, but it is still action-at-a-distance and
  brushes against a strict reading of "no singletons".
- **Hook restructuring touches the fail-fast path.** The existing
  `ConfigParseError` fail-fast is load-bearing (it renders the `doctor --fix`
  remedy); reordering it behind the shared load must preserve its semantics
  exactly, and existing tests around corrupt-config behavior must stay green.
- **In-process unit tests need `resetVersionMismatch()`** between cases — a
  test-only export, a mild smell (though integration tests avoid it entirely, see
  below).
- **`outputJson` gains a conditional** for every JSON print, including error
  payloads from `handleError` — the mismatch key will also appear on `--json`
  error output. The spec does not forbid this (arguably it is desirable), but it
  is a behavior the design phase should confirm.
- Commander hook coupling: the logic lives in `index.ts`'s hook closure, which is
  itself untestable in isolation — only the extracted pure function and the
  end-to-end CLI are testable, leaving the hook wiring covered solely by
  integration tests.

## Complexity

**S–M.** Roughly: one new ~40-line module + test, ~25 modified lines in the
`index.ts` hook, ~6 lines in `outputJson`, plus the schema field and the
independent stamp/doctor work shared by every approach. The only delicate part is
preserving fail-fast semantics during the hook restructure.

## Testability

Strong, and the existing harness fits it exactly:

- **Integration (primary):** `tests/helpers/cli.js` `runCli` spawns the *built*
  CLI (`dist/cli/index.js`) as a subprocess in a `mkdtemp` temp dir per test —
  module-level state is therefore reset for free on every invocation; no
  cross-test contamination is even possible at this level. Drift scenarios are
  written by running `metta install` in the temp dir, rewriting
  `installed_version` in `.metta/config.yaml` to a fake value (e.g.
  `"0.0.1-test"`), then asserting: warning line on stderr, clean JSON on stdout
  containing `template_version_mismatch`, unchanged exit codes, silence for
  matching/absent/corrupt configs. This mirrors `cli-status.test.ts` and
  `cli-install.test.ts` patterns verbatim.
- **Unit:** `detectVersionDrift` is pure (4-line truth table). The record/get/
  reset trio and the `outputJson` merge are unit-testable in-process with a
  `console.log` spy plus `resetVersionMismatch()` in `beforeEach`, following the
  existing `cli-helpers.test.ts` file.
- The one genuinely awkward seam — the hook closure in `index.ts` — is covered
  only end-to-end, but that is already true of the existing fail-fast hook, so
  this approach adds no new class of untested code.

## Verdict

This is a strong, low-cost fit for the codebase and should be the default choice
unless a competing approach eliminates the mutable slot without touching all 198
`outputJson` call sites. It reuses an existing, purpose-built extension point
(the per-invocation hook with its per-invocation `ConfigLoader`), adds zero I/O
on the common path, satisfies every spec scenario structurally rather than by
scattered per-command logic, and confines the one architectural compromise — a
process-lifetime mutable slot — to a dedicated, typed, pure-core/shell-split
module (`src/cli/version-drift.ts`, option 3 above) that the constitution's
"no singletons" rule does not meaningfully condemn in a one-command-per-process
CLI. The two things the design phase must nail down are (1) preserving the
`ConfigParseError` fail-fast semantics exactly while restructuring the hook so
`doctor`/`update`/`completion` still get the drift check, and (2) whether the
`template_version_mismatch` key should also ride on `--json` error payloads
emitted through `handleError` (recommended: yes, for consistency).
