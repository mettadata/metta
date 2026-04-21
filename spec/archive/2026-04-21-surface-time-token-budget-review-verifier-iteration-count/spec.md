# surface-time-token-budget-review-verifier-iteration-count

## ADDED: Requirement: Schema extension for per-artifact timing, tokens, and iteration counters

The `ChangeMetadataSchema` MUST be extended with four optional fields:

- `artifact_timings`: an optional `Record<string, { started?: ISO-8601 string;
  completed?: ISO-8601 string }>`. Keys correspond to artifact IDs present in
  `artifacts`. Both inner fields are optional.
- `artifact_tokens`: an optional `Record<string, { context: non-negative
  integer; budget: non-negative integer }>`. Keys correspond to artifact IDs.
- `review_iterations`: an optional non-negative integer.
- `verify_iterations`: an optional non-negative integer.

All four fields MUST be `.optional()` so that existing `.metta.yaml` files
(and any YAML produced by older `metta` builds) continue to validate. The
`schema_version` constant MUST NOT change, because the additions are
strictly optional and forward-compatible.

Fulfills: US-1, US-2, US-3, US-5.

### Scenario: Legacy file without new fields validates cleanly
- GIVEN a `.metta.yaml` file written by a previous metta version that
  contains none of the four new fields
- WHEN `ArtifactStore.getChange(name)` reads and parses it
- THEN Zod validation SHALL succeed and the resulting `ChangeMetadata`
  object SHALL have `undefined` for each of `artifact_timings`,
  `artifact_tokens`, `review_iterations`, and `verify_iterations`.

### Scenario: New file round-trips all four fields
- GIVEN a `ChangeMetadata` object with `artifact_timings`,
  `artifact_tokens`, `review_iterations: 2`, and `verify_iterations: 1` set
- WHEN `ArtifactStore.updateChange` writes it and `getChange` reads it back
- THEN every field SHALL be preserved verbatim.

### Scenario: Zod rejects invalid values
- GIVEN a `.metta.yaml` with `review_iterations: -1` or
  `artifact_tokens.intent.context: "abc"`
- WHEN the store parses it
- THEN Zod validation SHALL fail with a clear message identifying the
  offending field.

---

## ADDED: Requirement: `metta complete` stamps artifact `completed` timestamp

When `metta complete <artifact> --change <name>` marks an artifact `complete`
(or `skipped`), the command MUST upsert
`artifact_timings[<artifact>].completed = <current ISO-8601 UTC timestamp>`
in the change's `.metta.yaml`. Writing the timestamp MUST NOT block the
completion if it succeeds; the existing completion semantics are unchanged.

The existing `artifact_timings[<artifact>].started` value, if present, MUST
NOT be overwritten.

Fulfills: US-1.

### Scenario: Complete stamps `completed`
- GIVEN a change whose `intent` artifact is in `ready` state and whose
  `.metta.yaml` has no `artifact_timings` field
- WHEN `metta complete intent --change <c>` succeeds
- THEN `.metta.yaml` SHALL contain
  `artifact_timings.intent.completed` as an ISO-8601 UTC timestamp not more
  than 2 seconds in the past.

### Scenario: Complete preserves prior `started`
- GIVEN a change where `artifact_timings.intent = { started: "2026-04-21T10:00:00.000Z" }`
- WHEN `metta complete intent` succeeds
- THEN the `started` value SHALL remain `"2026-04-21T10:00:00.000Z"` and
  `completed` SHALL be added without touching `started`.

### Scenario: Skipped artifact also records `completed`
- GIVEN a change whose workflow causes `design` to be `skipped`
- WHEN the completion flow marks `design` skipped
- THEN `artifact_timings.design.completed` SHALL be populated.

---

## ADDED: Requirement: `metta instructions` stamps `started` and records token budget

When `metta instructions <artifact> --change <name>` is invoked and the
artifact's `.metta.yaml` status is `ready` or `in_progress`, the command
MUST, as a best-effort side effect:

1. Upsert `artifact_timings[<artifact>].started` with the current ISO-8601
   UTC timestamp **only if** the field is not already set.
2. Upsert `artifact_tokens[<artifact>] = { context: <context_tokens>, budget:
   <budget_tokens> }` with the numbers returned in the command's `budget`
   block.

If either write fails (filesystem, validation, concurrency), the command
MUST still emit its JSON / human output successfully and MUST log a warning
to stderr. Instrumentation MUST NOT block the workflow.

Fulfills: US-2, US-4.

### Scenario: Instructions sets `started` once
- GIVEN a change whose `intent` has no `artifact_timings.intent.started`
- WHEN `metta instructions intent --change <c>` is invoked
- THEN `.metta.yaml` SHALL contain `artifact_timings.intent.started` set to
  a recent ISO-8601 UTC timestamp.

