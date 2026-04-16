# Code Review: custom-claude-statusline-conte

## Summary
The statusline script and install integration are well-structured with good error handling. However, there is one critical bug in `resolveContextWindow` where the implementation reads `model.id` (a nested property) while the spec requires reading `model` directly as a string. The install function also deviates from spec by storing a structured object for `statusLine` rather than the absolute path string the spec requires.

## Issues Found

### Critical (must fix)

- `src/templates/statusline/statusline.mjs:9` -- `resolveContextWindow` reads `stdinObj?.model?.id` but the spec says the `model` field is a flat string (e.g. `"model":"claude-opus-4-6[1m]"`), not an object with an `id` sub-field. The spec states: "The script MUST extract `transcript_path` (string) and `model` (string) fields from the parsed object." and "The script MUST treat absent or non-string values for either field as if the field were not supplied." The stdin contract scenarios all show `model` as a direct string value. The function should check `typeof stdinObj?.model === 'string'` and call `.includes('[1m]')` on that string. As implemented, valid spec input like `{"model":"claude-opus-4-6[1m]"}` will always return 200000 (the default), never 1000000, because `model` is a string and `model.id` is `undefined`.

- `src/cli/commands/install.ts:59,78-80,88` -- The spec requires `statusLine` to be set to "the absolute path to the installed script" (a string). The implementation stores a structured object `{ type: 'command', command: '.claude/statusline/statusline.mjs', padding: 0 }` instead. Furthermore, the comparison on line 79 checks `existingCmd === installedCmd` where `installedCmd` is the relative path `.claude/statusline/statusline.mjs`, not an absolute path resolved against the project root as the spec demands. The idempotency check and the stored value both deviate from the spec. (Note: if the Claude Code settings format genuinely requires the object shape, the spec should be amended to match.)

- `tests/statusline-resolve-context-window.test.ts:6` -- All test cases pass `{ model: { id: '...' } }` matching the buggy implementation rather than the spec's `{ model: '...' }` contract. The tests will pass but they validate the wrong behavior. Every test in this file must be updated to match the corrected contract.

### Warnings (should fix)

- `src/templates/statusline/statusline.mjs:54,57` -- The palette has 8 entries `[31, 32, 33, 34, 35, 36, 91, 92]` and the modulus is hardcoded as `hash % 8`. If the palette changes, the modulus must also change. Using `palette.length` instead of the literal `8` would prevent a future mismatch bug.

- `src/cli/commands/install.ts:77-86` -- The idempotency check compares `existingCmd` (the `.command` property of the existing `statusLine` object) to `installedCmd`. If a previous install stored `statusLine` as a plain string (per spec), `(existing as Record<string, unknown>)?.command` would be `undefined`, the comparison would fail, and the warning path would trigger instead of no-op. This breaks idempotency across format changes.

- `src/templates/statusline/statusline.mjs:55-57` -- The hash function `hash += slug.charCodeAt(i)` is a simple additive hash. Anagram slugs (e.g. `abc` vs `bca`) will always produce the same color. The spec only requires same-slug-same-color determinism so this is not a violation, but distribution across the palette will be poor for similar slugs.

### Suggestions (nice to have)

- `src/templates/statusline/statusline.mjs:17-28` -- `readTranscriptTail` uses a manual try/catch pattern for `fd.close()`. Consider using `try/finally` or Node's `FileHandle[Symbol.asyncDispose]` for cleaner resource management.

- `package.json:18` -- The `copy-templates` script uses `cp -r` which does not explicitly preserve the executable bit on all platforms. On Linux/macOS `cp -r` preserves mode by default, but `cp -r --preserve=mode` would be more explicit per the spec requirement to preserve `0o755`.

- `tests/statusline-install.test.ts:62-76` -- The re-run idempotency test relies on a 50ms `setTimeout` to detect mtime changes, which can be flaky on filesystems with coarse timestamps. Consider comparing file content instead of mtime.

## Verdict
NEEDS_CHANGES

### What must be fixed before merge:
1. `resolveContextWindow` must read `stdinObj.model` as a string directly, not `stdinObj.model.id`. The spec is unambiguous: `model` is a string field on the stdin JSON object.
2. `installMettaStatusline` must either store `statusLine` as the absolute path string (resolved against project root) per spec, or the spec must be amended to reflect the actual Claude Code settings format if the object shape is required by Claude Code.
3. All `resolveContextWindow` tests must be updated to match the corrected contract (flat `model` string, not nested `model.id`).
