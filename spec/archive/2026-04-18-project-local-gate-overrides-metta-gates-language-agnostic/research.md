# Research: project-local-gate-overrides-metta-gates-language-agnostic

## Decision: two-pass `loadFromDirectory` in finalize CLI

### Key findings

1. `GateRegistry.register()` uses `this.gates.set(gate.name, gate)` — later registrations overwrite. Natural precedence: load project-local second.
2. `GateRegistry.loadFromDirectory` has a bare `try {} catch {}` that swallows "directory doesn't exist" — safe to call on a missing `.metta/gates/`.
3. `finalize.ts:29-30` currently loads only built-ins. One-line addition.
4. `readdir` returns entries in platform order — on Linux, that's directory-insertion order, not lexical. This change includes a `.sort()` to pin determinism (matches the spec's "deterministic load order" requirement).
5. `docs/getting-started.md` exists and references the `.metta/` directory at setup. Add a short paragraph on gate overrides.

### Implementation sketch

In `src/cli/commands/finalize.ts`:
```typescript
const builtinGates = new URL('../../templates/gates', import.meta.url).pathname
await ctx.gateRegistry.loadFromDirectory(builtinGates)
// Project-local overrides: `.metta/gates/*.yaml` wins over built-ins with the same name.
await ctx.gateRegistry.loadFromDirectory(join(ctx.projectRoot, '.metta', 'gates'))
```

In `src/gates/gate-registry.ts:28`:
```typescript
const entries = (await readdir(dir)).sort()
```

### Test approach

Add to `tests/gate-registry.test.ts`:
- Create a temp dir with two nested gate-dirs (one simulating built-ins, one simulating project overrides).
- Load both into a single `GateRegistry`, verify the override takes precedence for shared names and the built-in remains for unshared names.
- Verify `loadFromDirectory` on a non-existent path is silent.

### Docs

Add one paragraph to `docs/getting-started.md` with a note like:
> **Custom gate commands**: place YAML files in `.metta/gates/` to override any built-in gate (e.g. a Rust project with `.metta/gates/tests.yaml` containing `command: cargo test`).

### Risks

- None substantial. Backward compatible: JS projects without `.metta/gates/` get today's behavior.
- `readdir` sort order change: already effectively stable on common filesystems; sorting makes it explicit and portable.

### Artifacts produced

None — direct code + docs edits.
