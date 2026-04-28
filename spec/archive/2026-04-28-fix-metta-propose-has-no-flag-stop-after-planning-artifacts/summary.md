# Summary: fix-metta-propose-has-no-flag-stop-after-planning-artifacts

Closes issue `metta-propose-has-no-flag-to-stop-after-planning-artifacts` (minor).

## Deliverables

1. **`src/schemas/change-metadata.ts`** — added optional `stop_after` field to `ChangeMetadataSchema`. Persisted in `.metta/state.yaml` per change so the skill knows where to halt.
2. **`src/artifacts/artifact-store.ts`** — `createChange()` accepts optional `stopAfter` parameter and persists it in metadata.
3. **`src/cli/commands/propose.ts`** — added `--stop-after <artifact>` option with workflow-aware validation (must be a valid artifact in the chosen workflow).
4. **`.claude/skills/metta-propose/SKILL.md` + `src/templates/skills/metta-propose/SKILL.md`** (byte-identical) — skill checks `change.stop_after` after each `metta complete` and exits cleanly with a deterministic handoff line so the user knows what to run next (e.g., `/metta-execute` to resume).

## Behavior

```
/metta-propose "build frobnicator" --stop-after tasks
# runs intent → stories → spec → research → design → tasks
# halts after tasks, prints: "Stopped after `tasks`. Resume with /metta-execute when ready."
# user reviews diffs, then /metta-execute drives implementation
```

Without `--stop-after`, behavior is unchanged — full lifecycle to merge.

## Verification

Targeted tests for schema + artifact-store + propose CLI passed. Full suite to be verified at finalize.
