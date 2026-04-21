# Correctness Review

**Verdict**: PASS_WITH_WARNINGS

## Summary

The schema extension, `metta iteration` CLI, instrumented write-sites, and
renderer updates all line up with the spec on paper and are well-tested.
Back-compat is genuinely preserved (all four new fields optional, `.strict()`
kept, `schema_version` unchanged) and the test suite exercises every explicit
Given/When/Then scenario I could map. Two meaningful deviations from spec
remain: the five skill templates call `metta iteration record --phase review`
twice per first review round (pre-loop AND in-loop), producing a systematic
double-count on review counters; and the "Skipped artifact also records
completed" scenario has no code path behind it. Nothing blocks the change,
but the review-iteration semantics are not what users will read on-screen.

## Findings

### Critical

None.

### Warnings

- `src/templates/skills/metta-propose/SKILL.md:162` + `:168` — Two
  `metta iteration record --phase review` lines exist for a single review
  round: one "Before spawning reviewer agents" pre-loop and one as step (a)
  of the `REVIEW-FIX LOOP`. For a clean first review (no fix pass) the
  counter jumps from 0 to 2. `design.md:268-270` explicitly calls out the
  intent ("iteration is recorded at the top of the loop so that even a
  single round ... is counted correctly") — a single call inside the loop
  at step (a). The pre-loop call is redundant and makes the rendered
  `↻ review ×N` number not match the real number of review rounds the
  orchestrator ran. Same pattern in
  `src/templates/skills/metta-quick/SKILL.md:138` + `:145`,
  `src/templates/skills/metta-fix-issues/SKILL.md:57` + `:64`,
  `src/templates/skills/metta-fix-gap/SKILL.md:53` + `:60`, and
  `src/templates/skills/metta-auto/SKILL.md:56` + `:63`. The literal spec
  scenario at `spec.md:313-318` ("exactly one ... line inside the review-fix
  loop") is technically still satisfied because the second, extra call sits
  outside the loop, but the user-facing count is wrong. Fix: drop the
  pre-loop "Before spawning reviewer agents, run: ..." lines (keep only the
  in-loop step-a call). The verify side has the mirror problem in
  `metta-fix-issues/SKILL.md:75` + `:80`,
  `metta-fix-gap/SKILL.md:71` + `:76`, and
  `metta-auto/SKILL.md:68` + `:73`, except the second verify record is
  conditional ("If any gate fails: run ... again"), so verify correctly
  increments only on failure and re-run. The asymmetry between the review
  and verify flows makes the review double-count the likelier defect.

- `src/cli/commands/instructions.ts:89-111` — Spec at `spec.md:82-84`
  says the side-effect writes apply only "when the artifact's `.metta.yaml`
  status is `ready` or `in_progress`". The implementation has no status
  guard and stamps on any invocation (including `complete`/`failed`/
  `skipped`). `started` is still idempotent (line 92), so the only real
  behavioral deviation is that `artifact_tokens[id]` can be overwritten for
  an already-completed artifact if someone re-runs `metta instructions`.
  Not harmful in the main flow, but a minor spec deviation.

- `src/cli/commands/complete.ts:179-185` + `tasks.md:50-66` — Spec scenario
  at `spec.md:72-75` ("Skipped artifact also records `completed`") has no
  backing code. `stampArtifactCompleted` is invoked only after the
  `markArtifact(..., 'complete')` call. I grepped for any path that writes
  `'skipped'` to `metadata.artifacts` and found none in `src/cli/` or
  `src/workflow/` — the downscale branches in `complete.ts:256-275` drop
  unstarted planning artifacts from the map entirely rather than marking
  them skipped. So the scenario is unreachable in current code. Either the
  scenario should be dropped from spec, or skip-writing code elsewhere
  should route through the same stamp helper.

### Notes

- `src/cli/commands/iteration.ts:30-34` — The `--phase` value check is
  implemented in the action handler, not via `Commander`'s `.choices()`
  helper. Spec at `spec.md:145-146` says "Invalid `--phase` value SHALL be
  rejected by Commander with a non-zero exit." The exit code is non-zero
  (4) and the error message is clear, so behavior is correct; only the
  "by Commander" wording is slightly off-model. Using
  `.choices(['review','verify'])` on the option would tighten this and
  move the error into Commander's usage renderer.

- `src/cli/commands/progress.ts:212-221` — The git-log fallback is only
  attempted when both `started` and `completed` are absent in metadata.
  Spec at `spec.md:214-219` reads "When `artifact_timings` is absent
  (legacy change)" — slightly narrower: if any one artifact has only
  `started` (change mid-flight), the current code won't fall back for the
  other artifacts in that same change. Given the comment at line 210-212
  ("only attempt git log when both metadata fields are absent ... mid-flight
  and the duration is not yet meaningful") this is a reasonable
  refinement, but it does diverge from the literal spec wording. No test
  asserts the diverged behavior either way.

- `src/cli/commands/iteration.ts:36-45` — The auto-select logic uses
  `listChanges()` (active changes), which matches the "exactly one active
  change" wording of `spec.md:148` and of the Scenario at
  `spec.md:182-186`. Tested at `tests/iteration-command.test.ts:107-119`.
  The error message when multiple changes exist enumerates them, which is
  friendlier than spec requires — good.

- `src/schemas/change-metadata.ts:33-62` — Every spec-mandated schema rule
  is implemented: optional everywhere, non-negative ints, `.strict()` on
  each sub-schema, ISO datetime on the timings. Back-compat and
  negative-rejection scenarios are covered in
  `tests/schemas.test.ts:146-237`.

- `src/cli/commands/status.ts:114-138` — Renderer matches
  `spec.md:254-270` exactly: Tokens and Iterations lines each suppressed
  when inputs absent, JSON unchanged. `tests/status-new-lines.test.ts`
  covers the four spec scenarios.

- `src/cli/commands/progress.ts:44-75, 117-127, 188-249` — JSON
  pass-through omits-when-undefined per `spec.md:195-196`. Human mode
  renders three segments joined with two spaces per `spec.md:198`.
  Segment suppression and git fallback are both implemented and tested
  in `tests/progress-secondary-line.test.ts`.

- Templates under `src/templates/skills/` and their mirror copies under
  `.claude/skills/` are byte-identical (confirmed via diff on
  `metta-propose/SKILL.md`). Good.

- The `.metta.yaml` for this very change (at `.metta.yaml:20-22`) shows
  only `artifact_timings.implementation.completed` populated; no
  `started` for any artifact and no `artifact_tokens`. That is an
  artifact of how this change itself was executed (the orchestrator
  appears not to have routed through `metta instructions` per artifact),
  not an implementation bug — but it does mean this change's own
  dog-food evidence for the instrumentation path is thin.
