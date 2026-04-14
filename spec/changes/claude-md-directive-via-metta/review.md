# Review: claude-md-directive-via-metta

Three reviewers ran in parallel.

## Correctness — PASS_WITH_WARNINGS → applied
- Hook contract, exit codes, fall-through, idempotency, merge semantics all correct.
- Warnings addressed:
  - **Array.isArray guards** on `settings.hooks` and `PreToolUse` — applied.
  - **Malformed settings.json**: was silently overwritten; now throws a clear error telling the user to fix it and re-run — applied.

## Security — PASS_WITH_WARNINGS → applied
- `execFile` argv form, no shell injection, no pollution sinks, safe file perms (`0755`), no path escape.
- Only malformed-settings-value concern — resolved by the Array.isArray + throw-on-invalid-JSON changes.

## Quality — PASS_WITH_WARNINGS → applied
- Directive wording good.
- Warning: guard hook install was silent in both human and JSON output — applied: human output now prints `Installed: PreToolUse guard hook (...)` when successful; JSON payload gains `guard_hook_installed: bool`.
- Warning: hook install failure was swallowed — applied: writes `Warning: failed to install metta-guard hook — ...` to stderr.
- Suggestion: guard's stderr message should mention escape hatch — applied: added `Emergency bypass: disable this hook in .claude/settings.local.json.` to the blocked-message footer.

## Verdict
All three reviewers PASS after the 5 consolidated fixes. Full suite: 331/331.
