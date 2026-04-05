# 999 — Issue Suggestions & Proposed Fixes

Companion to [99-issues.md](99-issues.md). Each section maps to an issue by number.

---

## Critical Issues

### 1. AI provider failure handling

Add a **Provider Resilience** section to `07-execution-engine.md`. The provider registry already has role-based selection (main/research/fallback) — extend it with:

- **Retry policy per provider**: exponential backoff with jitter, configurable max retries
- **Fallback chain**: main fails → research model → fallback model → pause and surface to user
- **Garbage detection**: if the AI returns output that fails Zod schema validation (structured output) or is empty/truncated, treat it as a provider failure, not a gate failure
- **Mid-artifact recovery**: checkpoint the artifact state before each AI call so a retry doesn't lose partial work
- **Rate limit awareness**: if the provider returns 429, respect Retry-After header and pause the batch, not just the task

This naturally lives in the Provider Registry layer, not the Execution Engine — the engines should get a clean `Result<T, ProviderError>` back and route based on error type.

### 2. Context Engine / Agent System circular dependency

Break the cycle by splitting resolution into two phases:

1. **Agent resolution happens first** using only the workflow graph (artifact declares `agents: [architect]`, system resolves the YAML definition, reads `context_budget: 80000`). No context needed — it's just a config lookup.
2. **Context resolution happens second** using the resolved agent's budget as input.

Document this explicitly in `02-architecture.md` data flow. The current diagram shows them as parallel peers — redraw as sequential: `WorkflowEngine → AgentSystem.resolve() → ContextEngine.resolve(agent.budget)`. The agent doesn't need context to be *resolved*, it needs context to *execute*. Those are different steps.

### 3. Who calls the AI

This is the biggest design decision. Commit to a **dual-mode architecture** and make it explicit in `02-architecture.md`:

**Mode A — Orchestrator mode** (for `metta auto`, `metta quick` when run standalone): Metta drives the AI directly through the Provider Registry. The execution loop is: Context Engine prepares context → Provider generates output → Framework validates output → Gates run → next step. Add a new **Orchestration Layer** between the CLI and the core engines that owns this loop.

**Mode B — Instruction mode** (for slash commands, MCP tools): Metta generates instructions that an external AI tool executes. The AI tool calls back into Metta via CLI/MCP for status, instructions, and completion signals. The framework is passive.

The Provider Registry serves Mode A. Command Delivery serves Mode B. Both use the same Workflow/Context/Agent/Execution engines underneath. Make this the framing of the architecture doc — it clarifies a lot.

### 4. `metta documentation` vs `docs generate` naming

Three options, in order of preference:

**Option A — Rename the workflow step**: `metta documentation` → `metta finalize`. "Finalize" captures "archive + merge specs + generate docs + refresh" without colliding with `docs`. The workflow becomes: `verify → finalize → ship`.

**Option B — Rename the standalone command**: `metta docs generate` → `metta docs rebuild`. Weaker — the collision is really in `documentation` being an overloaded word.

**Option C — Subsume**: Make `metta docs generate` a subset of `metta finalize` and remove it as a standalone command. Users who just want docs run `metta finalize --docs-only`.

Also fix the `generate_on` config inconsistency — pick `finalize` (or whatever the step is called) and use it everywhere.

---

## Design Gaps

### 5. Multi-change coordination

Add a **conflict forecast** to `metta propose`:

```
metta propose "add refund processing"

Checking for conflicts with in-flight changes...
  ⚠ "add-subscription-billing" touches spec/specs/payments/spec.md
    Requirement overlap: Refund Processing
    Risk: medium (both modify the same requirement)
    Suggestion: coordinate with the other change or wait for it to ship

Proceed anyway? [y/n]
```

Implementation: scan `spec/changes/*/metta.yaml` for overlapping `base_versions` keys. If two changes share a base spec, flag it. This is cheap (local file reads) and catches most real conflicts. Document in `06-spec-model.md`.

### 6. Token counting

Add a **Tokenization** section to `04-context-engine.md`:

- Use a **character-based estimator** as the default (4 chars ≈ 1 token). Fast, no dependencies, good enough for budget enforcement where the goal is "don't waste context," not "hit exactly 40,000."
- Support **model-specific tokenizers** as an optional plugin. The Provider Registry knows which model is active — it can expose a `countTokens(text): number` method. When available, the Context Engine uses it; when not, falls back to the estimator.
- Budgets in context manifests are **approximate targets**, not hard limits. The engine logs actual vs budget for tuning. Over time, users adjust based on `metta context stats`.

This avoids a hard dependency on any tokenizer library while keeping the door open for precision.

### 7. Team/collaboration model

Don't try to build a full collaboration system. Instead, add a **Concurrency** section to `02-architecture.md` with these rules:

