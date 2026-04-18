# Design: project-local-gate-overrides-metta-gates-language-agnostic

## Approach

One line in `finalize.ts` (second `loadFromDirectory` call on `.metta/gates/`), one line in `gate-registry.ts` (sort readdir entries), one paragraph in `docs/getting-started.md`, plus a unit test.

## Components

- `src/cli/commands/finalize.ts` — call `loadFromDirectory(join(projectRoot, '.metta/gates'))` after the built-in load
- `src/gates/gate-registry.ts` — `readdir` result `.sort()` for deterministic order
- `docs/getting-started.md` — one-paragraph mention of `.metta/gates/` override
- `tests/gate-registry.test.ts` — override-precedence test

## Data Model

No schema change.

## API Design

`GateRegistry.loadFromDirectory` contract unchanged; users call it twice (once per source). Gate name collisions resolved by order (later wins).

## Dependencies

None added.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| User drops malformed YAML in `.metta/gates/` | `GateDefinitionSchema.parse` already throws on invalid shape; error bubbles as a finalize failure with clear context. |
| Platform-dependent readdir order | Added `.sort()` for portable determinism. |
| Backward compat | Projects without `.metta/gates/` see unchanged behavior (missing-dir catch). |
