# Review: fix-metta-install-copies-metta-tokens-record-mjs

Three review lenses over commit 6ffd41d49 (diff vs main: src/cli/commands/install.ts, tests/cli-install.test.ts).

## Correctness reviewer — PASS

- `registerTokensRecordHook` mirrors `registerGuardBashHook` exactly: reads via the shared `readSettingsJson` helper (tolerates missing/partial settings), defensively normalizes `hooks` and `SubagentStop` shapes, and only writes when the entry is absent.
- Idempotence check (`command.includes('metta-tokens-record.mjs')`) matches the guard-hook precedent and the issue's prescribed check.
- Entry shape matches the hand-written registration in the metta repo's own `.claude/settings.json` (no `matcher`, `type: 'command'`, project-relative command path).
- Call site is correctly gated on `hooksInstalled.includes('metta-tokens-record.mjs')` and uses the same warning-not-fatal try/catch as the guard registrations, so a settings write failure cannot abort install.
- Ordering is safe: registration runs before `installMettaStatusline`, which re-reads settings.json before its own write — sequential awaits, no lost update.
- Verified by tests: fresh registration, idempotence across double install, guard-entry preservation. No critical issues.

## Security reviewer — PASS

- Writes only the project-local `.claude/settings.json`; no user-controlled input reaches the written content (command path is a fixed literal).
- No shell interpolation — settings written via `writeFile` with `JSON.stringify`.
- Unknown/unrelated settings keys and hook entries are preserved (mutation of the parsed object, not reconstruction), so no clobbering of consumer configuration. No issues.

## Quality reviewer — PASS_WITH_WARNINGS

- Code, comment update, JSON field (`tokens_record_hook_installed`), and console line are consistent with the surrounding style; tests follow the existing describe-block conventions.
- Warning (accepted, non-blocking): this is the third hand-rolled per-hook registration function; a fourth settings-registered hook would repeat the original failure mode. The intent explicitly scopes manifest generalization (candidate 2) and doctor drift detection (candidate 3) out of this minor fix — noted for backlog, not a defect in this change.

## Verdict

No critical issues. 2 PASS, 1 PASS_WITH_WARNINGS — review clean, proceed to verification.
