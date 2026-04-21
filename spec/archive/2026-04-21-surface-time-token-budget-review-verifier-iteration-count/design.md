# Design: surface-time-token-budget-review-verifier-iteration-count

## Overview

Extend `ChangeMetadataSchema` with four optional fields that travel with
existing state, piggyback writes on two existing CLI commands, add one new
small CLI command for iteration recording, extend two renderers, and update
five skill templates to call the new command inside their review-fix and
verify-fix loops. No new modules, no new stores, no new files beyond one
small command module and its test.

## Module map

### Modified files

| File | Change | LoC |
|------|--------|-----|
| `src/schemas/change-metadata.ts` | Add 4 optional fields to `ChangeMetadataSchema` | +25 |
| `src/cli/commands/complete.ts` | Stamp `artifact_timings[id].completed` on mark-complete | +15 |
| `src/cli/commands/instructions.ts` | Stamp `artifact_timings[id].started` (once) + `artifact_tokens[id]` | +25 |
| `src/cli/commands/progress.ts` | Render secondary line per change; git-log fallback | +120 |
| `src/cli/commands/status.ts` | Render `Tokens:` + `Iterations:` lines | +25 |
| `src/cli/index.ts` | Register new `iteration` command | +2 |
| `src/templates/skills/metta-propose/SKILL.md` | Add `metta iteration record` calls | +4 |
| `src/templates/skills/metta-quick/SKILL.md` | Add `metta iteration record` calls | +4 |
| `src/templates/skills/metta-fix-issues/SKILL.md` | Add `metta iteration record` calls | +4 |
| `src/templates/skills/metta-fix-gap/SKILL.md` | Add `metta iteration record` calls | +4 |
| `src/templates/skills/metta-auto/SKILL.md` | Add `metta iteration record` calls | +4 |

### New files

| File | Purpose | LoC |
|------|---------|-----|
| `src/cli/commands/iteration.ts` | Commander subcommand `iteration record --phase <review\|verify>` | ~80 |
| `src/util/duration.ts` | `formatDuration(ms: number): string` helper for `<N>s`, `<N>m <N>s`, `<N>h <N>m` | ~35 |
| `src/util/git-log-timings.ts` | `getGitLogTimings(changeDir, fileName): Promise<{ first: Date; last: Date } \| null>` | ~40 |

### New test files (maintain 1:1 ratio)

- `src/schemas/change-metadata.test.ts` — extend existing or add; cover the four new optional fields (accept / reject / preserve).
- `src/cli/commands/iteration.test.ts` — cover the new command's happy paths and error paths.
- `src/cli/commands/complete.test.ts` — extend existing; assert `completed` stamped, `started` preserved.
- `src/cli/commands/instructions.test.ts` — extend existing; assert `started` stamped once and `artifact_tokens` written.
- `src/cli/commands/progress.test.ts` — extend existing; assert secondary line rendering and suppression.
- `src/cli/commands/status.test.ts` — extend existing; assert `Tokens:` / `Iterations:` lines.
- `src/util/duration.test.ts` — cover `<N>s`, `<N>m <N>s`, `<N>h <N>m` branches.
- `src/util/git-log-timings.test.ts` — cover present-file, missing-file, no-git branches.

Total estimated delta: ~500 LoC of source, ~700 LoC of tests.

## Data model change

Appended fields on `ChangeMetadataSchema`:

```ts
const ArtifactTimingSchema = z.object({
  started: z.string().datetime().optional(),
  completed: z.string().datetime().optional(),
}).strict()

const ArtifactTokensSchema = z.object({
  context: z.number().int().nonnegative(),
  budget: z.number().int().nonnegative(),
}).strict()

export const ChangeMetadataSchema = z.object({
  // ...existing fields unchanged...
  artifact_timings: z.record(z.string(), ArtifactTimingSchema).optional(),
  artifact_tokens: z.record(z.string(), ArtifactTokensSchema).optional(),
  review_iterations: z.number().int().nonnegative().optional(),
  verify_iterations: z.number().int().nonnegative().optional(),
}).strict()
```

Back-compat: every new field is `.optional()`, schema stays `.strict()`,
`schema_version` untouched.

## Write sites — data flow

### `metta complete <artifact>`

Current flow (`src/cli/commands/complete.ts` line 156):
```ts
await ctx.artifactStore.markArtifact(changeName, artifactId, 'complete')
```

