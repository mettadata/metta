# Design: stack-detection-at-install-gate-scaffolding-rust-python-go

## Approach

Extend `metta install` with a detection-and-scaffold step. Externalize per-stack gate YAMLs under `src/templates/gate-scaffolds/<stack>/`. Widen `ProjectInfoSchema.stacks` to an array with a legacy `stack` string fallback.

## Components

- `src/schemas/project-config.ts` — add `stacks: z.array(z.string()).optional()` to `ProjectInfoSchema`
- `src/config/config-loader.ts` — add `resolveStacks(info)` helper that promotes legacy `stack` to `[stack]`
- `src/cli/commands/install.ts` — new `--stack <spec>` flag; detection + scaffold logic
- `src/templates/gate-scaffolds/rust/{tests,lint,typecheck,build}.yaml` — 4 files
- `src/templates/gate-scaffolds/python/{tests,lint,typecheck,build}.yaml` — 4 files
- `src/templates/gate-scaffolds/go/{tests,lint,typecheck,build}.yaml` — 4 files
- `package.json` — extend `copy-templates` script to include `gate-scaffolds`
- `tests/cli.test.ts` — new describe block with 10+ tests per story
- `docs/getting-started.md` — brief mention of auto-scaffold at install time

## Data Model

```typescript
// Before
ProjectInfoSchema = z.object({ name, description?, stack?, conventions? }).strict()
// After
ProjectInfoSchema = z.object({ name, description?, stack?, stacks?, conventions? }).strict()
```

`resolveStacks(info): string[]` returns `info.stacks ?? (info.stack ? [info.stack] : [])`.

## API Design

- `metta install --stack <spec>` where `<spec>` is `rust` | `python` | `go` | `js` | `rust,python` (CSV) | `skip`
- Return shape unchanged; JSON output gains `stacks: string[]` and `scaffolded_gates: string[]` fields
- Detection priority: `rust > go > python > js` for multi-marker directories
- Marker map:
  - `Cargo.toml` → `rust`
  - `go.mod` → `go`
  - `pyproject.toml` OR `requirements.txt` → `python`
  - `package.json` → `js`

## Scaffold YAML format

Each scaffold template looks like:

```yaml
name: tests
description: Run Rust tests
command: cargo test
timeout: 600000
required: true
on_failure: retry_once
```

Multi-stack comment prepend (when stacks.length > 1):

```yaml
# Multi-stack project detected: rust (primary), python
# To run both toolchains in sequence, change command to:
#   cargo test && pytest
name: tests
# ... rest as above
```

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `package.json` copy-templates miss | Add `gate-scaffolds` explicitly; verified diff check in summary step |
| Zod strict-mode conflict | Field is `.optional()`; does not break existing configs |
| User's legacy `stack: "rust"` config | `resolveStacks()` handles gracefully; install rewrites to `stacks:` on next run |
| Comment stripping by YAML parser | YAML parser preserves line-level content; comments stay in the file even though `load()` ignores them — this is fine for user inspection |
| `--stack skip` discoverability | Document in help text and getting-started.md |
