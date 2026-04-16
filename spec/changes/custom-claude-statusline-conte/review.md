# Code Review: custom-claude-statusline-conte

## Summary
The statusline implementation is well-structured with solid security fundamentals. Command execution uses `execFile` with array arguments, and JSON parsing is consistently wrapped in try/catch. A few minor issues worth noting but nothing critical.

## Issues Found

### Critical (must fix)
(none)

### Warnings (should fix)

- `src/templates/statusline/statusline.mjs:84-85` — **Path traversal via `transcript_path`**: The `readTranscriptTail` function reads whatever path `transcript_path` provides from stdin without any validation or path containment check. A malicious or misconfigured Claude Code process could supply an arbitrary path like `/etc/shadow` or `../../sensitive-file`. While the threat model is limited (stdin comes from Claude Code, not an external attacker), adding a check that the path is under the expected transcript directory would be defense-in-depth. Severity: WARNING.

- `src/cli/commands/install.ts:30-31` — **Partial settings.json content leak in error messages**: When `settings.json` is malformed, the error message includes the parse error cause which may echo back fragments of the file content. If `settings.json` ever contained sensitive values (API keys, tokens), these could leak into terminal output or logs. Severity: WARNING.

- `src/cli/commands/install.ts:83-84` — **Existing statusLine value echoed to stderr**: At line 83, the existing `statusLine` value is serialized via `JSON.stringify` and written to stderr. If someone placed sensitive data in the `statusLine` field of settings.json, it would be printed. Low risk but worth noting. Severity: WARNING.

### Suggestions (nice to have)

- `src/templates/statusline/statusline.mjs:64` — **File permission 0o755 is acceptable but 0o700 would be tighter**: The script only needs to be executable by the owner. 0o755 allows group/other read+execute. Since this is a local dev tool in `.claude/`, 0o700 would follow least-privilege. Same applies to `install.ts:64`. Severity: INFO.

- `src/templates/statusline/statusline.mjs:76` — **Prototype pollution from `JSON.parse` on stdin**: `readStdin()` parses untrusted JSON from stdin. While `JSON.parse` in V8 does not populate `__proto__` on the returned object (properties named `__proto__` become own properties, not prototype links), the parsed object is only accessed via `.model?.id` and `.transcript_path`, both with `typeof` guards. The current code is safe; no action needed. Severity: INFO (clean).

- `src/templates/statusline/statusline.mjs:93-95` — **`execFile` usage is correct and safe**: `execFileAsync('metta', ['status', '--json'], ...)` uses `execFile` (not `exec`), passes arguments as an array, and sets a 5-second timeout. No command injection vector. The `JSON.parse(stdout)` on line 94 is inside a try/catch. Severity: INFO (clean).

- `src/templates/statusline/statusline.mjs:35` — **All `JSON.parse` calls are wrapped in try/catch**: Checked all four call sites (lines 35, 76, 94, and `install.ts:69`). All are properly guarded. Severity: INFO (clean).

## Verdict
PASS_WITH_WARNINGS
