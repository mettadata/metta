# surface-time-token-budget-review-verifier-iteration-count

## Problem

`metta progress` and `metta status` today show the artifact pipeline (which
artifacts are `pending` / `ready` / `in_progress` / `complete`) and a percent
complete, but they show nothing about how the change is performing along three
axes users repeatedly ask about:

1. **Wall-clock time per artifact** — Users running `metta auto` or working a
   change across multiple sessions have no answer to "how long did intent
   actually take?" or "which artifact is the bottleneck?". The change file
   records a single `created` timestamp; there is no per-artifact `started`
   or `completed`.
2. **Token budget consumed vs. budgeted** — `metta instructions <artifact>`
   already returns a `budget` block (`context_tokens`, `budget_tokens`) that
   the context engine computes from real files. After the call returns, the
   number is thrown away. Users cannot see, during or after a change, whether
   they are near budget — and the `token-counter.ts` estimator is trivially
   reusable against any text the framework already has on disk.
3. **Review / verify iteration count** — The `metta-propose`, `metta-quick`,
   `metta-fix-issues`, `metta-fix-gap`, and `metta-auto` skill instructions
   all run a "max 3" review-fix loop and a verify-fix loop, but no state file
   records how many iterations a change went through. When a change ships,
   that signal is lost; when a change stalls at iteration 3, the user cannot
   see the count reported back.

Two backlog items track this:

- `show-time-and-token-budget-during-metta-change-lifecycle` (medium)
- `surface-review-verifier-iteration-count-in-progress-indicato` (low)

Affected: every developer using metta — the progress indicator is the primary
"how is my change doing" surface.

## Proposal

Surface the three metrics by extending state that metta already writes, and by
adding **thin**, optional fields to `ChangeMetadata`. No new telemetry pipeline,
no new daemon, no new store — just read timestamps, record the already-computed
budget, and add two integer counters for review / verify loops.

Concretely:

1. **Extend `ChangeMetadataSchema`** (all new fields `.optional()` for
   back-compat with existing `.metta.yaml` files) with:
   - `artifact_timings?: Record<string, { started?: ISO-string; completed?: ISO-string }>`
   - `artifact_tokens?: Record<string, { context: number; budget: number }>`
   - `review_iterations?: number` (default 0)
   - `verify_iterations?: number` (default 0)
2. **Write on existing call sites** with zero new commands the orchestrator
   must remember:
   - `metta instructions <artifact>` stamps `started` + records the `budget`
     block's `context_tokens` and `budget_tokens` into `artifact_tokens`.
   - `metta complete <artifact>` stamps `completed`.
   - A new lightweight CLI, `metta iteration record --phase review|verify
     --change <name>`, increments the matching counter. The skills already run
     these loops with an orchestrator-visible counter; we make them record it.
3. **Extend `metta progress` and `metta status`** (both JSON and human
   output) to render the new info — one secondary line per change:
   `⏱  intent 2m 14s · spec 3m 01s · …   📊  46k / 20k tokens   ↻  review ×2, verify ×1`.
   When a field is missing (older changes), suppress its segment; never error.
4. **Fallback for changes without timings** — `metta progress` derives
   per-artifact wall-clock from `git log` of the file in
   `spec/changes/<change>/` when `artifact_timings` is absent. Git is already
   the transaction log; this is a free, retroactive answer.

## Impact

**Read-side consumers of `ChangeMetadata`:**

- `src/cli/commands/progress.ts` — gains a new rendered line per change.
- `src/cli/commands/status.ts` — gains a new rendered line per change.
- `src/cli/commands/complete.ts` — writes `artifact_timings[id].completed`.
- `src/cli/commands/instructions.ts` — writes `artifact_timings[id].started`
  and `artifact_tokens[id]`.
- **New file:** `src/cli/commands/iteration.ts` — registers `metta iteration`
  subcommands.
- **Skill updates** (`src/templates/skills/metta-propose/SKILL.md`,
  `metta-quick`, `metta-fix-issues`, `metta-fix-gap`, `metta-auto`): insert a
  single `METTA_SKILL=1 metta iteration record --phase review` line at the top
  of each review-fix loop iteration, and the analogous line for verify-fix
  loops. Existing "max 3" language is untouched.

**Back-compat:** All new fields are optional. Existing `.metta.yaml` files
continue to validate. The Zod schema version does not change. Renderers
suppress segments whose data is absent.

**Persistence cost:** Four small optional fields per change. No new files, no
index, no separate log. Iteration counters are integers. Timings are ISO
strings. Token counts are the numbers `metta instructions` already computes
and discards.

## Out of Scope

- **Session-wide LLM token accounting** — we are NOT counting tokens sent to
  or received from the Anthropic API across the orchestrator session. We
  surface only the context-budget number that the `context-engine` already
  computes from on-disk artifact content. Hooking provider-level usage is a
  separate, larger change.
- **Wall-clock gate timing** — we are NOT breaking out "how long did the
  test gate take" vs. "how long did the lint gate take". Artifact-level
  granularity is the deliverable.
- **Historical backfill** — we are NOT rewriting existing `.metta.yaml`
  files under `spec/archive/` to add the new fields. Existing changes remain
  as-is; git-log derivation covers them for `progress`.
- **Cross-change aggregation / trends** — no "average time per spec artifact
  across the last 10 changes" dashboard. Per-change display only.
- **Token / time budgets as hard limits** — we are NOT adding enforcement
  that blocks a change when it exceeds a threshold. This is a display-only
  change; alerting is a future item.
- **Change to the schema version** — schema_version is not bumped because
  all additions are optional.
