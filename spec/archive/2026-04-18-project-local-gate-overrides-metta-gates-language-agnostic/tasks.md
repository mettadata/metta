# Tasks: project-local-gate-overrides-metta-gates-language-agnostic

## Batch 1 (parallel, different files)

### Task 1.1: Add project-local gate load in finalize
- **Files:** `src/cli/commands/finalize.ts`
- **Action:** After the existing `await ctx.gateRegistry.loadFromDirectory(builtinGates)` call, add a second call: `await ctx.gateRegistry.loadFromDirectory(join(ctx.projectRoot, '.metta', 'gates'))`. Include a brief inline comment explaining override precedence.
- **Verify:** `grep "'.metta'" src/cli/commands/finalize.ts` returns ≥1; `npx tsc --noEmit` clean.
- **Done:** project-local override path wired.

### Task 1.2: Sort readdir entries in gate-registry
- **Files:** `src/gates/gate-registry.ts`
- **Action:** Change `const entries = await readdir(dir)` (around line 28) to `const entries = (await readdir(dir)).sort()` for deterministic load order.
- **Verify:** `grep 'readdir(dir)).sort()' src/gates/gate-registry.ts` returns 1.
- **Done:** deterministic ordering pinned.

### Task 1.3: Override-precedence test
- **Files:** `tests/gate-registry.test.ts`
- **Action:** Add a new describe block `'project-local override precedence'` with a test that creates two temp directories (built-in mock + project-local mock), writes a `tests.yaml` in each with different `command` values, loads both sequentially into a fresh `GateRegistry`, and asserts the second-loaded value wins. Add a second test asserting that `loadFromDirectory` on a non-existent path does not throw.
- **Verify:** `npx vitest run tests/gate-registry.test.ts` passes; existing 19 tests still green.
- **Done:** new coverage landed.

### Task 1.4: Document override path
- **Files:** `docs/getting-started.md`
- **Action:** Add a short subsection or paragraph introducing `.metta/gates/*.yaml` as the project-local override path, with a Rust example (`command: cargo test`). Place near the existing gates or project-config discussion if present; otherwise at a natural point in the finalize-workflow section.
- **Verify:** `grep '.metta/gates' docs/getting-started.md` returns ≥1.
- **Done:** docs reference the override mechanism.

## Batch 2 (sequential)

### Task 2.1: summary + gate suite
- **Files:** `spec/changes/project-local-gate-overrides-metta-gates-language-agnostic/summary.md`
- **Action:** summary + gates (tsc, test, lint, build).
- **Done:** all gates green.
