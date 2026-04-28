# Verify: tests

## Command

```
npx vitest run
```

## Result

PASS

```
Test Files  69 passed (69)
     Tests  951 passed (951)
   Duration  666.61s
```

## Coverage of new behavior

| Spec area | Test file | Cases |
|-----------|-----------|-------|
| Schema field `stop_after` | tests/schemas.test.ts | 3 (accepts string / omits when absent / rejects non-string) |
| `ArtifactStore.createChange(stopAfter)` | tests/artifact-store.test.ts | 3 (persists / omits / composes with autoAccept+workflowLocked) |
| CLI `--stop-after` happy path | tests/cli-propose-stop-after.test.ts | 1 |
| CLI rejects unknown / execution-phase ids | tests/cli-propose-stop-after.test.ts | 3 (`spex`, `implementation`, `verification`) |
| CLI omission preserves prior behavior | tests/cli-propose-stop-after.test.ts | 1 |
| CLI composes with `--workflow` and `--auto` | tests/cli-propose-stop-after.test.ts | 1 |
| `metta status --json` surfaces `stop_after` | tests/cli-propose-stop-after.test.ts + tests/cli.test.ts | 2 + 2 |

All 8 cases in `tests/cli-propose-stop-after.test.ts` pass on first run; full suite is green.

## Notes

- Skill Step-3 boundary check (in `.claude/skills/metta-propose/SKILL.md`) is markdown-instruction text consumed by the orchestrator, not directly unit-testable. The byte-identity check (`diff -q` against `src/templates/skills/metta-propose/SKILL.md`) confirmed the deployed and source-of-truth copies match.
