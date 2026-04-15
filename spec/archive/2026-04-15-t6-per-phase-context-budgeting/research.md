# Research — t6-per-phase-context-budgeting

## Approach A: Minimal — inline warning in LoadedContext, lean new CLI command

Add two fields to `LoadedContext` (`warning`, `droppedOptionals`), update `CONTEXT_MANIFESTS` constants, add skeleton-fallback branch in the optional-loader loop, thread `warning` through `instruction-generator.ts` into JSON, and add `context-stats.ts` CLI command that iterates artifact kinds by calling `ContextEngine.resolve()` for each.

**Pros:** Small surface. No new abstraction. Existing tests continue to pass with additive field presence.
**Cons:** Budget numbers remain TypeScript constants — future config-driven budgets require refactor.

## Approach B: Extract BudgetPolicy module + registry

Hoist budgets into `src/context/budget-policy.ts` with a `BudgetPolicy` class injecting into `ContextEngine`. Allows runtime override, per-change policies, and dynamic scaling.

**Pros:** Prepares ground for T9 plugin system and T3 constitutional gates (budget-as-policy).
**Cons:** Over-engineered for this change. Adds a class that currently has one implementation. Defer until a second caller exists.

## Chosen: Approach A

Rationale — metta v0.1 discipline is "no abstraction without a second concrete use case." The new budget numbers live in the existing manifests table. `BudgetPolicy` can be extracted later when config-loader or plugin system needs it, without breaking API.

## Open questions resolved

- **Q:** Should `stories` have its own manifest entry or inherit from intent?
  **A:** Its own entry, since stories currently has no entry (falls back to default 20K budget). Set to 50K matching intent tier.

- **Q:** Should warnings be errors or informational?
  **A:** Informational only. `metta context stats` exits 0 even when over-budget. `metta instructions` still returns successfully with the warning field populated.

- **Q:** Skeleton fallback — should it apply to required deps too?
  **A:** No. Required deps were explicitly requested by the manifest author; silently skeletoning them would change agent semantics. Required deps keep current truncation behavior.

## Grounding

- `src/context/context-engine.ts:36-43` — existing CONTEXT_MANIFESTS table to update
- `src/context/context-engine.ts:101-119` — optional-loader loop where skeleton-fallback inserts
- `src/context/instruction-generator.ts:99-101` — where `budget.warning` surfaces
- `src/cli/commands/validate-stories.ts` — reference pattern for a new CLI command with `--change`/`--json`
- `spec/specs/context-engine/spec.md` — authoritative spec that this change MODIFIES

## Risk / Mitigation

- **Risk:** Larger budgets cause more file I/O per agent spawn.
  **Mitigation:** Existing LRU cache on content hash already covers this; no change to loader hot path.
- **Risk:** Skeleton-fallback silently changes what the agent sees for oversize optional deps.
  **Mitigation:** The `strategy` field on each `LoadedFile` and `dropped_optionals` in instructions JSON make the transformation visible.