- `.metta/state.yaml` is **gitignored** — it's local execution state, not shared. Each developer has their own.
- `spec/changes/` is **committed** — this is how developers see each other's in-flight work. The conflict forecast from #5 reads these.
- Change ownership is implicit: whoever created the change directory owns it. Add an `owner` field to `.metta.yaml` (git username).
- For teams, recommend `git.create_pr: true` so `metta ship` creates a PR instead of merging directly. The PR is the coordination point, not Metta.

This keeps Metta simple while being team-usable. Don't reinvent Linear.

### 8. Rollback/undo coordination

Add a **State Rollback** section to `07-execution-engine.md`:

- When the merge safety pipeline creates a snapshot tag (step 5), also snapshot `.metta/state.yaml` content in the tag's commit message or a companion file.
- On rollback (`git reset --hard` to snapshot), also restore state from the snapshot.
- Alternatively (simpler): state tracks commit SHAs. On any git operation, the state store verifies its referenced commits still exist on the current branch. If a referenced commit is gone (rolled back), the state entry is marked `rolled_back` automatically.

The second approach is self-healing and doesn't require explicit rollback coordination.

### 9. Spec-compliance gate

Add a dedicated subsection under gates in `07-execution-engine.md`:

The spec-compliance gate is fundamentally different from other gates — it's **AI-powered verification**, not a shell command. Design it as:

- Input: the spec's Given/When/Then scenarios + the implementation summary
- Execution: the Provider calls the AI with a verification prompt asking it to check each scenario against the code
- Output: a structured `GateResult` with per-scenario pass/fail and evidence (file + line where the behavior is implemented, or "not found")
- Fallback: if the provider is unavailable, the gate degrades to a **checklist** surfaced to the user for manual verification

This gate should be opt-in for quick mode (where it's overkill) and required for standard/full. Document that it consumes provider tokens — it's not free like `npm test`.

---

## Inconsistencies

### 10. Quick workflow definition

Commit to **2 artifacts**: `intent → execution`. That's the whole point of quick mode — skip planning. The philosophy doc's 4-artifact version (`intent → spec → execute → verify`) is actually the standard workflow minus design/tasks. Fix `01-philosophy.md` to match.

Verification in quick mode happens through backpressure gates (tests, lint, typecheck), not a separate verification artifact. That's the design intent already stated elsewhere.

### 11. Full workflow definition

Create one canonical definition in `03-workflow-engine.md` and reference it everywhere else. Count the artifacts explicitly:

```
research, intent, spec, design, architecture, ux-spec, tasks, execution, verification, documentation
```

That's 10. The README is right. Update `01-philosophy.md` and `03-workflow-engine.md`'s DAG diagram to match. The DAG diagram in `03-workflow-engine.md` is missing `research` at the start and `documentation` at the end.

### 12. `generate_on` default

Pick `documentation` (the workflow step name) as the canonical value and update all references. If you rename the step per fix #4, update accordingly. Add a note that `ship` is accepted as an alias for backward compatibility but normalized to the canonical value.

### 13. Spec path references

Two options:

**Option A (simpler)**: Don't make the spec dir configurable in v1. Hardcode `spec/`. Remove the `spec.output` config key. You can add configurability later without breaking anything — it's purely additive.

**Option B**: If configurability is important, define a convention in the docs: all prose uses `spec/` as the default, all code/config examples use `{spec_dir}/` when the configurable path matters. Add a note at the top of `06-spec-model.md` saying paths are relative to the configured `spec.output`.

Recommendation: Option A for v1. Configurability here is premature — no one will change it until they have a strong reason, and by then you'll know the right abstraction.

---

## Minor Issues

### 14. `metta build` command

Either add it to the CLI reference in `09-cli-integration.md`, or remove the reference in `03-workflow-engine.md` and use `metta plan --target design` instead. Prefer the latter — fewer top-level commands is better, and `--target` on an existing command is more discoverable than a new command.

### 15. Metta self-update / schema migration

Add a brief section to `02-architecture.md`:

- On startup, Metta checks the schema version in `.metta/state.yaml` against the current framework version
- If the schema is older, run migrations automatically (Zod schemas define the migration path)
- If the schema is newer (user downgraded), refuse to run with a clear error
- `metta doctor` includes a schema version check

Keep it simple — this is an internal concern, not a user-facing feature.

### 16. `metta gate` command

Add to the CLI reference in `09-cli-integration.md`:

```bash
metta gate run <name>              # Run a specific gate manually
metta gate list                    # List all configured gates
metta gate show <name>             # Show gate config and last result
```

This is useful for debugging gate failures outside the execution loop.

### 17. Worktree cleanup

Add to `metta doctor` description:

- Scan for orphaned worktrees (worktrees whose branch has no corresponding active change in `spec/changes/`)
- Offer to clean them up interactively
- Also add `metta cleanup` as a direct command for just worktree/tag cleanup without the full diagnostic

Add a note in `07-execution-engine.md` that worktrees are created in a predictable location (e.g., `.metta/worktrees/` or a temp dir) so cleanup is straightforward.