### Scenario: Re-running instructions does not overwrite `started`
- GIVEN a change where `artifact_timings.intent.started =
  "2026-04-21T09:00:00.000Z"`
- WHEN `metta instructions intent` is invoked again
- THEN the `started` value SHALL remain `"2026-04-21T09:00:00.000Z"`.

### Scenario: Instructions records token budget
- GIVEN any artifact that has not been instructed yet
- WHEN `metta instructions <artifact>` completes successfully
- THEN `.metta.yaml` SHALL contain `artifact_tokens[<artifact>].context` and
  `artifact_tokens[<artifact>].budget` matching the values the command
  emitted in its `budget` block.

### Scenario: Instrumentation failure does not abort the command
- GIVEN the state write fails (e.g. EACCES)
- WHEN `metta instructions <artifact>` is invoked
- THEN the command SHALL still print its instructions (JSON or human
  output) and exit with status 0, and a warning SHALL be written to stderr.

---

## ADDED: Requirement: `metta iteration` CLI command

A new CLI subcommand tree `metta iteration` MUST be added with a single
subcommand:

`metta iteration record --phase <review|verify> --change <name> [--json]`

This command MUST:

1. Read the change's `.metta.yaml` via the standard `ArtifactStore`.
2. Treat missing counters as `0`.
3. Atomically increment `review_iterations` if `--phase review` or
   `verify_iterations` if `--phase verify`.
4. Validate and write the updated metadata.
5. On success, emit a JSON object of the form `{ "change": "<name>",
   "phase": "<review|verify>", "count": <new-value> }` when `--json` is set
   on the top-level `program` options, or a one-line human message.

Failure modes:

- Unknown change SHALL produce exit code 4 with an error message.
- Invalid `--phase` value SHALL be rejected by Commander with a non-zero
  exit.
- Missing `--change` when multiple active changes exist SHALL produce exit
  code 4 with a message listing the candidates; a single active change SHALL
  be auto-selected.

This command MUST be registered in `src/cli/index.ts` (or wherever other
commands are registered) so that `metta --help` lists it. It MUST also be
callable with the `METTA_SKILL=1` prefix so the guard honors it; the guard
whitelist SHOULD NOT need a new entry (the command is not in the
skill-required set).

Fulfills: US-3.

### Scenario: First record creates the counter
- GIVEN a change with no `review_iterations` field
- WHEN `metta iteration record --phase review --change <c>` is run
- THEN `.metta.yaml` SHALL contain `review_iterations: 1`.

### Scenario: Subsequent record increments
- GIVEN a change with `review_iterations: 2`
- WHEN the command is invoked again with `--phase review`
- THEN `.metta.yaml` SHALL contain `review_iterations: 3`.

### Scenario: Independent counters
- GIVEN a change with `review_iterations: 2, verify_iterations: 0`
- WHEN the command is invoked with `--phase verify`
- THEN `.metta.yaml` SHALL contain `review_iterations: 2,
  verify_iterations: 1`.

### Scenario: Non-existent change errors clearly
- GIVEN no change named `no-such-change` exists
- WHEN `metta iteration record --phase review --change no-such-change` is
  run
- THEN the command SHALL exit with a non-zero status, print a clear error,
  and SHALL NOT create any files.

### Scenario: Single active change auto-selected
- GIVEN exactly one active change exists
- WHEN `metta iteration record --phase review` is invoked without
  `--change`
- THEN the counter for that single change SHALL be incremented.

---

## ADDED: Requirement: `metta progress` surfaces new fields

The `metta progress` command MUST, for each active change:

1. In JSON mode, include `artifact_timings`, `artifact_tokens`,
   `review_iterations`, and `verify_iterations` verbatim from the metadata
   (omitting fields that are `undefined`).
2. In human mode, render a secondary line per change with up to three
   segments, joined with two spaces:
   - A time segment beginning with a clock glyph (e.g. `⏱`), listing each
     artifact that has both a `started` and `completed` timestamp in the form
     `<artifact> <duration>`, joined with ` · `. Durations SHALL be formatted
     as `<N>s` under 60 s, `<N>m <N>s` under one hour, and `<N>h <N>m`
     otherwise. When no artifact has both timestamps and no git fallback is
     available, this segment SHALL be suppressed.
   - A token segment beginning with a `📊` glyph, of the form
     `<context_sum>k / <budget_sum>k tokens` where both sums are the totals
     across all populated `artifact_tokens` entries, rounded to the nearest
     thousand. When `artifact_tokens` is empty or absent, this segment SHALL
     be suppressed.
   - An iteration segment beginning with a `↻` glyph, of the form
     `review ×<N>, verify ×<M>` with either half suppressed when its
     counter is `0` or absent. When both are `0` or absent, the whole
     segment SHALL be suppressed.
