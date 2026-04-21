# Security Review

**Verdict**: PASS_WITH_WARNINGS

## Summary

The change surfaces three purely-numeric/timestamp signals that metta already
computes (per-artifact wall-clock, context-engine budget counts, review/verify
loop counts) and adds one narrow CLI (`metta iteration record`). The persisted
data is strictly numeric/ISO-8601 string — **no user content, prompt text,
LLM output, secrets, or config values land in `.metta.yaml` as a result of
this change**. The `git log` fallback uses `execFile` with a `--` argv
separator, so there is no shell interpretation; and the Zod schema keeps
`ChangeMetadataSchema` `.strict()`, so attacker-supplied YAML cannot inject
arbitrary fields. The only findings are (a) a soft warning about the pre-
existing lack of `--change` path-traversal validation (not introduced here
but newly exercised by a new command), and (b) an observation that the
`iteration` subcommand is absent from the guard-bash allow/block lists and
falls through to the `unknown` branch — which is actually the safer default.

## Threat Model

- **Trust model**: project owner is trusted. The only adversarial surfaces
  worth enumerating are (1) a compromised/confused AI orchestrator running
  under the user's identity (the entire point of the guard-bash hook), and
  (2) malicious/malformed YAML written by a previous metta build or by a
  careless hand-edit of `.metta.yaml`.
- **Assets**: contents of `.metta/` (state), `spec/` (specs), and the
  project working tree. The new fields carry wall-clock, integer counters,
  and computed token counts — none of which are sensitive in themselves.
- **No network surface** is introduced. No secrets are read, written, or
  logged. `artifact_tokens[id]` stores only the two numbers
  `context_tokens` and `budget_tokens` produced by the context engine from
  on-disk spec files; no fragment of the files themselves is persisted.

## Findings

### Critical

- None.

### Warnings

- `src/cli/commands/iteration.ts:38,47,51` — The `--change <name>` option is
  forwarded directly to `ArtifactStore.getChange(name)` /
  `ArtifactStore.updateChange(name, …)`, which in turn passes it to
  `StateStore.read/write` where it is joined into the path
  `spec/changes/<name>/.metta.yaml` (`src/state/state-store.ts:34,55`)
  without any validation for `..` segments, absolute paths, or embedded
  `/`. A supplied `--change ../../etc/passwd` would attempt to read
  `spec/../../etc/passwd/.metta.yaml` and (after Zod failure on the
  happy path) could, via `updateChange`, write an attacker-chosen relative
  path inside the repo. **This vulnerability is pre-existing and shared by
  every `--change`-accepting command (`status`, `complete`,
  `instructions`, `finalize`, …); this change does not make it worse.**
  Inside the trusted project-owner threat model it is not exploitable, but
  it is worth logging as a separate hardening backlog item (input
  validation in `StateStore` or a `ArtifactStore.assertSafeChangeName`
  helper). Not blocking for this change.

- `src/templates/hooks/metta-guard-bash.mjs:25,38` — The `iteration`
  subcommand is not in `ALLOWED_SUBCOMMANDS`, `BLOCKED_SUBCOMMANDS`, or
  `SKILL_ENFORCED_SUBCOMMANDS`. Classification falls through to
  `'unknown'` (see `classify()` at line 85 and offender check at 142-150).
  This means: (a) a skill-template call with `METTA_SKILL=1 metta
  iteration record …` is *allowed* because `skillBypass` is true; (b) a
  **bare** `metta iteration record …` from an orchestrator (no
  `METTA_SKILL=1` prefix) is *blocked* as unknown. This is the desired
  behavior for this change — state-mutating, orchestrator-visible commands
  should not be reachable without the skill prefix. Flagging it only
  because a future reader might assume `iteration` is explicitly
  allowlisted. Consider adding it to a documented skill-only list for
  clarity.

### Notes

- `src/util/git-log-timings.ts:21-26` — The `git log` call uses
  `execFile('git', ['log', '--format=%aI', '--', relativePath], { cwd })`.
  This is **safe**: no shell is spawned (no `exec`), arguments are passed
  as an argv array, and the `--` separator prevents git from interpreting
  a relativePath beginning with `-` as a flag. `cwd` / `relativePath` in
  the actual call site (`src/cli/commands/progress.ts:214`) are
  constructed from `listChanges()` output (filesystem directory names) and
  a hard-coded filename table (`ARTIFACT_FILENAMES`), not from user input.
  No injection surface.

- `src/schemas/change-metadata.ts:33-62` — All four new fields are
  `.strict()` and Zod-typed (`z.string().datetime()` for timestamps,
  `z.number().int().nonnegative()` for counters / token counts,
  `z.record(z.string(), …)` for the two maps). The outer
  `ChangeMetadataSchema` retains `.strict()`, so a hand-edited YAML cannot
  smuggle in unknown sibling fields. Negative / non-integer / non-ISO
  values are rejected on read. Good defense-in-depth.

- `src/cli/commands/instructions.ts:88-111` and
  `src/cli/commands/complete.ts:42-58` — The instrumentation writes are
  wrapped in `try/catch` and degrade to a `Warning:` on stderr rather
  than aborting the command. Schema validation runs on every write via
  `updateChange` → `StateStore.write`, so a corrupted existing
  `artifact_timings` map can only refuse the whole write (which is
  swallowed), never persist a garbage value.

- `src/cli/commands/progress.ts:72-75,116-127` — JSON emission omits
  `undefined` new fields and the human renderer suppresses each segment
  when its data is absent. No path where a legacy `.metta.yaml` causes
  progress to throw; scenario "Suppress empty segments" in spec.md is
  met. Timings/tokens passed through JSON are the same numbers already on
  disk — no amplification, no additional disclosure.

- `src/cli/commands/iteration.ts:60-70` — The error path in `iteration
  record` emits `{ error: { code: 4, type: 'iteration_error', message } }`
  with the raw exception message. The upstream exceptions are from our
  own `throw new Error(...)` lines and Zod/yaml errors — neither contains
  secrets. Low risk; pattern matches the other commands' error shapes.

- `tests/iteration-command.test.ts` — Covers the rejection of an
  invalid `--phase` value (line 121-137) and a non-existent change
  (line 139-147) with proper exit-code assertions. No path-traversal test
  was added, consistent with the pre-existing convention across the
  repo's CLI tests.
