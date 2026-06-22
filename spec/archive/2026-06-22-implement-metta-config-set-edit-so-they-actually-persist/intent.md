# implement-metta-config-set-edit-so-they-actually-persist

## Problem

`src/cli/commands/config.ts` contains two stub subcommands that silently fail to perform their advertised functions.

`config set` (lines 40-53) prints `Set X = Y` and a note telling the user to edit `.metta/config.yaml` directly, but writes nothing to disk. This is a latent UX bug: the command's output signals success, so users have no indication the value was not persisted. Any downstream operation that reads the config key will see the old value.

`config edit` (lines 55-68) prints the target filename to stdout instead of opening it in an editor. The user must copy the path and open it manually.

A comment-preserving config writer already exists and MUST be reused: `setProjectField(root, path, value)` in `src/config/config-writer.ts:11`. It writes `<root>/.metta/config.yaml`, preserves YAML comments and flow-style sequences, and propagates `ENOENT` rather than auto-creating the file. Both stubs MUST delegate to this existing API rather than implement their own write logic.

## Proposal

### Fix `config set`

The handler MUST:

1. Split the dot-notation key argument into a path array (e.g. `"verification.strategy"` becomes `["verification", "strategy"]`).
2. Coerce the string value before writing: `"true"` / `"false"` MUST become `boolean`; a string that parses cleanly as an integer MUST become `number`; all other values MUST remain `string`.
3. Call `setProjectField(ctx.projectRoot, path, coercedValue)`.
4. Handle `ENOENT` (no `.metta/config.yaml` present) with a clear, actionable error message — it MUST NOT silently succeed or auto-create the file.
5. Apply validate-after-write: back up the raw file bytes before calling `setProjectField`; after writing, call `clearCache()` and reload the file through `ProjectConfigSchema` validation; if validation fails, MUST restore the backup bytes and surface the validation error so an invalid value NEVER remains persisted on disk.

JSON mode (`--json` / `ctx.json`) MUST continue returning `{ key, value, status: "set" }` on success.

**Given** a project with a valid `.metta/config.yaml` and the user runs `metta config set verification.strategy tests_only`,
**When** the command completes successfully,
**Then** reading `.metta/config.yaml` reflects `verification.strategy: tests_only` and the terminal output confirms the key was set.

**Given** a dot-notation key with a boolean string value (e.g. `metta config set ai.enabled true`),
**When** the command writes the value,
**Then** the YAML file contains the boolean `true` (not the string `"true"`).

**Given** a project with no `.metta/config.yaml`,
**When** the user runs `metta config set` on any key,
**Then** the command exits non-zero and prints an error indicating the config file does not exist (ENOENT); no file is created.

**Given** a value that would cause `ProjectConfigSchema` validation to fail (e.g. a key with an illegal type),
**When** the command calls `setProjectField` and then re-validates,
**Then** the original config file MUST be restored byte-for-byte, the command MUST exit non-zero, and the terminal MUST display the validation error; the invalid value MUST NOT remain on disk.

**Given** `--json` mode and a successful set,
**When** the command completes,
**Then** stdout is exactly `{ "key": "<key>", "value": <coerced-value>, "status": "set" }` with no other output.

### Fix `config edit`

The handler MUST:

1. Resolve the target file path: `.metta/config.yaml` for the default target, or `spec/project.md` when the target argument is `constitution`.
2. Resolve the editor binary from `$VISUAL` (preferred) then `$EDITOR`; if neither is set, exit non-zero with a clear error message instructing the user to set one of those environment variables.
3. Launch the resolved editor on the target file via `child_process.spawnSync` (or equivalent) with `stdio: "inherit"` so the terminal is handed off correctly.
4. Propagate the editor process exit code as the command exit code.

JSON mode MUST continue returning `{ file: "<resolved-path>" }` without launching an editor (the JSON contract is a dry-run / machine-readable response indicating which file would be edited).

**Given** `$EDITOR` is set to a valid editor binary and a `.metta/config.yaml` exists,
**When** the user runs `metta config edit`,
**Then** the editor opens with `.metta/config.yaml` as its argument and the terminal is handed off to the editor process.

**Given** `$VISUAL` and `$EDITOR` are both unset,
**When** the user runs `metta config edit`,
**Then** the command exits non-zero and prints a message telling the user to set `$VISUAL` or `$EDITOR`.

**Given** the user runs `metta config edit constitution`,
**When** the command resolves the target,
**Then** it opens `spec/project.md` (not `.metta/config.yaml`) in the editor.

**Given** `--json` mode,
**When** the user runs `metta config edit`,
**Then** stdout is `{ "file": "<resolved-path>" }` and no editor process is spawned.

## Impact

### Functional

`metta config set` becomes a real, safe, idempotent operation that persists values through the existing comment-preserving writer with validate-and-restore safety. `metta config edit` becomes a real editor launcher. Both subcommands now match their advertised behavior.

### Ripple: metta-verifier agent template

`src/templates/agents/metta-verifier.md` line 39 currently states that "`metta config set` ... is a stub that writes nothing." That statement becomes false once this change ships. The line MUST be updated to reflect that `config set` now persists values, and it MAY be updated to include `metta config set verification.strategy tests_only` as a concrete remediation example alongside `/metta-init`.

The deployed copy `.claude/agents/metta-verifier.md` MUST be updated byte-identically to the template. A new test file `tests/template-deploy-sync.test.ts` MUST be added to enforce that `.claude/agents/metta-verifier.md` remains byte-identical to `dist/templates/agents/metta-verifier.md` (the build output of the template source), so this class of drift is caught automatically in CI.

### Tests to add

The following test cases MUST be added to cover the implementation:

- `config set` persists a string value to `.metta/config.yaml`.
- `config set` coerces `"true"` / `"false"` to boolean before writing.
- `config set` coerces an integer string to `number` before writing.
- `config set` returns `ENOENT` error when `.metta/config.yaml` does not exist.
- `config set` rejects an invalid value, restores the original file, and exits non-zero.
- `config edit` invokes the binary from `$EDITOR` (mock with a no-op script) and passes the correct file path.
- `config edit` errors with a clear message when neither `$VISUAL` nor `$EDITOR` is set.
- `config edit --json` returns `{ file }` without spawning a process.

## Out of Scope

- `config get` and any other config subcommands — they are unchanged.
- Auto-creating `.metta/config.yaml` when it does not exist.
- Schema changes to `ProjectConfigSchema`.
- Any broader CLI refactor or restructuring of `src/cli/commands/config.ts` beyond the two stubs.
- Interactive prompts or TUI for browsing config keys.
- Support for editing files other than `.metta/config.yaml` and `spec/project.md` in `config edit`.