3. When `artifact_timings` is absent (legacy change), the human renderer
   MAY derive per-artifact durations from `git log` of the artifact file in
   `spec/changes/<change>/`: the duration is the wall-clock from the change
   directory's earliest commit containing the file to the most recent
   commit touching it. When git is unavailable or the file has no history,
   the time segment SHALL be suppressed (never errored).

Fulfills: US-1, US-2, US-3, US-5.

### Scenario: JSON mode includes timings and tokens
- GIVEN a change with populated `artifact_timings.intent` and
  `artifact_tokens.intent`
- WHEN `metta progress --json` is invoked
- THEN the `active[0]` entry SHALL include both keys with their values
  verbatim from the metadata.

### Scenario: Human mode renders all three segments
- GIVEN a change with `artifact_timings.intent = { started: "...",
  completed: "..." }` whose duration is 134 seconds, `artifact_tokens.intent
  = { context: 4086, budget: 40000 }`, `review_iterations: 2`,
  `verify_iterations: 1`
- WHEN `metta progress` (human) is invoked
- THEN the output SHALL contain a line with three segments: `⏱ intent 2m
  14s`, `📊 4k / 40k tokens`, `↻ review ×2, verify ×1`.

### Scenario: Suppress empty segments
- GIVEN a change with `review_iterations: 0` and no token data
- WHEN `metta progress` (human) is invoked
- THEN neither the token segment nor the iteration segment SHALL appear in
  the output.

### Scenario: Git fallback for legacy timings
- GIVEN a change whose `.metta.yaml` has no `artifact_timings` but whose
  `intent.md` has two commits in the repo
- WHEN `metta progress` (human) is invoked
- THEN the time segment SHALL render using the wall-clock between those
  commits, and no error SHALL be emitted.

---

## ADDED: Requirement: `metta status` surfaces iteration counters and token totals

The `metta status` command MUST, when rendering a single change's human
output, append (after the artifact list and complexity line):

- A `Tokens:` line when `artifact_tokens` is populated, in the form
  `Tokens: <context_sum>k / <budget_sum>k`.
- An `Iterations:` line when either counter is non-zero, in the form
  `Iterations: review ×<N>, verify ×<M>` (omitting either half when its
  counter is 0 or absent).

The JSON shape from `metta status --json` SHALL be unchanged — the full
metadata (including the new optional fields) is already passed through via
`...metadata` spread. Tests MUST assert that the JSON contains the new
fields when set, because existing callers rely on the pass-through.

Fulfills: US-2, US-3, US-5.

### Scenario: Status renders iteration line when counters set
- GIVEN a change with `review_iterations: 3`, `verify_iterations: 0`
- WHEN `metta status --change <c>` is invoked
- THEN the output SHALL contain a line of the form `Iterations: review ×3`
  and SHALL NOT mention verify.

### Scenario: Status suppresses lines when fields absent
- GIVEN a legacy change with no new fields
- WHEN `metta status --change <c>` is invoked
- THEN the output SHALL NOT contain a `Tokens:` or `Iterations:` line and
  SHALL NOT error.

---

## ADDED: Requirement: Skill instructions record review and verify iterations

The following skill templates MUST be updated so that their review-fix /
verify-fix loops call `metta iteration record --phase <review|verify>`
exactly once per iteration:

- `src/templates/skills/metta-propose/SKILL.md`
- `src/templates/skills/metta-quick/SKILL.md`
- `src/templates/skills/metta-fix-issues/SKILL.md`
- `src/templates/skills/metta-fix-gap/SKILL.md`
- `src/templates/skills/metta-auto/SKILL.md`

Placement MUST be at the top of each review iteration and each verify
iteration (before the 3 reviewer `Agent(...)` calls and before the 3
verifier `Agent(...)` calls respectively). The existing "max 3" language
and the parallel-fan-out language MUST NOT be altered.

The call MUST use the `METTA_SKILL=1` inline prefix (so a future guard
tightening would not block it) and MUST NOT use `--no-verify` or any other
forbidden flag.

The `.claude/skills/<skill>/SKILL.md` installed copies are regenerated
from these templates by `metta-refresh`; hand-edits to the installed copies
are out of scope for this change.

Fulfills: US-3.

### Scenario: Each skill template invokes iteration record once per review round
- GIVEN the updated `metta-propose/SKILL.md`
- WHEN the file is read
- THEN there SHALL be exactly one `metta iteration record --phase review`
  line inside the review-fix loop and exactly one `metta iteration record
  --phase verify` line inside the verify-fix loop.

### Scenario: The prefix is always `METTA_SKILL=1`
- GIVEN any of the five updated skill templates
- WHEN the `metta iteration record` line is read
- THEN the line SHALL begin with `METTA_SKILL=1 metta iteration record`.
