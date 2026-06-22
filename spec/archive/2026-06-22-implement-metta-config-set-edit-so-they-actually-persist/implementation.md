# Implementation: implement-metta-config-set-edit-so-they-actually-persist

## Summary

Replaced the two print-only stub subcommands in `src/cli/commands/config.ts` with
working implementations that match their advertised behavior:

- `config set` now persists values to `.metta/config.yaml` through the existing
  comment-preserving writer `setProjectField`, with validate-and-restore safety.
- `config edit` now launches a real editor (`$VISUAL` / `$EDITOR`) on the resolved
  target file, handing off the terminal via `stdio: 'inherit'`.

The now-false operational note in the `metta-verifier` agent template was updated and
its deployed `.claude/` copy re-synced byte-identically.

## Changes

### `src/cli/commands/config.ts`

New module-level exported helpers (exported so they can be unit-tested):

- `coerceValue(value: string): unknown` — coerces the raw CLI string using the same
  rules as `config-loader.ts` `applyEnvOverrides`: `'true'`→`true`, `'false'`→`false`,
  `/^-?\d+$/`→`parseInt(..., 10)`, otherwise the original string. (Extended over the
  loader's `/^\d+$/` to also accept negative integers, since `config set` may legitimately
  set a negative number.)
- `resolveEditor(env): string | undefined` — `$VISUAL` preferred over `$EDITOR`; returns
  `undefined` when neither is set or both are empty/whitespace.

`config set (key, value)`:
1. `path = key.split('.')`, `coerced = coerceValue(value)`.
2. Reads the current raw `.metta/config.yaml` bytes as a backup; an `ENOENT` here throws
   `No .metta/config.yaml found — run metta install first.` (no auto-create).
3. Calls `setProjectField(ctx.projectRoot, path, coerced)`.
4. Validate-after-write: `ctx.configLoader.clearCache?.()` then `await ctx.configLoader.load()`
   (runs `ProjectConfigSchema`). On throw, restores the backup bytes and re-throws
   `Rejected: <message> (config restored)`.
5. Success: human mode prints `Set <key> = <coerced>` (the misleading "edit directly" note
   is gone); JSON mode prints `{ key, value: coerced, status: 'set' }`.
6. Errors funnel through the file's existing try/catch → exit 4, with the JSON error shape
   `{ error: { code: 4, type: 'config_error', message } }`.

`config edit ([target])`:
- Resolves `spec/project.md` for `constitution`, else `.metta/config.yaml`.
- JSON mode: prints `{ file }` and returns without spawning anything (machine-readable dry-run).
- Human mode: resolves the editor via `resolveEditor`; if none, errors
  `No editor set — set $EDITOR or $VISUAL, or edit <file> directly.` and exits 4.
  Otherwise `spawn(editor, [file], { stdio: 'inherit' })`, awaits exit, and propagates a
  non-zero editor exit code as the command exit code. A spawn `error` event (e.g. editor
  binary not found) reports the failure and exits 4.

### `src/templates/agents/metta-verifier.md` (+ `.claude/agents/metta-verifier.md`)

The operational note that previously read "`metta config set` ... is a stub that writes
nothing. Use `/metta-init` or manual edit ... as the only remediation paths" was replaced
with an accurate note: `config set` now persists through the comment-preserving writer
(with validate-and-restore safety) and MAY be used as a quick remediation
(e.g. `metta config set verification.strategy tests_only`), with `/metta-init` still
recommended for full discovery and manual edit remaining valid.

The deployed copy `.claude/agents/metta-verifier.md` was overwritten with the template so
the two are byte-identical (`cmp` clean), satisfying `tests/template-deploy-sync.test.ts`.

## Tests

`tests/config-set-edit.test.ts` (new, 52 assertions across 12 tests):

- `coerceValue` unit: booleans, positive/negative integers, non-numeric strings, decimals
  (stay strings), empty string.
- `config set` (subprocess via the standard `npx tsx` CLI harness): persists a string;
  coerces boolean (`auto.ship_on_success`); coerces integer (`auto.max_cycles`); `ENOENT`
  error when the file is absent (and no file created); invalid value (`defaults.mode bogus`)
  is rejected, the original file is restored byte-for-byte, exit non-zero; `--json` returns
  exactly `{ key, value, status: 'set' }`.
- `config edit`: invokes `$EDITOR` (a shell script that records its `$1` to a marker) and
  receives `.metta/config.yaml`; `--json` returns `{ file }` and spawns nothing (marker
  absent); `constitution` target resolves to `spec/project.md`.
- `resolveEditor` unit: returns `undefined` when neither var is set / both empty / whitespace;
  prefers `$VISUAL` over `$EDITOR`.

Note on the no-editor branch: it is covered by the `resolveEditor` unit test rather than the
subprocess harness, because `npm`/`npx` always injects a default `$EDITOR` (e.g. `vi`) into
child processes, so the empty-editor condition cannot be reproduced through `npx tsx`.

## Verification

- `npm run build` — pass.
- `npx tsc --noEmit` — pass.
- `npx vitest run tests/config-set-edit.test.ts tests/template-deploy-sync.test.ts` —
  52 passed (12 in the new file, 40 in the byte-identity test). The byte-identity test
  confirms the verifier-note sync.

(Full suite intentionally not run per the change's LIGHT verification scope.)
