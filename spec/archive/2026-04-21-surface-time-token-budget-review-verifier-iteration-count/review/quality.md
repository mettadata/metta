# Quality Review

**Verdict**: PASS

## Summary

Implementation matches the intent: four optional `ChangeMetadata` fields, a
new `metta iteration` CLI, best-effort stamping in `metta instructions` and
`metta complete`, a secondary render line in `metta progress`, and
`Tokens:` / `Iterations:` lines in `metta status`. Skill templates in all
five loop-running skills (`metta-propose`, `metta-quick`, `metta-fix-issues`,
`metta-fix-gap`, `metta-auto`) invoke `metta iteration record` inside both
review-fix and verify-fix loops. Byte-identity pairs verified, TypeScript
clean, and the full vitest suite is green (68 files / 922 tests, exit 0,
duration 688 s).

## Findings

### Critical

None.

### Warnings

None.

### Notes

- **Byte-identity pairs** — `diff -q` confirms all five changed skill
  templates match their `.claude/skills/*` mirrors exactly:
  - `metta-auto/SKILL.md`
  - `metta-fix-gap/SKILL.md`
  - `metta-fix-issues/SKILL.md`
  - `metta-propose/SKILL.md`
  - `metta-quick/SKILL.md`
- **TypeScript** — `npx tsc --noEmit` produced no output (clean).
- **Vitest** — `npx vitest run` reported `Test Files 68 passed (68)` /
  `Tests 922 passed (922)`; exit code 0. New tests covered:
  - `tests/schemas.test.ts` — extended with `ArtifactTimingSchema`,
    `ArtifactTokensSchema`, back-compat, and negative-value cases.
  - `tests/duration.test.ts` — 9 cases (0s / Nans / hours boundary / etc.).
  - `tests/git-log-timings.test.ts` — 5 cases (two-commit, single-commit,
    untracked, non-git dir, missing file).
  - `tests/iteration-command.test.ts` — 6 cases (first record, increment,
    phase isolation, auto-select, invalid phase, unknown change).
  - `tests/complete-stamps-timings.test.ts` — 2 cases (stamp + preserve).
  - `tests/instructions-stamps-timings.test.ts` — 3 cases (stamp once,
    never overwrite `started`, always overwrite tokens).
  - `tests/progress-secondary-line.test.ts` — 8 cases including git-log
    fallback for legacy changes.
  - `tests/status-new-lines.test.ts` — 4 cases (legacy omission, populated
    rendering, half suppression, JSON pass-through).
  - `tests/skill-iteration-record.test.ts` — asserts all 5 skill templates
    contain both phase lines with the `METTA_SKILL=1` prefix.
- **Naming and style** — new CLI follows `metta <noun> <verb>` shape
  (`metta iteration record`) consistent with other multi-verb surfaces
  (e.g. `metta tasks plan`). Schema field names are snake_case matching
  existing `ChangeMetadataSchema` conventions (`artifact_timings`,
  `artifact_tokens`, `review_iterations`, `verify_iterations`). `.strict()`
  preserved; `schema_version` deliberately untouched per the back-compat
  plan.
- **Dead code / unused imports** — none introduced. `iteration.ts` uses
  every import; `progress.ts` / `status.ts` consume the new types.
  Instrumentation paths in `instructions.ts` / `complete.ts` are
  self-contained `try { ... } catch { ... }` blocks that write a
  `Warning:` line to stderr and never throw into the caller, matching
  the "best-effort, must not block workflow" requirement in the spec.
- **Docs / help** — `metta iteration` gets a proper commander
  `.description()` ('Record iteration counters (review / verify)') and
  the subcommand gets its own description. The CLI is not listed in
  `CLAUDE.md`'s lifecycle / organization skill tables, but by design:
  it is an internal-to-skills write call (the five skill templates
  invoke it), not an orchestrator lifecycle command. A user running
  `metta --help` will still see it. Given the explicit design choice
  in the intent (skills record via the CLI; operators never invoke it
  directly) this matches the scope.
- **Scope** — `git diff main..HEAD --name-only` lists only:
  - 5 skill templates under `src/templates/skills/*/SKILL.md` + their
    `.claude/skills/*` mirrors (10 total)
  - 4 CLI command files (`complete.ts`, `instructions.ts`,
    `iteration.ts`, `progress.ts`, `status.ts`)
  - `src/cli/index.ts` (one new `registerIterationCommand` call)
  - `src/schemas/change-metadata.ts` (four optional fields + two
    sub-schemas)
  - 2 new utility modules (`src/util/duration.ts`,
    `src/util/git-log-timings.ts`)
  - 9 test files (new + extended)
  - Change artifacts under `spec/changes/<name>/`
  All consistent with intent.md / summary.md.
- **Best-effort instrumentation fidelity** — `stampArtifactCompleted`
  in `complete.ts` and the token/timing block in `instructions.ts` both
  wrap `await ctx.artifactStore.updateChange(...)` in try/catch and
  emit a `Warning: ...` on stderr. Neither re-throws. Consistent with
  the requirement that instrumentation must not block the workflow.
- **Git-log fallback correctness** — `buildSecondaryLine` only attempts
  the git-log fallback when BOTH `t?.started` and `t?.completed` are
  absent (not when only one is set); this prevents misreporting
  wall-clock for mid-flight artifacts. Covered by the "skips an
  artifact with partial timing" test case.
- **Phase validation** — `iteration.ts` rejects an invalid `--phase`
  value with exit 4 and `iteration_error` before touching state, and
  the corresponding test (`rejects invalid --phase value`) asserts
  both counters remain undefined after the rejection — no state
  pollution on error.
