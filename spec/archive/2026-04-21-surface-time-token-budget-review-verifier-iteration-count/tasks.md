# Tasks for surface-time-token-budget-review-verifier-iteration-count

## Batch 1 (no dependencies — foundational schema + utilities)

- [x] **Task 1.1: Extend `ChangeMetadataSchema` with four optional fields**
  - **Files**: `src/schemas/change-metadata.ts`,
    `src/schemas/change-metadata.test.ts`
  - **Action**: Add `ArtifactTimingSchema` (object with optional
    `started`, `completed` ISO strings), `ArtifactTokensSchema` (object
    with non-negative int `context`, `budget`), and append four
    `.optional()` fields to `ChangeMetadataSchema`: `artifact_timings`,
    `artifact_tokens`, `review_iterations`, `verify_iterations`. Keep
    `.strict()`. Export both new sub-schemas. Add tests: round-trip, reject
    negatives, accept-undefined back-compat, preserve with
    `updateChange`-style merge.
  - **Verify**: `npx tsc --noEmit` passes; `npx vitest run src/schemas/change-metadata.test.ts`
    green; existing tests still pass.
  - **Done**: Schema accepts all new fields optionally, rejects negatives
    and wrong types, existing `.metta.yaml` files from archive still
    validate.

- [x] **Task 1.2: Add `formatDuration` utility**
  - **Files**: `src/util/duration.ts` (new),
    `src/util/duration.test.ts` (new)
  - **Action**: Implement `formatDuration(ms: number): string` with three
    branches: `<60s → "<N>s"`, `<1h → "<N>m <N>s"`, `>=1h → "<N>h <N>m"`.
    Clamp negatives to `0s`. Round to nearest second. Unit tests cover
    boundary values (59s, 60s, 3599s, 3600s) and negative input.
  - **Verify**: `npx vitest run src/util/duration.test.ts` green.
  - **Done**: Utility returns correct strings for all branches; negative
    clamp tested.

- [x] **Task 1.3: Add `git-log-timings` utility**
  - **Files**: `src/util/git-log-timings.ts` (new),
    `src/util/git-log-timings.test.ts` (new)
  - **Action**: Export `getGitLogTimings(projectRoot: string, relativePath:
    string): Promise<{ first: Date; last: Date } | null>` that runs
    `execFile('git', ['log', '--format=%aI', '--', relativePath])` in
    `projectRoot`, parses the lines, returns `{ first: last-line-as-Date,
    last: first-line-as-Date }`. Return `null` on any error or empty
    output. Never throw. Test with a temp git repo: file with 2 commits
    returns correct pair; untracked file returns `null`; non-git dir
    returns `null`.
  - **Verify**: `npx vitest run src/util/git-log-timings.test.ts` green.
  - **Done**: Utility returns correct pairs, returns `null` gracefully on
    all error paths.

## Batch 2 (depends on Batch 1 — write-side CLI instrumentation)

- [x] **Task 2.1: Stamp `artifact_timings[id].completed` in `metta complete`**
  - **Depends on**: Task 1.1
  - **Files**: `src/cli/commands/complete.ts`,
    `src/cli/commands/complete.test.ts`
  - **Action**: After the existing `markArtifact(..., 'complete')` and
    after any `skipped` branches (downscale paths), call a helper
    `stampArtifactCompleted(ctx, changeName, artifactId)` that reads
    metadata, merges `{ [artifactId]: { ...existing, completed: new
    Date().toISOString() } }` into `artifact_timings`, and writes back via
    `updateChange`. Wrap in try/catch; on error write a `Warning:` line
    to stderr but do not throw. Preserve any existing `started` value on
    the same key. Tests: (a) fresh complete populates `completed`; (b)
    prior `started` preserved; (c) write-failure path logs + returns.
  - **Verify**: `npx vitest run src/cli/commands/complete.test.ts` green;
    all other complete tests still pass.
  - **Done**: `.metta.yaml` after `metta complete intent` on a fresh change
    contains `artifact_timings.intent.completed` as a recent ISO string.

