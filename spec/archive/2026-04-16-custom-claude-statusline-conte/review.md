# Code Review: custom-claude-statusline-conte

## Summary
Clean, well-structured implementation with thorough test coverage. The statusline script correctly handles all error paths (empty stdin, missing files, subprocess failures) and always exits 0. The install function follows the established guard-hook pattern. No critical issues found. Prior review flagged `model.id` access as a spec violation, but the design doc research confirms `model` is an object with an `id` sub-field in the actual Claude Code stdin contract -- the spec wording is loose but the implementation is correct.

## Issues Found

### Critical (must fix)
(none)

### Warnings (should fix)

- `src/templates/statusline/statusline.mjs:57` -- The palette has 8 entries but the modulus is hardcoded as `hash % 8`. Using `palette[hash % palette.length]` instead of `palette[hash % 8]` would prevent a silent bug if the palette is later extended or trimmed.

- `src/templates/statusline/statusline.mjs:67` -- `formatStatusLine` checks `ctxPct !== null && ctxPct !== undefined` but does not guard against `NaN`. If `computePercent` were ever called with `window = 0` (division by zero), `Math.round(NaN)` returns `NaN` and the output would be `[metta: idle] NaN%`. The current callers prevent this (window is always 200000 or 1000000), but a `Number.isFinite(ctxPct)` check would be defense-in-depth.

- `src/cli/commands/install.ts:55-90` vs spec requirement "Install auto-registration" -- The spec says the `statusLine` value should be "the absolute path to the installed script". The implementation stores a relative path inside a structured object `{ type: 'command', command: '.claude/statusline/statusline.mjs', padding: 0 }`. Design doc ADR-1 explicitly justifies this (matching the guard-hook convention, portability across clones). The object shape matches Claude Code's actual settings format. This is a spec-wording-vs-implementation divergence that should be reconciled in the spec text, not the code.

- `tests/statusline-install.test.ts:70-71` -- The re-run idempotency test uses a 50ms `setTimeout` to ensure mtime would differ if the file were rewritten. On filesystems with coarse timestamps (e.g., some CI environments with 1-second resolution), this can produce false passes. Comparing file content hash or byte-for-byte equality would be more robust.

### Suggestions (nice to have)

- `src/cli/commands/install.ts:14-53` vs `src/cli/commands/install.ts:55-90` -- The settings.json read-parse-validate block is duplicated between `installMettaGuardHook` (lines 24-32) and `installMettaStatusline` (lines 66-74). The design doc acknowledges this as intentional near-clones. Extracting a shared `readSettingsJson(path): Promise<Record<string, unknown>>` helper would reduce duplication and ensure consistent error messaging. Not blocking.

- `src/templates/statusline/statusline.mjs:90,102` -- `artifact` is initialized to `'idle'` on line 90 and re-assigned to `'idle'` in the catch block on line 102. The catch assignment is redundant since `artifact` already holds `'idle'` if the try block throws before line 95 reassigns it. Simplifying the catch to just `catch {}` would be cleaner, though harmless as-is.

- `tests/statusline-install.test.ts` -- No test covers `installMettaStatusline` throwing when the directory cannot be created (e.g., permissions error). The spec's "Install failure isolation" requirement about script-copy failures is tested only indirectly through the install action's try/catch. A unit test calling `installMettaStatusline` on a read-only root and asserting it throws would strengthen coverage of that error path.

- Test file organization -- The design doc specifies nested test paths like `test/templates/statusline/*.test.ts` but actual tests use a flat structure `tests/statusline-*.test.ts`. The flat structure is consistent with the existing project test layout. No action needed, but the design doc is inaccurate on this point.

- `src/templates/statusline/statusline.mjs:55-57` -- The additive hash `hash += slug.charCodeAt(i)` means anagram slugs (e.g., `abc` vs `cba`) always produce the same color. The spec only requires same-slug-same-color determinism, so this is compliant, but distribution could be improved with a position-sensitive hash (e.g., `hash = hash * 31 + charCodeAt(i)`).

## Verdict
PASS
