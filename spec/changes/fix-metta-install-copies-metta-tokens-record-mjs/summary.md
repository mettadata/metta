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
