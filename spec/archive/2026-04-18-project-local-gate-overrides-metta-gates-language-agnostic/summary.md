# Summary: project-local-gate-overrides-metta-gates-language-agnostic

## Problem

`metta finalize` gates hardcoded npm commands; non-JS projects could not finalize without hacks.

## Solution

Second `loadFromDirectory` pass on `<projectRoot>/.metta/gates/` after the built-ins. `GateRegistry.register()` uses a Map, so later loads override earlier ones by gate name. Missing dir is silent. `readdir` entries sorted for deterministic order.

## Files touched

- `src/cli/commands/finalize.ts` — second `loadFromDirectory` call
- `src/gates/gate-registry.ts` — `readdir(...).sort()`
- `tests/gate-registry.test.ts` — 3 new tests for override precedence
- `docs/getting-started.md` — Rust example showing `.metta/gates/tests.yaml`

## Resolves

- `metta-finalize-and-metta-ship-are-hardcoded-to-npm-javascrip` (critical)

## Out of scope (deferred)

- Auto-generating project gates based on detected stack
- CLI command for `metta gate override <name> <command>` convenience
