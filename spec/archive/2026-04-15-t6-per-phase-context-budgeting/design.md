# Design — t6-per-phase-context-budgeting

## Data types

```ts
// src/context/context-engine.ts
export interface LoadedContext {
  files: LoadedFile[]
  totalTokens: number
  budget: number
  truncations: string[]
  warning: 'smart-zone' | 'over-budget' | null     // NEW
  droppedOptionals: string[]                        // NEW
}
```

```ts
// src/context/instruction-generator.ts
export interface InstructionOutput {
  // ...existing fields...
  budget: {
    context_tokens: number
    budget_tokens: number
    warning?: 'smart-zone' | 'over-budget'          // NEW
    dropped_optionals?: string[]                     // NEW (present iff warning present)
  }
}
```

## Manifest updates (src/context/context-engine.ts)

```ts
const CONTEXT_MANIFESTS: Record<string, ContextManifest> = {
  intent:        { required: [],                          optional: ['project_context', 'existing_specs'],                               budget:  50_000 },
  stories:       { required: ['intent'],                  optional: ['project_context', 'existing_specs'],                               budget:  50_000 },  // NEW
  spec:          { required: ['intent', 'stories'],       optional: ['project_context', 'existing_specs', 'research'],                   budget:  60_000 },
  research:      { required: ['spec'],                    optional: ['project_context', 'existing_specs', 'architecture'],               budget:  80_000 },
  design:        { required: ['research', 'spec'],        optional: ['architecture', 'project_context'],                                 budget: 100_000 },
  tasks:         { required: ['design', 'spec'],          optional: ['research_contracts', 'research_schemas', 'architecture'],          budget: 100_000 },
  execution:     { required: ['tasks'],                   optional: ['research_contracts', 'research_schemas'],                          budget: 150_000 },
  verification:  { required: ['spec', 'tasks', 'summary'],optional: ['research_contracts', 'research_schemas', 'design'],                budget: 120_000 },
}
```

## Skeleton-fallback logic (optional-loader loop)

After a file fails to fit `remaining` but the artifact is optional:
1. If `loaded.tokens > remaining` AND this is an optional source: call `headingSkeleton(content)`.
2. If skeleton tokens ≤ remaining: load with `strategy: 'skeleton'`.
3. Else: push source path to `droppedOptionals`, do not load.

Implementation inside `resolve()` — refactor the optional block:
```ts
for (const source of manifest.optional) {
  const remaining = budget - totalTokens
  if (remaining < 100) { droppedOptionals.push(source); continue }
  const filePath = this.resolveSourcePath(source, changePath, specDir)
  try {
    const content = await readFile(filePath, 'utf-8')
    const tokens = countTokens(content)
    if (tokens <= remaining) {
      // fit as-is via existing loadFile cache path
      const loaded = await this.loadFile(filePath, remaining)
      files.push(loaded); totalTokens += loaded.tokens
    } else {
      const skeleton = this.headingSkeleton(content)
      const skeletonTokens = countTokens(skeleton)
      if (skeletonTokens <= remaining) {
        files.push({ path: filePath, content: skeleton, tokens: skeletonTokens,
                     hash: contentHash(content), loadedAt: new Date().toISOString(),
                     truncated: false, strategy: 'skeleton' })
        totalTokens += skeletonTokens
      } else {
        droppedOptionals.push(source)
      }
    }
  } catch {
    // missing optional — silent skip (no droppedOptionals entry — the source wasn't "dropped", it didn't exist)
  }
}
```

## Warning derivation (end of `resolve()`)

```ts
const utilization = budget === 0 ? 0 : totalTokens / budget
let warning: 'smart-zone' | 'over-budget' | null = null
if (droppedOptionals.length > 0 || truncations.length > 0 || utilization >= 1.0) warning = 'over-budget'
else if (utilization >= 0.8) warning = 'smart-zone'
return { files, totalTokens, budget, truncations, warning, droppedOptionals }
```

## Instruction-generator passthrough

```ts
const budget: InstructionOutput['budget'] = {
  context_tokens: context.totalTokens,
  budget_tokens: context.budget,
}
if (context.warning) {
  budget.warning = context.warning
  budget.dropped_optionals = context.droppedOptionals
}
return { ...existing, budget, ... }
```

## New CLI command: `metta context stats`

File: `src/cli/commands/context-stats.ts`

```ts
program.command('context')
  .description('Context introspection commands')
  .command('stats')
  .option('--change <name>')
  .option('--artifact <kind>')
  .action(async (options) => {
    const ctx = createCliContext()
    const changeName = await resolveChangeName(ctx, options.change)
    assertSafeSlug(changeName, 'change name')
    const changePath = join(ctx.specDir, 'changes', changeName)
    const kinds = options.artifact ? [options.artifact] : ARTIFACT_KINDS
    const rows = await Promise.all(kinds.map(async k => {
      const loaded = await ctx.contextEngine.resolve(k, changePath, ctx.specDir)
      const utilization = loaded.budget === 0 ? 0 : loaded.totalTokens / loaded.budget
      return {
        artifact: k, tokens: loaded.totalTokens, budget: loaded.budget,
        utilization, recommendation: recommend(k, utilization),
        droppedOptionals: loaded.droppedOptionals,
      }
    }))
    if (json) outputJson({ change: changeName, artifacts: rows })
    else printTable(rows)
  })

function recommend(kind: string, utilization: number): string {
  if (utilization < 0.8) return 'ok'
  if (utilization < 1.0) return 'smart-zone'
  return kind === 'execution' ? 'fan-out' : 'split-phase'
}
```

Constant: `ARTIFACT_KINDS = ['intent','stories','spec','research','design','tasks','execution','verification']`.

Wire in `src/cli/index.ts` alongside other commands.

## Test surface

- `tests/context-engine.test.ts` — add warning derivation cases, skeleton-fallback case, droppedOptionals case.
- `tests/context-stats.test.ts` (new) — fixtures: under-budget, smart-zone, over-budget; JSON shape; missing-change error.
- `tests/instruction-generator.test.ts` — add case asserting `budget.warning` presence/absence.

## Backwards compatibility

- `LoadedContext.warning = null` and `droppedOptionals = []` for under-80% cases → existing JSON consumers see additive fields.
- Instruction-generator only adds `warning` / `dropped_optionals` when non-null → untouched existing call sites.
- No state-file schema changes. No migration needed.
