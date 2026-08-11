# Summary: fix-metta-install-copies-metta-tokens-record-mjs

## What changed

- `src/cli/commands/install.ts`
  - Added `registerTokensRecordHook(root)` — idempotently appends a `SubagentStop` entry for `.claude/hooks/metta-tokens-record.mjs` to the consumer's `.claude/settings.json`, mirroring the existing `registerGuardEditHook` / `registerGuardBashHook` pattern (skip when any existing SubagentStop entry's command includes `metta-tokens-record.mjs`; no `matcher` field, matching the hand-written entry in the metta repo's own settings.json).
  - Wired it into the install flow guarded by `hooksInstalled.includes('metta-tokens-record.mjs')`, with the same try/catch warning-not-fatal handling as the guard registrations.
  - Surfaced the result as `tokens_record_hook_installed` in the JSON output and as an `Installed: SubagentStop tokens-record hook` line in console output.
  - Updated the registration comment to enumerate three settings-registered hooks (guard-edit, guard-bash, tokens-record) while metta-session-mint and metta-guard-agent-dispatch remain frontmatter-scoped.
- `tests/cli-install.test.ts` — three new tests:
  - fresh install registers the SubagentStop entry
  - second install does not duplicate the entry (idempotence)
  - registration preserves the two PreToolUse guard entries and the SubagentStop entry has no matcher, correct type/command

## Verification

- `npx tsc --noEmit` — clean
- `npm run build` — clean
- `npx vitest run tests/cli-install.test.ts` — 36/36 passed (33 pre-existing + 3 new)
- `npm run lint` — clean

## Commits

- 6ffd41d49 `fix(install): register metta-tokens-record SubagentStop hook in settings.json`

# Verification: fix-metta-install-copies-metta-tokens-record-mjs

## Spec Scenarios

Trivial-tier change (no spec.md); scenarios derive from the intent's proposal, each backed by a test in `tests/cli-install.test.ts`:

- [x] Fresh `metta install` registers a SubagentStop entry for `metta-tokens-record.mjs` in `.claude/settings.json` — test "registers metta-tokens-record SubagentStop entry in settings.json" (passing)
- [x] Re-running install does not duplicate the SubagentStop entry — test "is idempotent for metta-tokens-record — second install does not duplicate the SubagentStop entry" (passing)
- [x] Registration preserves existing PreToolUse guard entries; entry has no matcher, correct type/command — test "preserves existing PreToolUse guard entries when registering the SubagentStop entry" (passing)
- [x] Registration failure is warning-not-fatal and gated on the hook actually being deployed — same try/catch + `hooksInstalled.includes` pattern as the guard hooks, exercised by the full install test suite (36/36 passing)

## Gate Results

- tests: PASS — 118 files, 2083/2083 tests
- typecheck: PASS — `npx tsc --noEmit` clean
- lint: PASS — `npm run lint` clean
- build: PASS — `npm run build` clean

## Summary

`metta install` now settings-registers the `metta-tokens-record.mjs` SubagentStop hook it deploys, so automatic token recording works in consumer projects. Review verdicts: correctness PASS, security PASS, quality PASS_WITH_WARNINGS (accepted: per-hook registration pattern retained; manifest generalization deliberately out of scope). All verification gates green.
