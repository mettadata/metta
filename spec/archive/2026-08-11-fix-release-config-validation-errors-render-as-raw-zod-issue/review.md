# Review: fix-release-config-validation-errors-render-as-raw-zod-issue

Reviewed commit: 19916c684 (`fix(cli): render ZodError as path: message lines instead of raw issue array`)

## Verdicts

| Reviewer | Verdict |
|----------|---------|
| Correctness | PASS |
| Security | PASS_WITH_WARNINGS |
| Quality | PASS |

## Correctness (PASS)

- 50/50 tests pass across the three touched test files; `tsc --noEmit` clean.
- `instanceof ZodError` reliable: single zod install (3.25.76), all imports use the root `'zod'` entry.
- Branch ordering in `handleError` correct: `ConfigParseError` checked before the `ZodError` branch; both exit 4.
- Barrel omission consistent: `src/index.ts` exports no `util/` modules.
- Minor (accepted): empty `issues` array yields `''` (unreachable via real parse failures); `invalid_union` renders only the top-level message.

## Security (PASS_WITH_WARNINGS)

- Goal achieved: `code`/`expected`/`path` internals no longer leak in text or `--json` output; envelope and exit code 4 preserved.
- **Warning (fixed post-review):** `src/util/format-zod-error.ts` printed `issue.message` verbatim in text mode; zod enum/literal messages echo the received value, so raw control characters in a hostile config value could reach the terminal (ANSI escape injection). The old JSON serialization accidentally escaped them. Fix: sanitize control characters in `formatZodIssue` and add a hostile-value test.
- Suggestion (accepted, no action): received values still echo in messages — standard Zod behavior, less leakage than before.

## Quality (PASS)

- Conventions all pass: kebab-case filenames, camelCase naming, `.js` import extensions, no string-literal templates, pure formatter (functional core), 1:1 test file for the new source file.
- Test quality: exact expected strings from real `safeParse` failures, negative assertions against raw-issue leakage, temp-dir isolation and env cleanup verified.
- Suggestions (accepted, no action): empty-issues fallback; `err.name === 'ZodError'` as a dual-package-hazard-proof alternative.

## Resolution

No critical issues. The single security warning (control-character sanitization) is fixed in a follow-up commit with a regression test; all other findings are accepted suggestions.
