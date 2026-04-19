# Research: Auto-Downscale State Transition

Change: `adaptive-workflow-tier-selection-emit-complexity-score-after`
Date: 2026-04-19

---

## 1. Prompt Location

### Options surveyed

**Option A — Inside `metta complete intent` handler (complete.ts)**

The complete command already gates on artifact ID. After the existing `markArtifact(changeName, 'intent', 'complete')` call (line 134 of complete.ts), the handler has access to `metadata.workflow`, the computed `complexity_score` (already written to `.metta.yaml` by the scorer at intent-authoring time), and the full `graph`. This is the natural injection point because:

- The handler runs exactly once per intent completion.
- All required state (workflow name, score, artifact list) is already loaded in scope.
- The git auto-commit block at lines 198–207 follows immediately, giving a clean "prompt → mutate → commit" sequence without coordination across modules.
- The existing `artifactId === 'stories'` and `artifactId === 'spec'` branches (lines 88, 113) establish the precedent for per-artifact logic inside this handler.

Cost: `complete.ts` already has ~215 lines; the block adds ~40–50 lines. This is manageable within the established pattern.

**Option B — Shared `post-intent` hook / lifecycle hook system**

Would require introducing a hook registry, wiring it into the command loop, and solving how the hook receives the interactive prompt channel (TTY detection, `json` flag). No hook system exists in the codebase today. This adds a new abstraction whose only consumer is this one prompt. Overhead is disproportionate.

**Option C — Separate `metta downscale` command**

A standalone command would require the AI orchestrator to explicitly invoke it, changing the skill flow. The spec states the prompt fires as part of `metta complete intent` — a separate command would require the skill to call two commands for one user-visible action and would leave a window where the state is "intent complete but not downscaled." This breaks atomicity and conflicts with the spec text.

**Recommendation: Option A.** Insert the downscale block inside `complete.ts`, gated on `artifactId === 'intent'`, immediately after `markArtifact` and before the "determine next artifact" block. This matches the existing per-artifact gate pattern.

---

## 2. Workflow Collapse Mechanism

### Options surveyed

**Option A — Re-run `workflowEngine.loadWorkflow('quick', …)` and replace artifacts map**

Load the target workflow (quick) afresh, build its artifact ID list from `graph.buildOrder`, then reconstruct the artifacts map: keep entries from the current map that exist in the target graph (preserving their status), drop all others.

Advantages:
- Source of truth is always the YAML definition; no hardcoded artifact lists.
- Handles future workflow changes automatically (if `quick.yaml` gains an artifact, the collapse stays correct).
- Uses the existing `loadWorkflow` path already imported at the call site.

Concrete steps for the Yes path:
1. Load `quick` workflow graph via `ctx.workflowEngine.loadWorkflow('quick', searchPaths)`.
2. Build `newArtifacts`: iterate `quickGraph.buildOrder`, copy status from existing map if present (intent is `complete`; implementation and verification are `pending`). Drop all artifact keys not in `quickGraph.buildOrder` (stories, spec, research, design, tasks).
3. Call `ctx.artifactStore.updateChange(changeName, { workflow: 'quick', artifacts: newArtifacts })`. `updateChange` does a `{ ...current, ...updates }` merge then validates through Zod before writing — the `ChangeMetadataSchema` will need to allow `complexity_score` as an optional field by this point (a parallel schema change in this same change).
4. Auto-commit covers the mutated `.metta.yaml`.

**Option B — Surgically delete keys from the existing artifacts map**

Hard-code the planning artifact IDs (`stories`, `spec`, `research`, `design`, `tasks`) and `delete` them from the record. Update `workflow` field.

Advantages: simpler code, no second loadWorkflow call.

Disadvantages: the list is baked into the implementation. If `standard.yaml` changes (e.g., a new `ux-research` artifact is added), the surgical delete misses it. The source of truth for "what planning artifacts a workflow has" is the YAML definition, not a constant list.

**Recommendation: Option A — re-load the target workflow.** It is only marginally more code and produces a collapse that stays correct as workflows evolve. The `loadWorkflow` call is already present in the handler (line 47), so the pattern is established. Re-invoking it for `'quick'` is a second call on an already-instantiated `WorkflowEngine` — the engine has an in-memory cache (`this.workflows` Map), so the quick graph will be cached after the first call within the same process.

Concrete field mutations (Yes path, in order):

1. `ctx.workflowEngine.loadWorkflow('quick', [projectWorkflows, builtinWorkflows])` → `quickGraph`
2. Derive `newArtifacts`: map `quickGraph.buildOrder` entries → copy from existing `metadata.artifacts` where present, default `'pending'` otherwise. (Intent is already `'complete'` so it carries through.)
3. `ctx.artifactStore.updateChange(changeName, { workflow: 'quick', artifacts: newArtifacts })`
4. Existing git auto-commit block (unchanged) stages and commits `spec/changes/<changeName>/` including the mutated `.metta.yaml`.

Git commit boundary: one commit covers both the `markArtifact('intent', 'complete')` state write and the downscale mutation, because both happen before the auto-commit block executes. The commit message is already `docs(<changeName>): complete intent` — no special commit is needed for the downscale; it is part of the same atomic changeset.

---

## 3. Prompt I/O Mechanism

### Options surveyed

**Option A — Native Node.js `readline.createInterface`**

`install.ts` already has an `askYesNo` helper (lines 92–100) using `node:readline`:

```typescript
function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() !== 'n')
    })
  })
}
```

This is already in the codebase. The default answer in `install.ts` is "not n = yes", but for the downscale prompt the default must be No (per spec). A local variant resolves `answer.trim().toLowerCase() === 'y'` instead.

