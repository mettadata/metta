# fix-metta-install-copies-metta-tokens-record-mjs

## Problem

`metta install` deploys the `metta-tokens-record.mjs` SubagentStop hook into every consumer project's `.claude/hooks/` directory (the readdir-driven `installMettaHooks` copies everything in `src/templates/hooks/`), but never registers it in the consumer's `.claude/settings.json`. Claude Code only invokes hooks that are settings-registered (or frontmatter-scoped), so automatic token recording silently never runs in any installed project. The metta repo itself is the sole exception because its `.claude/settings.json` carries a hand-written `SubagentStop` entry (settings.json line 23) that install never reproduces.

Affected users: every consumer project that runs `metta install` and expects automatic token recording. They silently fall back to the prose-recording path with no signal that the automatic path is dead.

Root cause: hook *deployment* is generic (readdir-driven), but settings *registration* is per-hook and explicit — only `registerGuardEditHook` and `registerGuardBashHook` exist (install.ts lines 57–105). When commit 6bfae4307 added `metta-tokens-record.mjs` to the templates directory, the copy half came for free but no SubagentStop registration counterpart was added. The guiding comment at install.ts line 355 enumerates only the two guard hooks as settings-registered and treats every other hook as frontmatter-scoped by design — an assumption that does not hold for a SubagentStop hook.

## Proposal

Mirror the existing guard-hook registration pattern for the tokens-record hook (candidate solution 1 from the issue):

1. Add a `registerTokensRecordHook(root)` function to `src/cli/commands/install.ts` that idempotently appends a `SubagentStop` entry pointing at `.claude/hooks/metta-tokens-record.mjs` to the consumer's `.claude/settings.json`. Idempotence check matches the existing pattern: skip when any existing `SubagentStop` entry's command includes `metta-tokens-record.mjs`. `SubagentStop` entries carry no `matcher` field (mirroring the hand-written entry in the metta repo's own settings.json).
2. Call it from the install flow guarded by `hooksInstalled.includes('metta-tokens-record.mjs')`, with the same try/catch warning-not-fatal error handling as the guard-hook registrations, and surface the result in install's reporting alongside the guard flags.
3. Update the comment at install.ts line 355 so it accurately states that three hooks are settings-registered (metta-guard-edit, metta-guard-bash PreToolUse; metta-tokens-record SubagentStop) while metta-session-mint and metta-guard-agent-dispatch remain frontmatter-scoped.
4. Add unit tests covering: fresh install registers the SubagentStop entry; re-running install does not duplicate it; existing unrelated hook entries in settings.json are preserved.

## Impact

- `metta install` (and re-install on existing projects) will now write a `SubagentStop` entry to `.claude/settings.json`. Re-running install on already-configured projects (including the metta repo) is a no-op thanks to the idempotence check.
- Consumer projects gain working automatic token recording on their next `metta install` run.
- No behavior change to hook file deployment, the two guard-hook registrations, or the statusline installer.

## Out of Scope

- Generalizing registration into a declarative hook manifest (candidate 2) — a larger install.ts refactor with settings-merge regression risk; not justified for a minor fix. A fourth settings-registered hook would be the trigger to do it.
- Hook-registration drift detection in `metta doctor` (candidate 3) — detection-only complement, separate change.
- Any change to `metta-tokens-record.mjs` itself or to the token-recording data model.
