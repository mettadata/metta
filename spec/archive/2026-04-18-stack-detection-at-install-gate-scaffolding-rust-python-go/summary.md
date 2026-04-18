# Summary: stack-detection-at-install-gate-scaffolding-rust-python-go

## Problem

Group G shipped `.metta/gates/` override loading, but users had to write the YAMLs by hand. A first-time Rust user got `npm test` failures and no discoverable path to the fix.

## Solution

- `metta install` now detects stack via marker files and scaffolds `.metta/gates/{tests,lint,typecheck,build}.yaml` with stack-appropriate commands for Rust/Python/Go.
- JS projects use built-ins (no scaffold).
- New `--stack <spec>` flag: single stack, comma-separated multi-stack, or `skip`.
- Multi-stack projects get a comment header in each scaffold naming the other stacks.
- Never overwrites existing `.metta/gates/*.yaml` files.
- `ProjectInfoSchema.stacks` widened to optional `string[]`; legacy `stack: "rust"` strings still load fine via `resolveStacks()`.
- Scaffolds live at `src/templates/gate-scaffolds/<stack>/` following metta's "templates as external files" rule.

## Files touched

- `src/schemas/project-config.ts` — added `stacks: string[]` optional field
- `src/config/config-loader.ts` — `resolveStacks()` helper for legacy compat
- `src/cli/commands/install.ts` — detection, `--stack`, scaffold logic, new JSON/human output
- `src/templates/gate-scaffolds/{rust,python,go}/*.yaml` — 12 new files
- `package.json` — `copy-templates` extended to include gate-scaffolds
- `tests/cli.test.ts` — 11 new stack-detection tests
- `docs/getting-started.md` — updated Custom gate commands section

## Follows up

Group G (`metta-finalize-and-metta-ship-are-hardcoded-to-npm-javascrip`) — combined they deliver end-to-end language-agnostic finalize.
