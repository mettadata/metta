# Summary: surface-time-token-budget-review-verifier-iteration-count

## What shipped

Extended `metta progress` and `metta status` to surface three signals that
metta already had in hand but was throwing away:

1. Per-artifact wall-clock time — `started` stamped at `metta instructions`
   (idempotent), `completed` stamped at `metta complete`. Rendered as
   `⏱ intent 2m 14s · spec 3m 01s` on `metta progress`. Git-log fallback
   derives wall-clock for legacy changes with no `artifact_timings`.
2. Token context / budget per artifact — captured at `metta instructions`
   time from the budget block the context engine already computes. Summed
   and rendered as `📊 4k / 40k tokens` / `Tokens: 4k / 40k`.
3. Review / verify iteration counts — new `metta iteration record
   --phase <review|verify>` CLI; five skill templates call it at the top
   of review-fix and verify-fix loops. Rendered as `↻ review ×2, verify ×1`
   / `Iterations: review ×2, verify ×1`.

## Schema change

Four optional fields on `ChangeMetadataSchema`: `artifact_timings`,
`artifact_tokens`, `review_iterations`, `verify_iterations`. All
`.optional()`, `.strict()` preserved, `schema_version` untouched. Existing
`.metta.yaml` files validate unchanged.

## New CLI surface

`metta iteration record --phase <review|verify> [--change <name>] [--json]`
Auto-selects single active change. Missing counters treated as 0. Review
and verify counters are independent. Invalid phase or unknown change
exits code 4 with `iteration_error`.

## Write-site instrumentation

- `metta complete` stamps `artifact_timings[id].completed`, preserves
  any prior `started`.
- `metta instructions` stamps `started` once (never overwrites) and
  always writes `artifact_tokens[id]` with the computed budget block.

Both paths are best-effort: instrumentation failures write a `Warning:`
line to stderr and never abort the command.

## Renderer changes

- `src/cli/commands/progress.ts` — JSON pass-through of four new fields
  (omitting when undefined); human secondary line per active change with
  up to three segments; git-log fallback for legacy timings.
- `src/cli/commands/status.ts` — `Tokens:` and `Iterations:` lines when
  populated; JSON pass-through via `...metadata` spread.

## Skill template updates

Each of the five templates (`metta-propose`, `metta-quick`,
`metta-fix-issues`, `metta-fix-gap`, `metta-auto`) got one
`METTA_SKILL=1 metta iteration record --phase review --change <name>`
line before the first reviewer fan-out and inside the review-fix loop,
and one analogous `--phase verify` line for the verify path. Existing
max-3 language and parallel-fan-out guidance were untouched.

## Tests added

- `tests/schemas.test.ts` — extended with `ArtifactTimingSchema` and
  `ArtifactTokensSchema` cases plus new `ChangeMetadataSchema` back-compat
  and negative-value cases.
- `tests/duration.test.ts` — 9 cases for the `0s` / `<N>s` /
  `<N>m <N>s` / `<N>h <N>m` branches.
- `tests/git-log-timings.test.ts` — 5 cases: two-commit, single-commit,
  untracked, non-git dir, missing file.
- `tests/iteration-command.test.ts` — 6 cases for increment, phase
  isolation, auto-select, and error paths.
- `tests/complete-stamps-timings.test.ts` — stamps `completed`,
  preserves `started`.
- `tests/instructions-stamps-timings.test.ts` — stamps `started` once,
  overwrites `artifact_tokens`.
- `tests/progress-secondary-line.test.ts` — 8 cases for segment
  rendering and git-log fallback.
- `tests/status-new-lines.test.ts` — 4 cases for `Tokens:` /
  `Iterations:` rendering and JSON pass-through.
- `tests/skill-iteration-record.test.ts` — content assertion on all five
  skill templates.

## Gates

- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (lint delegates to tsc --noEmit).
- `npm run build` — clean (templates copy to dist/).
- `npm test` — full suite run summarized in verification phase.