- [x] **Task 2.2: Stamp `artifact_timings[id].started` + `artifact_tokens[id]` in `metta instructions`**
  - **Depends on**: Task 1.1
  - **Files**: `src/cli/commands/instructions.ts`,
    `src/cli/commands/instructions.test.ts`
  - **Action**: After computing `output` (which contains
    `output.budget.context_tokens` and `output.budget.budget_tokens`),
    before emitting JSON/human output, in a try/catch: if
    `metadata.artifact_timings?.[artifactId]?.started` is undefined, set
    it to `new Date().toISOString()`; always set
    `artifact_tokens[artifactId] = { context, budget }`. Call
    `updateChange` once with both maps. Errors write `Warning:` to stderr
    but do not abort emission. Tests: (a) fresh call populates both; (b)
    second call preserves `started`; (c) second call overwrites
    `artifact_tokens` with new numbers; (d) write-failure path doesn't
    abort command.
  - **Verify**: `npx vitest run src/cli/commands/instructions.test.ts`
    green.
  - **Done**: `.metta.yaml` after `metta instructions intent` contains
    both `artifact_timings.intent.started` and `artifact_tokens.intent`;
    re-running does not bump `started`.

- [x] **Task 2.3: New `metta iteration record` CLI command**
  - **Depends on**: Task 1.1
  - **Files**: `src/cli/commands/iteration.ts` (new),
    `src/cli/commands/iteration.test.ts` (new), `src/cli/index.ts`
  - **Action**: Create `registerIterationCommand(program)` that registers
    a subcommand `iteration record` with `--phase <review|verify>`
    (required) and optional `--change <name>`. On invocation: validate
    phase, resolve change (auto-select single active), read metadata,
    increment the matching counter (treating missing as 0), write via
    `updateChange`, emit `{ change, phase, count }` JSON or one-line human
    message. Exit code 4 on error. Register in `src/cli/index.ts` beside
    `registerProgressCommand`. Tests: (a) first record sets to 1; (b)
    subsequent records increment; (c) phase isolation (review vs verify);
    (d) invalid phase rejected; (e) unknown change errors with exit 4; (f)
    single-change auto-select works.
  - **Verify**: `metta iteration record --phase review --change <test>`
    updates `.metta.yaml` correctly in a sandbox; `npx vitest run
    src/cli/commands/iteration.test.ts` green; `metta --help` lists
    `iteration`.
  - **Done**: All six test cases green; manual smoke test shows counter
    increments persisted.

## Batch 3 (depends on Batch 1 + 2 — read-side renderer updates)

- [x] **Task 3.1: Surface new fields in `metta progress` JSON + human output**
  - **Depends on**: Tasks 1.1, 1.2, 1.3
  - **Files**: `src/cli/commands/progress.ts`,
    `src/cli/commands/progress.test.ts`
  - **Action**: Extend the `active[]` JSON entries with `artifact_timings`,
    `artifact_tokens`, `review_iterations`, `verify_iterations` (omitting
    when undefined). In human output, after the existing pipeline line,
    emit a secondary line with three optional segments:
    1. `⏱ <artifact> <dur> · <artifact> <dur> · ...` — include an artifact
       when it has both `started` and `completed` in metadata, OR when
       `getGitLogTimings` returns a non-null pair for its file. Use
       `formatDuration` on the `last - first` diff.
    2. `📊 <ctx_sum>k / <bud_sum>k tokens` — include when
       `artifact_tokens` has at least one entry; sum `context` and
       `budget` across entries; divide by 1000 and `Math.round` for
       display.
    3. `↻ review ×<N>, verify ×<M>` — include `review ×<N>` when
       `review_iterations > 0`; include `verify ×<M>` when
       `verify_iterations > 0`; join with `, `; omit whole segment when
       both zero/absent.
    Join present segments with two spaces. Tests: (a) JSON carries new
    fields; (b) human renders all three when all data present; (c)
    suppresses missing segments individually; (d) git fallback renders
    time segment for a change with no `artifact_timings` but with commit
    history; (e) no error when git missing.
  - **Verify**: `npx vitest run src/cli/commands/progress.test.ts` green;
    manual smoke `metta progress --json` on a populated change shows new
    fields.
  - **Done**: All five test cases green; human output matches scenarios
    in spec.md.

