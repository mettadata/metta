# fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Problem

The `/metta-propose` skill runs the entire change lifecycle — intent, stories, spec, research, design, tasks, implementation, review, verification, finalize, merge — end-to-end with no built-in pause point. There is no flag (e.g. `--stop-after-plan` or `--stop-after <artifact>`) that lets the orchestrator create the change, complete the planning artifacts, hand control back to the user, and exit so the user can review the diffs before resuming with implementation.

`/metta-plan` cannot fill this gap because it only operates on an already-active change and cannot create one. The current workaround is to embed pause instructions in the propose description (e.g. "stop after tasks before implementing"), which is lossy, ad-hoc, and depends on the orchestrator faithfully following English text rather than executing a deterministic flag.

The people affected:
- Reviewers who want to inspect planning artifacts (intent.md, spec.md, design.md, tasks.md) before letting the agent burn budget on implementation.
- Lead engineers piloting metta who want a "draft only" mode for handing planning output to a human or another tool.
- Operators recovering from review-and-restart cycles where the design is wrong and implementation would waste work.

The propose pipeline has two layers — the CLI (`src/cli/commands/propose.ts`) and the skill orchestration (`.claude/skills/metta-propose/SKILL.md`) — and neither exposes a planning/execution boundary today. The CLI accepts `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, `--auto`, but no `--stop-after`. The skill's Steps 3 (planning artifacts), 5 (implementation), 6 (review), 7 (verification) run as a single linear sequence with no early-exit branch between Step 3 and Step 5. Resumption already works — `/metta-execute` Step 1 simply checks `metta status` to confirm implementation is ready — so the missing piece is the explicit gate to stop in the first place.

## Proposal

Add a `--stop-after <artifact>` option to `metta propose` and teach the propose skill to honor it.

Surface changes:
- CLI: `src/cli/commands/propose.ts` accepts `--stop-after <artifact>`. The value MUST be one of the artifact ids returned by the loaded workflow's `buildOrder` (e.g. `intent`, `stories`, `spec`, `research`, `design`, `tasks` for the standard workflow). Unknown values are rejected with a clear error message that lists the valid artifact ids for that workflow.
- Persistence: the chosen stop-after artifact id is recorded on the change record at creation time (e.g. as `stop_after: <id>` in `.metta.yaml`) so the skill orchestrator and any future re-entrant logic can read it.
- Skill: `.claude/skills/metta-propose/SKILL.md` Step 3 (per-artifact planning loop) inspects the change's `stop_after` value after each `metta complete <artifact>` call. When the just-completed artifact equals `stop_after`, the orchestrator skips Steps 4 (research synthesis-only flows), 5 (implementation), 6 (review), 7 (verification), 8 (finalize/merge) and prints a clean handoff message naming the resume command (`/metta-execute` for stop-after-tasks; `/metta-status` to inspect any earlier stop point).
- Skill argument parsing: the skill parses `--stop-after <artifact>` from `$ARGUMENTS` the same way it parses `--workflow` and `--auto` today, removes the tokens, and passes the flag through to `metta propose`.
- Sugar alias `--stop-after-plan` is **out of scope** for this change — Option 1 in the issue's candidate solutions is the chosen path; Option 2 can be layered on later if real users ask for it.

Behavior:
- `metta propose "<desc>" --stop-after tasks` creates the change, runs intent → stories → spec → research → design → tasks (each via the matching planning subagent and `metta complete`), then exits with a status message: "Stopped after `tasks`. Run `/metta-execute` to begin implementation."
- `metta propose "<desc>" --stop-after spec` creates the change, runs intent → stories → spec, then exits with: "Stopped after `spec`. Run `/metta-plan` to continue planning, or `/metta-status` to inspect."
- `metta propose "<desc>"` (no flag) behaves exactly as today — full lifecycle.

Validation:
- The CLI command validates the flag value against `graph.buildOrder` after loading the workflow. Implementation, verification, and any execution-phase artifact ids are explicitly rejected (you cannot "stop after implementation" — that is just running the full workflow).
- The skill MUST NOT silently ignore an invalid value — let the CLI reject it before any change record is created.

## Impact

- `src/cli/commands/propose.ts` — adds the new option, validation, and pass-through to `artifactStore.createChange`.
- `src/artifact-store/` — accepts an optional `stopAfter` field on `createChange` and persists it to the change record's `.metta.yaml`.
- Change record schema (Zod) — adds an optional `stop_after: string` field, validated against the workflow's `buildOrder` at write time.
- `.claude/skills/metta-propose/SKILL.md` — argument parsing, post-`metta complete` check, clean exit branch with resume hint.
- Tests — at least: unit tests for CLI flag parsing and validation; unit tests for the change-record schema accepting/rejecting `stop_after`; one end-to-end test that `propose --stop-after spec` stops at the right boundary.
- Documentation — propose CLI help text updates; skill argument-hint and step-3 description updates.

Behavior unchanged when the flag is absent — `metta propose "<desc>"` runs the full lifecycle as it does today.

Existing flags are unaffected: `--workflow`, `--from-gap`, `--from-idea`, `--from-issue`, `--discovery`, `--auto` continue to work and compose with `--stop-after`.

## Out of Scope

- Sugar alias `--stop-after-plan` (boolean) — Option 2 from the candidate solutions. Can be added later as a thin wrapper that resolves to "stop after the last planning artifact in the workflow", but adds workflow-dependent magic that's better evaluated once `--stop-after <artifact>` is in production.
- Splitting `/metta-propose` into `/metta-propose-plan` and `/metta-propose-build` — Option 3 in the issue. Doubles skill surface area, breaks muscle memory, and the same review gate is achievable with a flag at far lower cost.
- Resuming an arbitrary stop-after change with `/metta-propose` itself (re-entrancy). The resume path is `/metta-execute`, `/metta-plan`, `/metta-verify`, or `/metta-ship` — those skills already check `metta status` and route correctly. Re-entering propose on an active change is a separate UX concern.
- Auto-pausing for review based on heuristics (e.g. "stop if design.md is over N lines"). Out of scope here; this change is strictly opt-in via an explicit flag.
- Changing how `/metta-quick` or `/metta-auto` behave. Those workflows have their own argument-handling rules; adding `--stop-after` semantics there is a separate decision.
- Modifying `metta finalize`, `metta ship`, or any post-implementation gate behavior. The boundary added here is strictly between Step 3 (planning) and Step 5 (implementation) of the propose skill.
