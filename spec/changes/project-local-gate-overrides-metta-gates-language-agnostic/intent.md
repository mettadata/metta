# project-local-gate-overrides-metta-gates-language-agnostic

## Problem

`metta finalize` loads gates from `src/templates/gates/` only — each gate YAML hardcodes an npm command (`npm test`, `npm run build`, `tsc --noEmit`). Non-JavaScript projects cannot complete `metta finalize` without bypassing the gate system or dropping a `package.json` stub.

Tracked as `metta-finalize-and-metta-ship-are-hardcoded-to-npm-javascrip` (critical).

## Proposal

Make the gate registry layered. After loading built-in templates from `src/templates/gates/`, also load user overrides from `<projectRoot>/.metta/gates/*.yaml`. Because `GateRegistry.register()` stores gates in a Map keyed by gate name, the second pass naturally overwrites the first — project-local YAMLs win.

- Rust project → `.metta/gates/tests.yaml` with `command: cargo test`
- Python project → `.metta/gates/tests.yaml` with `command: pytest`
- JS project with no override → current behavior preserved

## Impact

- `src/cli/commands/finalize.ts` — after `loadFromDirectory(builtinGates)`, call `loadFromDirectory(join(projectRoot, '.metta/gates'))`. Existing `try/catch` in `loadFromDirectory` silently passes when the dir doesn't exist.
- `tests/gate-registry.test.ts` — new test covering project-local override precedence.
- `docs/getting-started.md` + `docs/architecture.md` — brief mention of `.metta/gates/*.yaml` override path (if those docs already discuss gates).
- No gate schema change. No change to any existing built-in gate YAML.

## Out of Scope

- Stack detection from `.metta/config.yaml` + auto-generating project gates (separate follow-up)
- Broader gate runner refactors
- Migrating the built-in npm-specific gates to "detect stack" behavior
