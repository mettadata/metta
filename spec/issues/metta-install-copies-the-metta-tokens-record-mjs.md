# metta install copies the metta-tokens-record.mjs SubagentStop hook into consumer projects but does not register it in Claude Code settings

**Captured**: 2026-08-11
**Status**: logged
**Severity**: minor

## Symptom
`metta install` copies `metta-tokens-record.mjs` (a SubagentStop hook) into consumer projects' `.claude/hooks/` directory, but never registers it in the consumer's `.claude/settings.json`. Claude Code only invokes hooks that are settings-registered (or frontmatter-scoped), so automatic token recording silently never runs in any project except the metta repo itself, where the registration was committed by hand. Consumers fall back to the prose-recording path without any signal that the automatic path is dead. Observed at ship of PR #61 (fix-automatic-token-recording-via-posttooluse-hook-remove).

## Root Cause Analysis
The installer's hook deployment is readdir-driven — `installMettaHooks` copies every file in `src/templates/hooks/` (a deliberate design so new hooks deploy with zero installer changes). Settings registration, however, is per-hook and explicit: only `registerGuardEditHook` and `registerGuardBashHook` exist, each idempotently appending a PreToolUse entry to `.claude/settings.json`. When commit 6bfae4307 added `metta-tokens-record.mjs` to the templates dir, the copy half came for free but no `registerTokensRecordHook` (SubagentStop) counterpart was added, and the guiding comment in install.ts only enumerates the two guard hooks as settings-registered — treating everything else as frontmatter-scoped by design, which does not hold for a SubagentStop hook. The metta repo works only because its own `.claude/settings.json` carries a hand-written SubagentStop entry that install never reproduces. There is also no drift detection: nothing (e.g. `metta doctor`) compares deployed hooks against settings registrations.

### Evidence
- `src/cli/commands/install.ts:355` — comment states only metta-guard-edit and metta-guard-bash are settings-registered; the registration block below has no SubagentStop branch for metta-tokens-record.
- `.claude/settings.json:23` — the metta repo carries a hand-registered SubagentStop entry for `.claude/hooks/metta-tokens-record.mjs`, proving registration is required for the hook to fire and that install does not produce it.
- `src/templates/hooks/metta-tokens-record.mjs` (added in 6bfae4307) — hook shipped to templates with no accompanying install-side registration change (git log shows no install.ts commit for it).

## Candidate Solutions
1. **Add a `registerTokensRecordHook` step to install** — Mirror the existing guard-hook pattern: after `installMettaHooks`, if `metta-tokens-record.mjs` was installed, idempotently append a SubagentStop entry to `.claude/settings.json` (check `command.includes('metta-tokens-record.mjs')` before pushing), and update the install.ts comment to reflect three settings-registered hooks. Tradeoff: perpetuates the per-hook hand-rolled registration functions — a fourth settings-registered hook will hit the same silent gap again.
2. **Generalize registration via a declarative hook manifest** — Replace the per-hook register functions with a single table (hook filename → Claude Code event + matcher) driven by the same readdir inventory, so any templates hook that requires settings registration declares it and install wires it automatically; frontmatter-scoped hooks are simply absent from the table. Tradeoff: larger refactor of install.ts touching the two existing guard registrations, with regression risk in settings.json merge behavior.
3. **Add hook-registration drift detection to `metta doctor`** — Have doctor compare `.claude/hooks/` contents against `settings.json` hook entries and report deployed-but-unregistered hooks (and vice versa), so this class of failure is loud instead of silent. Tradeoff: detection only — consumers still need a fix in install (options 1 or 2) for the hook to actually run, so this is a complement, not a standalone remedy.