- [x] **Task 3.2: Surface new fields in `metta status` human output**
  - **Depends on**: Task 1.1
  - **Files**: `src/cli/commands/status.ts`,
    `src/cli/commands/status.test.ts`
  - **Action**: In `printChangeStatus`, after the complexity status line,
    emit:
    - `Tokens: <ctx_sum>k / <bud_sum>k` when `artifact_tokens` is
      populated (same rounding as progress).
    - `Iterations: review ×<N>, verify ×<M>` when either counter > 0 (omit
      the zero half). Skip the whole line when both zero/absent.
    JSON output unchanged (the `...metadata` spread already carries the
    new optional fields through, which is asserted by a new test). Tests:
    (a) JSON includes new fields when set; (b) JSON omits them when
    absent (metadata just doesn't have them); (c) human renders both
    lines when populated; (d) suppresses each line independently; (e)
    legacy metadata prints cleanly with no error.
  - **Verify**: `npx vitest run src/cli/commands/status.test.ts` green.
  - **Done**: All five cases green; manual smoke `metta status
    <change>` matches spec scenarios.

## Batch 4 (depends on Batch 2 — skill template updates)

- [x] **Task 4.1: Insert `metta iteration record` calls in five skill templates**
  - **Depends on**: Task 2.3
  - **Files**: `src/templates/skills/metta-propose/SKILL.md`,
    `src/templates/skills/metta-quick/SKILL.md`,
    `src/templates/skills/metta-fix-issues/SKILL.md`,
    `src/templates/skills/metta-fix-gap/SKILL.md`,
    `src/templates/skills/metta-auto/SKILL.md`,
    `src/templates/skills/skills.test.ts` (new if absent; otherwise
    extend)
  - **Action**: For each of the five files, locate the review-fix loop
    (typically step 6 "REVIEW") and the verify-fix loop (typically step 7
    "VERIFICATION"). Insert at the top of each iteration, before the
    `Agent(...)` fan-out, a single bullet:
    `a. Run \`METTA_SKILL=1 metta iteration record --phase review --change <name>\``
    (and the analogous `--phase verify` line in the verify loop). Renumber
    subsequent bullets within that step. Do not modify the existing "max
    3" language or the parallel-fan-out guidance. `metta-quick` and
    `metta-auto` only have a review-fix loop in the relevant section
    (verify coverage in those skills is single-pass) — insert only the
    review line there unless their verify section clearly loops. Add a
    simple vitest that reads each of the five template files and asserts
    `content.includes('metta iteration record --phase review')` is true
    (and `--phase verify` when applicable).
  - **Verify**: `npx vitest run src/templates/skills/skills.test.ts`
    green; `npm run build` still copies templates to `dist/` (no regression
    on the template-pipeline).
  - **Done**: Five SKILL.md files updated; grep test green; build
    succeeds.

## Batch 5 (depends on all prior — verification sweep)

- [x] **Task 5.1: End-to-end verification and summary**
  - **Depends on**: Tasks 3.1, 3.2, 4.1
  - **Files**: `spec/changes/surface-time-token-budget-review-verifier-iteration-count/summary.md` (new)
  - **Action**: Run `npm run build`, `npx tsc --noEmit`, `npm run lint`,
    `npm test`. Write `summary.md` describing the change's shipped
    surface: the four schema fields, the new `iteration` command, the two
    new render lines, the git-log fallback, and the five skill template
    edits. Reference the spec's Given/When/Then scenarios that are now
    backed by tests. Commit.
  - **Verify**: All gates pass; `summary.md` is present and non-empty.
  - **Done**: Build, typecheck, lint, tests all green; `summary.md`
    committed.
