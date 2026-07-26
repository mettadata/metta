# Research: Lazy drift check at output time

Approach under evaluation: no `preAction` involvement. The drift check runs on demand at the moment output is produced — inside `outputJson` for `--json` mode, plus a process-exit listener (or per-command wrapper) for human mode.

## Approach summary

Move the drift check out of the CLI lifecycle entirely and into the output layer. A memoized drift module (read `.metta/config.yaml` tolerantly, compare `installed_version` to `getPackageVersion()`) is consulted lazily:

- `outputJson` (`src/cli/helpers.ts`) checks for drift before printing and merges `template_version_mismatch: { installed, running }` into the payload.
- Human-mode commands never call `outputJson`, so a `process.on('exit')` listener (registered once in `src/cli/index.ts`) performs the same check and writes the one-line warning to stderr as the process terminates.
- Install/init suppression is done by a module-level flag the drift module exposes (`suppressDriftCheck()`), which those two commands (or a registration-time gate) must call.

Stamping on install/init, the schema change, and the doctor check are identical under every approach and are not differentiators here.

## How it works

1. New module (e.g. `src/cli/drift-check.ts`) exports `getDriftStatus(): { installed: string; running: string } | undefined`, memoized so the config is read at most once per process and the warning can be emitted exactly once.
2. Because `outputJson` is synchronous (`JSON.stringify` + `console.log`) and `'exit'` listeners must also be synchronous, the check cannot reuse the async `ConfigLoader.load()` or async `getPackageVersion()`. It needs a parallel synchronous path: `readFileSync` + tolerant YAML parse for the config, and a sync `readFileSync` of `package.json` for the running version (or an eager async prefetch at startup whose result the sync consumers read — which quietly reintroduces startup wiring, i.e. most of what `preAction` would have done anyway).
3. `outputJson(data)` becomes: if `data` is a plain object (not an array/scalar/error-shaped payload — all 156 call sites across 39 command files pass through here, including `handleError`'s error envelopes), spread `template_version_mismatch` into it when drift exists; stringify; print.
4. `src/cli/index.ts` registers `process.on('exit', ...)` that emits the stderr warning if drift exists, it has not already been emitted, and suppression is not set. `'beforeExit'` is unusable because it does not fire on `process.exit()`, which the CLI calls liberally (`handleError`, `status`'s catch block, etc.); `'exit'` does fire but only synchronous work is safe there, and stderr writes to a pipe are asynchronous on POSIX — a warning written inside an `'exit'` handler with piped stderr can be truncated or lost.
5. Install/init must opt out. `outputJson` has no access to Commander state, so the skip cannot be derived at output time; it requires explicit suppression calls inside the install/init command handlers or a name check wired at parse time — either way, per-command wiring that the "no lifecycle involvement" framing was supposed to avoid.

## Pros

- Zero cost on the hot path for commands that produce no output; the config read happens only when output is actually emitted (in practice this saving is negligible — one small YAML read).
- The JSON merge lives exactly where the JSON is produced: `template_version_mismatch` injection in `outputJson` is arguably the most natural home for the US-3 requirement, and no per-command payload changes are needed for `--json` mode.
- No change to the `preAction` hook or to command registration for the JSON half.
- The check runs even for code paths that bypass hooks (e.g. output produced from `parseAsync().catch`).

## Cons

- **Contradicts the spec as written.** Requirement `invocation-time-drift-check` in `spec.md` states the check runs in "the global `preAction` hook in `src/cli/index.ts`". Adopting this approach requires amending an already-authored requirement — a process cost and a signal the design is swimming against the intended architecture.
- **Human mode needs a second, worse mechanism.** Most human-mode paths use `console.log` directly and never touch `outputJson` (e.g. `printChangeStatus` in `src/cli/commands/status.ts`), so the warning demands an `'exit'` listener. That listener must be fully synchronous, competes with `process.exit()` semantics, risks losing the warning when stderr is a pipe, and prints the warning *after* command output instead of before — observably different UX from the preAction variant.
- **Sync/async impedance mismatch.** Either duplicate a synchronous tolerant-read path alongside the existing async `ConfigLoader` (two config readers to keep consistent), or make `outputJson` async — rippling `await` through 156 call sites in 39 files and inviting fire-and-forget bugs where output races `process.exit(4)`.
- **Suppression for install/init is awkward.** The output layer cannot know the command name; skipping requires explicit suppression wiring in those commands or a parse-time gate — reintroducing lifecycle coupling through a side channel (mutable module state, which brushes against the "no singletons" convention).
- **Duplicate/missed emission risk.** Several commands can call `outputJson` more than once per invocation in error flows (normal output attempt followed by `handleError`'s error envelope), so the merge/warn must be once-guarded; conversely, a human-mode command that crashes before the exit listener fires under an uncaught throw still warns, but ordering and presence become timing-dependent rather than deterministic.
- **Payload-shape edge cases.** `outputJson(data: unknown)` accepts anything; merging a top-level key is only well-defined for plain objects. Error envelopes (`{ error: {...} }`) and any future array payloads need an explicit policy, decided inside a formatter that today has zero policy.
- **Couples a pure formatter to the filesystem.** `outputJson` is currently a two-line pure-ish function; after this change every test that exercises any command's JSON output becomes sensitive to cwd and `.metta/config.yaml` state unless the drift module is injectable — violating the project's functional-core/imperative-shell convention in the one helper where it was cleanly upheld.

## Complexity

**M–L.** The diff to `outputJson` itself is small, but the true cost is the synchronous config-read duplication, the exit-listener machinery with its `process.exit()`/piped-stderr caveats, the suppression side channel for install/init, once-guarding, and the test-isolation work across every existing command test that asserts JSON output. The preAction alternative concentrates the same logic in one hook with none of these satellites.

## Testability

Mixed-to-poor. The pure comparison (`installed !== running`) is trivially unit-testable if extracted. But the integration surface is hard: `'exit'` listeners are awkward under Vitest (require spawning real child processes or intrusive `process.exit` mocking), the memoized module-level state must be reset between tests (module state resets fight Vitest's module cache), and `outputJson` — currently testable with a `console.log` spy and nothing else — now needs filesystem fixtures or dependency injection for every JSON-output assertion in the existing suite (`tests/cli-helpers.test.ts`, `tests/cli-status.test.ts`, and every command test that checks `--json` output). Verifying "exactly one warning" and "warning not lost on piped stderr at exit" requires end-to-end child-process tests.

## Verdict

Not recommended. The lazy-at-output approach earns its keep only for the JSON-merge half of the feature — and even a preAction-based design will likely route the merge through `outputJson` or a shared drift-state module anyway, so that benefit is not exclusive to this approach. Everything else is a liability: human mode requires a synchronous `'exit'` listener with real warning-loss risk on piped stderr and inverted output ordering; the synchronous constraint forces either a duplicate sync config reader or an async ripple across ~156 call sites; install/init suppression needs a mutable side channel the output layer was never meant to carry; and the existing test suite's JSON assertions all become filesystem-coupled. Decisively, the change spec already mandates the `preAction` hook for the invocation-time check, so this approach starts from a spec amendment. The sensible synthesis is: perform the check once in `preAction` (async, reusing existing loaders, command-name gating for free), stash the result in a small shared module, and have `outputJson` merge from that precomputed state — which captures this approach's one genuine strength without inheriting its exit-listener and sync-read costs.
