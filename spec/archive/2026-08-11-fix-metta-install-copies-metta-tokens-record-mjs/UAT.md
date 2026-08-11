# UAT: fix-metta-install-copies-metta-tokens-record-mjs

- **Change**: fix-metta-install-copies-metta-tokens-record-mjs
- **Generated**: 2026-08-11
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
The sanctioned UAT runner (`/metta-uat`) may flip a step's Pass checkbox
to reflect a genuinely observed outcome and may append dated `## UAT run`
records below the steps. Never fabricate a pass: do not alter step content,
and never check a box for behavior that was not actually observed.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Add a `registerTokensRecordHook(root)` function to `src/cli/commands/install.ts` that idempotently appends a `SubagentStop` entry pointing at `.claude/hooks/metta-tokens-record.mjs` to the consumer's `.claude/settings.json`. Idempotence check matches the existing pattern: skip when any existing `SubagentStop` entry's command includes `metta-tokens-record.mjs`. `SubagentStop` entries carry no `matcher` field (mirroring the hand-written entry in the metta repo's own settings.json).
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Call it from the install flow guarded by `hooksInstalled.includes('metta-tokens-record.mjs')`, with the same try/catch warning-not-fatal error handling as the guard-hook registrations, and surface the result in install's reporting alongside the guard flags.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Update the comment at install.ts line 355 so it accurately states that three hooks are settings-registered (metta-guard-edit, metta-guard-bash PreToolUse; metta-tokens-record SubagentStop) while metta-session-mint and metta-guard-agent-dispatch remain frontmatter-scoped.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Add unit tests covering: fresh install registers the SubagentStop entry; re-running install does not duplicate it; existing unrelated hook entries in settings.json are preserved.
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Trivial-tier change (no spec.md); scenarios derive from the intent's proposal, each backed by a test in `tests/cli-install.test.ts`:

#### Step 2.1
- **Do**: Confirm: `src/cli/commands/install.ts`
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: `tests/cli-install.test.ts` — three new tests:
- **Observe**: behaves as described
- [ ] Pass
