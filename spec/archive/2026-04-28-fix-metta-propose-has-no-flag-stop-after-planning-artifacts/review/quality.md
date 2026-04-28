# Code Review: fix-metta-propose-has-no-flag-stop-after-planning-artifacts

## Summary

The change adds a `--stop-after <artifact>` flag to `metta propose`, persists it on the change record via an optional Zod-schema field, and updates the propose skill to honor the boundary. Implementation is small, focused, and well-tested: tsc clean, all 951 vitest cases pass across 69 files, the deployed `.claude/skills/metta-propose/SKILL.md` is byte-identical to the source-of-truth template, and the diff is scope-bounded (8 source/test files plus skill template plus planning artifacts).

## Issues Found

### Critical (must fix)

None.

### Warnings (should fix)

- `src/cli/commands/propose.ts:75` — Pre-existing duplicate `const config = await ctx.configLoader.load()` shadows the outer `config` declared at line 29. This was not introduced by this change (the outer load is at line 29 in the diff context), but the new flag did not take the opportunity to clean it up. Non-blocking; mention in a follow-up issue if desired.
- `src/templates/skills/metta-propose/SKILL.md` step-1 parsing block — The skill instruction tells the orchestrator to extract `--stop-after <value>` and remove "both tokens" from `$ARGUMENTS`, but does not explicitly forbid quoting the value (e.g. `--stop-after "tasks"`). The CLI itself handles this via Commander, but the skill's parse-and-strip pattern is hand-coded. Low risk because all valid values are single bareword tokens, but worth a sentence noting "value MUST be a bareword token (no spaces, no quoting)".
- Spec scenario "execution-phase artifact id is rejected" requires the error to "explain that execution-phase ids are not valid stop points." The implementation message is `--stop-after value 'implementation' is an execution-phase artifact and is not a valid stop point. Valid values are: ...` — passes the substring check `expect(text).toContain('execution-phase')` in tests, but the phrase is hyphenated. If future spec consumers grep for the unhyphenated phrase "execution phase", they will miss. Acceptable as-is; the test pins the exact form.

### Suggestions (nice to have)

- `src/artifacts/artifact-store.ts:20-28` — `createChange` now has 7 positional parameters (`description`, `workflow`, `artifactIds`, `baseVersions`, `autoAccept`, `workflowLocked`, `stopAfter`). The spec's fourth requirement explicitly allowed an options-object refactor as an alternative; remaining positional preserves call-site compatibility but is approaching the "too many positional booleans" smell. A future refactor should consolidate the trailing optional flags into `{ autoAccept?, workflowLocked?, stopAfter? }`.
- `src/cli/commands/propose.ts:91` — The JSON output normalises absent stop-after to `null` (`stop_after: stopAfter ?? null`). The spec leaves "omit OR null" open; this is fine, but the test in `tests/cli-propose-stop-after.test.ts:108` accepts both `null` and `undefined`, so behavior is locked-in but not asserted-on directly. A focused assertion (`expect(data.stop_after).toBeNull()`) would document the chosen contract.
- `src/cli/commands/propose.ts:99-101` — Human-readable mode prints `Stop after: <value>` only when set, but does not list the resume command — a small UX nicety. Skill output covers this when invoked from `/metta-propose`.
- `tests/cli-propose-stop-after.test.ts:35` — `runCli` uses `npx tsx CLI_PATH`, while several other CLI integration tests use compiled `dist/cli.js`. Both work; consistency would be better. Not a correctness issue.
- Naming consistency: `stop_after` (snake_case) is used in YAML / JSON output, `stopAfter` (camelCase) inside TypeScript. This matches the codebase convention (`auto_accept_recommendation` / `autoAccept`) — no action needed, just confirming the pattern is followed.

## Verdict

PASS

### Evidence

- `npx tsc --noEmit` — clean, no errors.
- `npx vitest run` — Test Files 69 passed (69), Tests 951 passed (951), Duration 666.61s.
- `diff -q .claude/skills/metta-propose/SKILL.md src/templates/skills/metta-propose/SKILL.md` — no output (byte-identical).
- `git diff main..HEAD --stat` — 20 files changed (1375 insertions, 6 deletions). Source/test footprint is 5 source files (artifact-store.ts, propose.ts, change-metadata.ts, two skill SKILL.md copies) and 4 test files (artifact-store.test.ts, cli-propose-stop-after.test.ts, cli.test.ts, schemas.test.ts). The remaining 11 files are spec/changes planning artifacts under the change directory — expected scope.

### Coverage

- Schema field — 3 tests in `tests/schemas.test.ts:239-284` (accepts string, omits when absent, rejects non-string).
- ArtifactStore — 3 tests in `tests/artifact-store.test.ts:101-137` (persists, omits, composes with autoAccept+workflowLocked).
- CLI flag — 8 tests in `tests/cli-propose-stop-after.test.ts` covering happy path, unknown rejection, both execution-phase rejections, omission, composition with `--workflow`/`--auto`, and `metta status --json` round-trip.
- `metta status` regression — 2 tests in `tests/cli.test.ts:437-451` confirming JSON shape both ways.
- Skill exit boundary — Documented in `.claude/skills/metta-propose/SKILL.md` Step 1 + Step 3 sub-step. No automated test of the skill exit flow itself (this is a markdown instruction file consumed by Claude, not directly testable as code). Spec scenario "tests can assert the handoff line shape" remains a runtime/manual-verification scenario; no unit test pins the literal substring against actual orchestrator output, but the skill text uses the exact required form.

### Scope

No scope creep observed. All source-code changes (5 files) map directly to spec requirements. The 11 spec/planning files are normal change-lifecycle artifacts.