New flow (wrapped in try/catch so instrumentation never blocks):
```ts
await ctx.artifactStore.markArtifact(changeName, artifactId, 'complete')

try {
  const meta = await ctx.artifactStore.getChange(changeName)
  const timings = { ...(meta.artifact_timings ?? {}) }
  const existing = timings[artifactId] ?? {}
  timings[artifactId] = { ...existing, completed: new Date().toISOString() }
  await ctx.artifactStore.updateChange(changeName, { artifact_timings: timings })
} catch (err) {
  process.stderr.write(`Warning: failed to record completion timestamp: ${err}\n`)
}
```

Note: the same stamping path is used when the artifact is marked `skipped`
elsewhere in the complete flow (downscale/upscale can mark stages
`skipped`); the helper is extracted to `stampArtifactCompleted(ctx,
changeName, artifactId)` to avoid duplication.

### `metta instructions <artifact>`

Current flow (`src/cli/commands/instructions.ts` line 67): returns `output`
with `output.budget = { context_tokens, budget_tokens }`.

Insert before the banner / JSON emission (best-effort, never aborts):
```ts
try {
  const timings = { ...(metadata.artifact_timings ?? {}) }
  const existing = timings[artifactId] ?? {}
  if (!existing.started) {
    timings[artifactId] = { ...existing, started: new Date().toISOString() }
  }
  const tokens = { ...(metadata.artifact_tokens ?? {}) }
  tokens[artifactId] = {
    context: output.budget.context_tokens,
    budget: output.budget.budget_tokens,
  }
  await ctx.artifactStore.updateChange(changeName, {
    artifact_timings: timings,
    artifact_tokens: tokens,
  })
} catch (err) {
  process.stderr.write(`Warning: failed to record instructions metrics: ${err}\n`)
}
```

`started` is idempotent (set once); `artifact_tokens[id]` is overwritten
each call (re-instructing may reflect updated content).

### `metta iteration record --phase <review|verify> --change <name>`

New command module `src/cli/commands/iteration.ts`:

```ts
import { Command } from 'commander'
import { createCliContext, outputJson } from '../helpers.js'

export function registerIterationCommand(program: Command): void {
  const iteration = program.command('iteration').description('Record iteration counters')
  iteration
    .command('record')
    .description('Increment review or verify iteration counter')
    .requiredOption('--phase <phase>', 'review | verify')
    .option('--change <name>', 'Change name')
    .action(async (options) => {
      const json = program.opts().json
      const ctx = createCliContext()
      try {
        if (options.phase !== 'review' && options.phase !== 'verify') {
          throw new Error(`--phase must be 'review' or 'verify' (got '${options.phase}')`)
        }
        const changes = await ctx.artifactStore.listChanges()
        const changeName = options.change ?? (changes.length === 1 ? changes[0] : null)
        if (!changeName) {
          throw new Error(changes.length === 0
            ? 'No active changes.'
            : `Multiple changes: ${changes.join(', ')}. Use --change <name>.`)
        }
        const meta = await ctx.artifactStore.getChange(changeName)
        const key = options.phase === 'review' ? 'review_iterations' : 'verify_iterations'
        const next = (meta[key] ?? 0) + 1
        await ctx.artifactStore.updateChange(changeName, { [key]: next })
        if (json) outputJson({ change: changeName, phase: options.phase, count: next })
        else console.log(`Recorded ${options.phase} iteration #${next} for ${changeName}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (json) outputJson({ error: { code: 4, type: 'iteration_error', message } })
        else console.error(`Iteration record failed: ${message}`)
        process.exit(4)
      }
    })
}
```

Registered in `src/cli/index.ts` between existing `registerProgressCommand`
and `registerImportCommand`:
```ts
import { registerIterationCommand } from './commands/iteration.js'
// ...
registerIterationCommand(program)
```

Guard whitelist: `metta iteration record` is **not** in the set of
skill-required commands enforced by `metta-guard-bash`, so no hook change is
needed. The skill templates invoke it with the existing `METTA_SKILL=1`
prefix for consistency, not for guard clearance.

## Read sites — renderer changes

### `src/util/duration.ts` (new)

```ts
export function formatDuration(ms: number): string {
  if (ms < 0) return '0s'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}
```

### `src/util/git-log-timings.ts` (new)

Uses `execFile('git', ['log', '--format=%aI', '--', relativePath], { cwd:
projectRoot })` to pull ISO author timestamps. Returns `{ first, last }` or
`null` when git errors, there are no commits, or the file is untracked. All
errors caught and swallowed — fallback must never throw into the renderer.

### `src/cli/commands/progress.ts`

Augment `active` entries with the four new fields and a computed
`timingsByArtifact` (preferring `artifact_timings` from metadata; falling
back to `getGitLogTimings` per artifact when absent or incomplete). JSON
output gains `artifact_timings`, `artifact_tokens`, `review_iterations`,
`verify_iterations` verbatim.

Human output adds one line after the existing pipeline line:

```
         ⏱ intent 2m 14s · spec 3m 01s   📊 4k / 60k tokens   ↻ review ×2, verify ×1
