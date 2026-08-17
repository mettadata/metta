# metta roadmap next mutates on invocation with no read-only preview or confirmation

**Captured**: 2026-08-17
**Status**: logged
**Severity**: minor

## Symptom
An operator ran `metta roadmap next` intending to preview the next roadmap item (observed live in zeus, 2026-08-18). Instead of reporting the head entry, the command popped it off the roadmap, auto-committed the removal, and printed the propose handoff as a side effect. The session had to notice the mutation and manually restore the entry via `roadmap add` + `roadmap reorder` — itself error-prone, since `reorder` demands a full permutation. The verb "next" reads as inspection: every other read-shaped metta command (`status`, `progress`, `backlog list`, bare `roadmap`) is non-mutating, so this is a least-surprise violation on a destructive operation with no undo.

## Root Cause Analysis
The `next` subcommand was designed as an activation flow, not a preview: its action handler unconditionally couples the read ("what's on top?") with the write (pop + commit). After resolving the top entry and building the promote handoff, it calls `roadmapStore.removeTop()` and `autoCommitFile(...)` with no flag gate, no confirmation prompt, and no dry-run path — the only guards are the main-branch check and the dangling-entry `not_found` bail. `removeTop()` itself is a straight load/shift/save with no undo affordance, and neither the CLI output nor the JSON envelope prints a restore command. The skill layer reinforces the trap: `metta-roadmap`'s `next` branch runs `metta roadmap next` directly after a `--json` primer, with no interactive confirmation, and its rules note orchestrators should read the top entry from bare `metta roadmap` — knowledge that lives only in the skill file, not in the CLI's own UX. A human (or session outside the skill) typing `next` gets the mutation with zero friction.

### Evidence
- `src/cli/commands/roadmap.ts:166-169` — the `next` action calls `roadmapStore.removeTop()` and auto-commits immediately after building the handoff, with no preview flag, confirmation, or `--dry-run` branch anywhere in the handler (lines 133-182).
- `src/roadmap/roadmap-store.ts:153-160` — `removeTop()` is load → shift → save with the popped entry returned but never persisted anywhere recoverable; no restore/undo path exists in the store.
- `.claude/skills/metta-roadmap/SKILL.md:23,33` — the skill dispatches `metta roadmap next` directly and documents "read the top entry from `metta roadmap`" as the preview convention, confirming the read/mutate split exists only as skill-side lore, not CLI enforcement.

## Candidate Solutions
1. **Make bare `next` read-only; gate the pop behind `--pop` (or `--start`)** — `metta roadmap next` reports the head entry and the promote handoff without writing; the mutation requires an explicit flag. Update the `metta-roadmap` skill's `next` branch and docs to pass the flag, and adjust guard/mint scopes if the flag changes the write surface. Tradeoff: breaking change to the CLI contract — any existing automation or skill flow relying on `next` popping silently stops mutating until updated, and the two-step flow adds friction to the intended activation path.
2. **Keep `next` mutating but add a confirmation prompt with `--yes` for automation** — interactive `askYesNo` before the pop ("Remove '<slug>' from the roadmap? [y/N]"), with `--yes` (or `--json` implying non-interactive refusal without `--yes`) for skills and CI. Tradeoff: prompts are awkward in the skill-dispatched Bash path (no TTY), so the skill must always pass `--yes`, which preserves the trap for orchestrators and only protects humans at a terminal.
3. **Add `roadmap peek` plus an undo affordance, keep `next` as-is** — introduce a read-only `peek` subcommand and make `next`'s output print the exact restore command (or add `roadmap restore` replaying the last popped entry from the pop commit). Tradeoff: preserves the least-surprise violation on `next` itself — humans will still reach for the intuitive verb first and get mutated state, now merely with a documented escape hatch.