TTY detection: `process.stdin.isTTY` is the standard Node.js way to detect whether stdin is a terminal. When piped (CI, script), `process.stdin.isTTY` is `undefined` (falsy). `process.stdout.isTTY` detects whether stdout is a terminal — preferable to check both, but `process.stdin.isTTY` is the canonical signal for interactive input availability.

**Option B — Third-party prompt library (inquirer, prompts, @inquirer/prompts)**

`package.json` has no prompt library. Adding one introduces a dependency for a single `[y/N]` prompt. Given the existing `readline` pattern in the codebase, adding a dependency is unjustified. `inquirer` v9+ is ESM-only and would be compatible, but the marginal benefit over raw `readline` for a yes/no prompt is zero.[^1]

**Option C — Write prompt text to stderr, read one line from stdin directly**

`process.stderr.write('prompt text')` + `process.stdin.once('data', …)`. More brittle (does not handle readline buffering, echoing). The `readline` interface handles all of that correctly.

**Recommendation: Option A — native `node:readline`, local variant of `askYesNo` with default-No semantics.** Move a shared `askYesNo(question, defaultYes: boolean)` helper to `src/cli/helpers.ts` so both `install.ts` and `complete.ts` can use it without duplication.

Non-TTY detection logic:

```
const isTTY = Boolean(process.stdin.isTTY)
const isJson = program.opts().json
if (!isTTY || isJson) {
  // skip prompt, default No, print advisory to stderr
}
```

Checking both `process.stdin.isTTY` and `--json` covers the two suppression cases from the spec. The `--json` flag is already accessible in `complete.ts` via `program.opts().json` (line 31).

[^1]: https://www.npmjs.com/package/inquirer — accessed 2026-04-19. Confirmed ESM-only for v9+; no breaking change to non-TTY behavior from training knowledge.

---

## 4. Edge Cases

### 4a. User already wrote planning artifacts that are now being dropped

If the user has written (but not yet marked complete) `stories.md`, `spec.md`, etc., and accepts the downscale, those files remain on disk under `spec/changes/<changeName>/`. The downscale only removes them from the artifacts map in `.metta.yaml` — it does not delete the files.

Implications:
- The files are orphaned but harmless. They will be included in the auto-commit since the git add targets `spec/changes/<changeName>/`.
- `metta finalize` and `metta ship` operate on the artifacts map, not the filesystem contents, so orphaned files do not interfere with finalization.
- The spec does not require file deletion on downscale. Leaving files on disk is the safe default — no data loss.
- If the implementation requires a clean directory, a follow-up pass can delete orphaned artifact files by diffing the old vs. new artifact generates list. This is a deferred concern.

### 4b. Atomicity — prompt aborts mid-write

The sequence is: `markArtifact(intent, complete)` writes `.metta.yaml` once. Then, if the user answers Yes, `updateChange` writes `.metta.yaml` a second time. If the process is killed between the two writes, `.metta.yaml` lands in the "intent complete, workflow still standard" state — a valid state. The next `metta complete intent` invocation would be blocked by the stub/content check (intent is already complete) so it cannot fire again. Recovery path: run `metta status` to inspect state; the AI can call `updateChange` directly or re-run a targeted downscale. The state is not corrupted — it is simply in the un-downscaled branch, identical to a "user answered No" outcome. This is acceptable without further locking.

The `StateStore` does not use file locks for `.metta.yaml` writes (locking exists but is not invoked from `updateChange`). Given the CLI is single-process-per-invocation, concurrent write races are not a concern in practice.

### 4c. `--workflow` explicit flag — suppression of prompt

The spec (OverrideRemainsAuthoritative requirement) says the prompt MUST be suppressed when `--workflow` was explicitly passed. However, `complete.ts` receives no knowledge of whether `--workflow` was set during `propose`. The proposed mechanism: when `metta propose --workflow <name>` is used, write a `workflow_locked: true` boolean to `.metta.yaml`. `complete.ts` reads this flag and suppresses the prompt. Alternatively, the caller-side approach: the `metta-propose` skill passes no flag information to `metta complete` directly, so the lock field in state is the only reliable signal.

Schema implication: `ChangeMetadataSchema` needs `workflow_locked: z.boolean().optional()` in addition to `complexity_score`.

### 4d. Already-quick workflow — no prompt

Check: `metadata.workflow === 'quick'` (or compare tier indices). If current workflow is already at or below recommended tier, skip. This is a simple equality/index comparison before the TTY check.

### 4e. Complexity score absent at complete-intent time

If `complexity_score` is absent (scorer has not run yet or scoring failed silently), the downscale block must be skipped entirely. Guard: `if (!metadata.complexity_score) return` before any prompt logic.

---

## 5. Recommendation Per Sub-Question

### Sub-question 1: Where does the prompt fire?

**Inside `complete.ts`, gated on `artifactId === 'intent'`, after `markArtifact` and before the "determine next artifact" block.** This matches the existing per-artifact gate pattern (stories-valid gate, spec-delta gate), requires no new abstraction, and preserves the single-commit boundary.

### Sub-question 2: How is workflow collapse applied?

**Re-load the target workflow via `workflowEngine.loadWorkflow('quick', searchPaths)` and reconstruct the artifacts map from its `buildOrder`, carrying forward existing statuses.** Then call `updateChange({ workflow: 'quick', artifacts: newArtifacts })`. This keeps the YAML definitions as the single source of truth and avoids hardcoding the planning artifact list.

### Sub-question 3: Prompt mechanism

**Native `node:readline` `createInterface` with a `default-No` variant of the existing `askYesNo` pattern from `install.ts`.** Extract a shared `askYesNo(question: string, defaultYes?: boolean): Promise<boolean>` into `src/cli/helpers.ts`. Suppress when `!process.stdin.isTTY || program.opts().json`. No new dependencies required.
