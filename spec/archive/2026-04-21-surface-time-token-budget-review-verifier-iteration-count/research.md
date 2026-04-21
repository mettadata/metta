# Research: surface-time-token-budget-review-verifier-iteration-count

## Decision: Extend `ChangeMetadataSchema` with optional fields + git-log fallback for legacy changes

### Approaches Considered

1. **Schema extension (selected)** — Add four optional fields to
   `ChangeMetadataSchema`: `artifact_timings`, `artifact_tokens`,
   `review_iterations`, `verify_iterations`. Write at existing call sites
   (`metta complete`, `metta instructions`) plus one new small CLI
   (`metta iteration record`). Renderers read additional fields from the
   same metadata they already load. See
   [research-schema-extension.md](research-schema-extension.md).

2. **Sidecar metrics file** — Introduce a parallel
   `spec/changes/<change>/.metrics.yaml` with its own Zod schema and
   store. Rejected — explicitly conflicts with the "no new telemetry
   infrastructure" constraint in the backlog note, doubles write surface,
   and the two-files-drifting hazard outweighs the isolation benefit. See
   [research-sidecar-file.md](research-sidecar-file.md).

3. **Git-derived metrics only** — Keep the schema untouched and compute
   wall-clock, tokens, and iteration counts from `git log` at read time.
   Rejected as a primary path — iteration counts are not discoverable
   without a commit-message convention that doesn't exist; token budget
   at the time of the instructions call is not recoverable from git;
   renderer performance degrades. Kept as a **fallback for timings only**
   when legacy changes lack `artifact_timings`. See
   [research-git-derived.md](research-git-derived.md).

### Rationale

The selected approach is by far the smallest code delta that satisfies
the spec in full (all five user stories, every scenario). The schema
already welcomes small optional extensions (`complexity_score`,
`auto_accept_recommendation`, `workflow_locked` precede us), so adding
four more is consistent with existing practice.

Back-compat is free: `.optional()` on all four fields means existing
`.metta.yaml` files load unchanged, and `schema_version` does not move.

Write sites are the commands that already have the data in hand:

- `metta complete` already reads the metadata before marking complete —
  stamping `artifact_timings[id].completed` at that site is a one-liner.
- `metta instructions` already computes `budget.context_tokens` and
  `budget.budget_tokens` and already reads the metadata to look up the
  artifact status — stamping `started` and `artifact_tokens[id]` is
  another one-liner.
- The new `metta iteration record --phase <review|verify>` is the only
  genuinely new surface, and it is a ~30-line Commander subcommand that
  reuses the existing `ArtifactStore.updateChange` merge-write helper.

Renderers get a clean job: read optional fields, suppress segments whose
data is absent, render the rest. For timings, when
`artifact_timings` is absent (legacy changes predating this feature),
fall back to `git log --format=%aI -- spec/changes/<change>/<file>` for
earliest-to-latest commit wall-clock. Git is already the transaction log;
this is a zero-infra retroactive answer.

Skill template updates (five SKILL.md files) insert a single
`METTA_SKILL=1 metta iteration record --phase <review|verify>` line at
the top of each iteration inside their review-fix / verify-fix loops.
The existing max-3 language and parallel-fan-out language are untouched.

### Key design decisions locked from this research

- Fields are `.optional()` on every surface (schema, reader, renderer).
- `artifact_timings.<id>.started` is set once at `metta instructions`
  time; subsequent calls do **not** overwrite it (idempotent stamp).
- `artifact_timings.<id>.completed` is set at `metta complete` time
  (overwrites any prior value — completion is authoritative).
- `artifact_tokens.<id>` is captured from the `budget` block at
  `metta instructions` time. Overwrites are allowed (re-instructing may
  happen if an artifact is re-opened).
- Iteration counters are monotonically increasing. There is no
  "decrement" path.
- Instrumentation writes are best-effort: failures log to stderr but do
  not abort the command. This matches the "imperative shell, don't block
  core workflow" convention.
- Renderers suppress segments entirely when data is absent or zero; they
  never render `review ×0` or `0k / 0k tokens`.

### Alternatives explicitly declined

- Session-wide Anthropic API token accounting (needs provider hooks;
  declared out of scope in intent.md).
- Per-gate wall-clock (artifact-level granularity suffices).
- Historical backfill of archived changes (git-log fallback covers
  timings retroactively; tokens and iteration counts for legacy changes
  are simply absent, which the renderers handle gracefully).

### Artifacts Produced

- [Approach: Schema extension (selected)](research-schema-extension.md)
- [Approach: Sidecar metrics file](research-sidecar-file.md)
- [Approach: Git-derived metrics only](research-git-derived.md)