```

Construction rules:
- **Time segment** (prefix `⏱ `, two-space separator after): include each
  artifact that has both start+end (from metadata) or both commits (from git
  fallback), in the workflow's artifact order; omit when none qualify.
- **Token segment** (prefix `📊 `): sum `context` and `budget` across all
  populated `artifact_tokens` entries; round to nearest thousand for
  display; omit when `artifact_tokens` is empty or absent.
- **Iteration segment** (prefix `↻ `): include `review ×<N>` if
  `review_iterations > 0`, include `verify ×<M>` if `verify_iterations > 0`;
  join with `, `; omit the whole segment when both are 0/absent.

### `src/cli/commands/status.ts`

After the existing complexity status line, append when populated:

```
Tokens: 4k / 60k
Iterations: review ×2, verify ×1
```

Suppress each line when its inputs are absent or all-zero. JSON output is
unchanged — the `...metadata` spread already carries the new fields
through.

## Skill template updates

Each of the five skill files follows the same pattern. Example for
`metta-propose/SKILL.md`, inside the REVIEW step (step 6) of that template:

```md
- **REVIEW-FIX LOOP (repeat until clean):**
  a. Run `METTA_SKILL=1 metta iteration record --phase review --change <name>`
  b. If any critical issues found:
     ...existing...
```

Analogous insertion in step 7 VERIFICATION for `--phase verify`. The
iteration is recorded at the top of the loop so that even a single
round (which may not require fix-and-re-review) is counted correctly.

Files updated:
- `src/templates/skills/metta-propose/SKILL.md` (steps 6 and 7)
- `src/templates/skills/metta-quick/SKILL.md` (its review loop)
- `src/templates/skills/metta-fix-issues/SKILL.md` (its review and verify loops)
- `src/templates/skills/metta-fix-gap/SKILL.md` (its review and verify loops)
- `src/templates/skills/metta-auto/SKILL.md` (its review loop inside the `auto` cycle)

Copies in `.claude/skills/...` are regenerated by `metta-refresh` and are
not hand-edited here.

## Failure modes & edge cases

- **State write failure in `complete` / `instructions`:** caught, logged to
  stderr, never aborts the command. Workflow proceeds.
- **Zod rejects a hand-edited `.metta.yaml` with bad new fields:** existing
  error surface is used (`StateStore.read` throws, `getChange` propagates).
  No new error code needed.
- **Unknown change for `iteration record`:** existing `listChanges`-based
  lookup produces the same error surface as `metta status` — exit code 4.
- **Non-existent artifact in `timings` / `tokens` maps:** these are
  `Record<string, ...>` so no referential-integrity constraint. A stale
  entry is harmless; renderers iterate the keys present.
- **Clock skew on `completed`:** system clock is used. Same as the existing
  `created` field; no new concern.
- **Git not available for fallback:** `git-log-timings.ts` returns `null`
  and the time segment is suppressed for that change.

## Test plan (summary)

- **Schema:** round-trip new fields, reject negatives, accept undefined.
- **Complete:** stamps `completed`; preserves `started`; survives state
  write errors.
- **Instructions:** stamps `started` once; writes `artifact_tokens`;
  survives state write errors.
- **Iteration:** increments; independent counters; auto-selects single
  change; rejects invalid phase; rejects unknown change.
- **Progress:** JSON includes new fields; human renders/suppresses
  segments correctly; git fallback path runs for a change with no
  `artifact_timings`.
- **Status:** JSON unchanged shape; human renders/suppresses
  `Tokens:` / `Iterations:` lines correctly.
- **Duration / git-log-timings utilities:** unit tests per helper.
- **Skill template content:** a simple grep-based test asserts each of the
  five updated SKILL.md files contains exactly one
  `metta iteration record --phase review` and one
  `metta iteration record --phase verify` (or just `--phase review` when
  the skill has no verify loop) at template copy.

## Artifacts Produced

- Schema: `src/schemas/change-metadata.ts` (4 optional fields)
- Command: `src/cli/commands/iteration.ts` (new)
- Utilities: `src/util/duration.ts`, `src/util/git-log-timings.ts` (new)
- Renderer edits: `src/cli/commands/progress.ts`,
  `src/cli/commands/status.ts`
- Write-site edits: `src/cli/commands/complete.ts`,
  `src/cli/commands/instructions.ts`
- Registration: `src/cli/index.ts`
- Skill edits: five SKILL.md templates under `src/templates/skills/`
