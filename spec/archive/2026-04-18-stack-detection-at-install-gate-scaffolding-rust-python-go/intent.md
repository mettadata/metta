# stack-detection-at-install-gate-scaffolding-rust-python-go

## Problem

Group G added `.metta/gates/*.yaml` override support so non-JS projects can run `metta finalize`, but users have to write those YAMLs by hand. A first-time Rust user gets the generic `npm test` failure at finalize time and has no discoverable path to the fix.

Tracked as the follow-up flagged in Group G's intent ("Out of Scope: stack detection + auto-generating project gates").

## Proposal

At `metta install` time, detect the project stack from marker files in the project root and scaffold `.metta/gates/*.yaml` accordingly:

- `Cargo.toml` → Rust → `cargo test`, `cargo clippy`, `cargo check`, `cargo build`
- `pyproject.toml` or `requirements.txt` → Python → `pytest`, `ruff check .`, `mypy .`, `true` (pass-through build)
- `go.mod` → Go → `go test ./...`, `go vet ./...`, `true` (pass-through typecheck), `go build ./...`
- `package.json` → JS → no scaffold; built-ins cover it
- None of the above → print a hint pointing at `.metta/gates/` + `docs/getting-started.md`

### Multi-stack support (monorepos)

`.metta/config.yaml`'s `project.stack` field becomes `project.stacks: string[]` (array). A single-stack project reads/writes `['rust']`; a monorepo reads `['rust', 'python']`. Backward compatible: a single-string `stack:` value from existing configs is auto-upgraded to `stacks: [<value>]` on load.

When multiple markers detected: populate `stacks:` with all of them (ordered by priority: rust > go > python > js), and scaffold the gate YAMLs using the FIRST entry as the primary. Each scaffolded gate file gets a comment block listing the other detected stacks with a suggestion like `# To also run Python: edit command to 'cargo test && pytest'`.

### CLI surface

- `metta install --stack <name>` — force a single stack, bypass detection
- `metta install --stack rust,python` — comma-separated force multi-stack
- `metta install --stack skip` — skip scaffolding entirely (advanced users)

### Scaffold source-of-truth

Scaffolds live at `src/templates/gate-scaffolds/<stack>/{tests,lint,typecheck,build}.yaml` — externalized YAML per metta's "templates as external files" constitution. Build step already copies `src/templates/` to `dist/templates/`.

### Safety

Never overwrite existing `.metta/gates/*.yaml` files. Re-running `metta install` is idempotent — it only writes scaffolds that aren't there.

## Impact

- `src/cli/commands/install.ts` — detection + scaffold + `--stack` flag
- `src/schemas/project-config.ts` — widen `stack` to `stacks: string[]` with backward compat
- `src/templates/gate-scaffolds/rust/*.yaml` — 4 files
- `src/templates/gate-scaffolds/python/*.yaml` — 4 files
- `src/templates/gate-scaffolds/go/*.yaml` — 4 files
- `tests/cli.test.ts` — coverage per stack
- `docs/getting-started.md` — brief mention of auto-scaffold

## Out of Scope

- Java/Ruby/PHP/other stacks (add when asked)
- Per-directory gate overrides in monorepos (today we scaffold one set for the primary stack)
- Re-running scaffolding non-destructively after config.stacks changes (user re-edits gates manually)
- Gate schema changes
