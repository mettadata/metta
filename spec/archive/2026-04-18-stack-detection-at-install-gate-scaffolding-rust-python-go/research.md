# Research: stack-detection-at-install-gate-scaffolding-rust-python-go

## Decision

- Schema: extend `ProjectInfoSchema` with `stacks: string[]` (optional). Keep existing `stack: string` for legacy reads; add a Zod preprocessor that promotes `stack` to `stacks` when only the legacy field is present.
- Scaffolds: YAML files per stack under `src/templates/gate-scaffolds/<stack>/{tests,lint,typecheck,build}.yaml`. Build step already copies `src/templates/` → `dist/templates/`.
- Detection: pure filesystem probe in `src/cli/commands/install.ts` for marker files in `projectRoot`.
- Multi-stack: ordered by priority `rust > go > python > js`, primary is `stacks[0]`, each scaffolded file gets a comment block listing other stacks when length > 1.
- `--stack <spec>` flag: comma-separated list, or `skip`.

## Per-stack gate content (lean, tool-default lint)

### Rust
- `tests.yaml` → `cargo test`
- `lint.yaml` → `cargo clippy`
- `typecheck.yaml` → `cargo check`
- `build.yaml` → `cargo build`
- All get `timeout: 600000`, `required: true`, `on_failure: retry_once` (matching built-in pattern).

### Python
- `tests.yaml` → `pytest`
- `lint.yaml` → `ruff check .`
- `typecheck.yaml` → `mypy .`
- `build.yaml` → `true` + comment explaining no build step

### Go
- `tests.yaml` → `go test ./...`
- `lint.yaml` → `go vet ./...`
- `typecheck.yaml` → `true` + comment (compile == typecheck in Go)
- `build.yaml` → `go build ./...`

## Schema migration

`ProjectInfoSchema` becomes:

```typescript
export const ProjectInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  stack: z.string().optional(),          // legacy, kept for backward compat
  stacks: z.array(z.string()).optional(), // new canonical
  conventions: z.string().optional(),
}).strict()
```

Upgrade helper: `resolveStacks(info): string[]` returns `info.stacks ?? (info.stack ? [info.stack] : [])`. Use in the gate-scaffold step and anywhere else that needs the array.

## Install-time flow

```
1. Existing: check for git, make .metta/, write config stub
2. NEW: determine stacks:
   a. If --stack skip → stacks = [], skip to step 4
   b. If --stack <value> → parse comma-separated; validate each; use as stacks
   c. Else auto-detect markers in project root
3. NEW: merge stacks into .metta/config.yaml under project.stacks
4. NEW: if stacks[0] is a non-JS stack with a scaffold template, write the 4 YAMLs to .metta/gates/ (never overwrite existing files)
5. NEW: if stacks is empty or has only "js" and no .metta/gates/ exists, print a hint about .metta/gates/ for manual override
```

## Test plan

New `describe('metta install stack detection')` block in `tests/cli.test.ts`:

- Empty dir + `Cargo.toml` → rust gates scaffolded, config.stacks === ['rust']
- Empty dir + `pyproject.toml` → python gates, build.yaml command is `true`
- Empty dir + `requirements.txt` (no pyproject) → python detected
- Empty dir + `go.mod` → go gates, typecheck.yaml command is `true`
- Empty dir + `package.json` → no `.metta/gates/` dir created
- Dir with `Cargo.toml` AND `pyproject.toml` → config.stacks === ['rust', 'python'], primary rust gates scaffolded, files contain comment mentioning python
- `metta install --stack rust,python` → same multi-stack scaffolding without relying on detection
- `metta install --stack skip` → no `.metta/gates/` directory
- `metta install --stack ruby` → exits non-zero
- Empty dir (no markers) → stderr contains `.metta/gates/` hint
- Re-run install → existing `.metta/gates/tests.yaml` not overwritten

## Risks

- **Dist copy**: build's `copy-templates` step already handles `src/templates/*`. Adding `gate-scaffolds` as a new sibling directory requires updating the copy-templates script if it enumerates directories. Confirm by reading `package.json` scripts and adding the new dir if needed.
- **Zod strict mode**: adding `stacks` while keeping `stack` — need to ensure both are accepted, not cause strict-mode rejection. `ProjectInfoSchema` is `.strict()` so adding the field is required.
- **Legacy configs**: anyone with the existing `stack: <value>` gets auto-upgraded in memory but file on disk is unchanged. That's fine; the install command will write `stacks:` on its next run.
- **ConfigLoader behavior**: load order matters. Check that the loader's defaults don't override user-provided values.

## Artifacts

None beyond the YAMLs.
