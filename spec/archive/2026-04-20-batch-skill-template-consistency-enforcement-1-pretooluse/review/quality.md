# Code Review: batch-skill-template-consistency-enforcement-1-pretooluse (Quality) — Iteration 2

## Summary

Iteration-2 fix round resolved the two critical items from the prior review. The hook now uses an explicit ALLOW+BLOCK classifier and fails-closed on `unknown`, the unknown-subcommand test exists, and all eleven previously-flagged sibling skills now prefix state-mutating CLI calls with `METTA_SKILL=1`. Mirrors are byte-identical across the board and all 59 bash-guard tests pass. One critical regression remains: `metta-refresh/SKILL.md` still instructs the orchestrator to run bare `metta refresh` (blocklisted in the spec) with no bypass prefix. The `installMettaBashGuardHook` duplication warning still stands, and the blocked-subcommand test matrix still skips ~9 of the 14 declared blocked subcommands.

## Verification of prior review items

1. **Unknown subcommand silent pass (Critical)** — FIXED. `src/templates/hooks/metta-guard-bash.mjs:67-77` now classifies as `'allow' | 'block' | 'unknown'` using explicit ALLOW + BLOCK lists, with `'unknown'` returning `block` (exit 2) at line 108. Confirmed by new tests at `tests/metta-guard-bash.test.ts:78-89` for both one- and two-word unknown forms.
2. **Eleven sibling skills missing METTA_SKILL=1 prefix (Critical)** — FIXED for 10 of the originally-flagged 11. Greppable confirmation: every state-mutating call site in `metta-auto` (L20-21, 33, 39, 52, 69-70), `metta-fix-issues` (L29, 32, 37, 50, 75, 79, 87, 97, 110), `metta-fix-gap` (L29, 32, 37, 50, 75, 87, 97, 110), `metta-ship` (L11-12), `metta-backlog` (L16-18), `metta-init` (L13, 155, 157), `metta-import` (L14), `metta-plan` (L18), `metta-execute` (L22), `metta-verify` (L21), `metta-next` (L17, 22), `metta-propose` (throughout), `metta-quick` (L22, 53, 96, 193-194), `metta-issue` (L13) carries the prefix. **`metta-refresh/SKILL.md` was NOT fixed** — see Critical below.
3. **`installMettaBashGuardHook` duplication** — STILL STANDS. `src/cli/commands/install.ts:14-53` and `:55-94` remain near line-for-line clones; only four substantive deltas (hook basename, template URL, `includes(...)` guard, matcher+command pair). Worth extracting a private helper now — doing so before a third hook or a third tweak to the edit-guard logic lands prevents immediate drift risk. Not blocking, but should not be deferred indefinitely.
4. **Test matrix coverage gaps** — PARTIALLY ADDRESSED. Test count grew from 6 blocked cases to still 6 (`propose`, `quick`, `issue`, `complete`, `backlog add`, `changes abandon`); `auto`, `finalize`, `ship`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `backlog done`, `backlog promote` are still absent from direct blocked-path assertions. The hook's refactor makes this less fragile (the blocked list is now a single `Set` and each call hits the same `classify()` path) but the test file does not parameterize over the full blocklist.
5. **Missing unknown-subcommand test** — FIXED. `tests/metta-guard-bash.test.ts:78-89` covers both the single-word and two-word unknown conservative-block paths and asserts stderr contains `"unknown metta subcommand"`.

## Byte-identity spot check

Verified via `diff`:
- `src/templates/hooks/metta-guard-bash.mjs` == `.claude/hooks/metta-guard-bash.mjs`
- `src/templates/skills/{metta-auto,metta-fix-issues,metta-fix-gap,metta-ship,metta-backlog,metta-init,metta-import,metta-plan,metta-execute,metta-verify,metta-next,metta-propose,metta-quick,metta-issue,metta-refresh}/SKILL.md` all match their `.claude/skills/*/SKILL.md` mirrors (15/15).

## Test run

`npx vitest run tests/metta-guard-bash.test.ts` → 59/59 pass (11s).

## Issues Found

### Critical (must fix)

- `src/templates/skills/metta-refresh/SKILL.md:7, 16, 17` — the skill instructs the orchestrator with `"Run `metta refresh` to regenerate CLAUDE.md..."` on line 7, `"Use `metta refresh --dry-run`..."` on line 16, and `"Use `metta refresh --json`..."` on line 17 with no `METTA_SKILL=1` prefix. `metta refresh` is on the blocklist per `spec.md:5-11` and `src/templates/hooks/metta-guard-bash.mjs:26`. Once the hook is installed, following this skill's instructions will result in exit 2 from the hook. This is the same class of regression the iteration-2 fix round was supposed to eliminate; `metta-refresh` was evidently missed. Fix: prefix the three invocation instructions with `METTA_SKILL=1`. The prose on line 21 ("After writing CLAUDE.md, metta refresh automatically commits...") is descriptive and does not need a prefix.

### Warnings (should fix)

- `src/cli/commands/install.ts:14-94` — `installMettaGuardHook` and `installMettaBashGuardHook` remain near-verbatim clones (40 lines each, 4 lines of substantive difference). Extract a private helper with signature `async function installPreToolUseHook(root: string, hookFileName: string, matcher: string): Promise<void>` and call twice. This is flagged as a warning rather than critical because functional tests pass, but the duplication is a guaranteed future drift surface — any bug fix in one copy (e.g., a JSON-parse error message tweak) has a non-zero chance of missing the other.
- `tests/metta-guard-bash.test.ts:44-75` — the blocked-subcommand test matrix covers only 6 of 14 declared blocked forms. Missing direct coverage: `auto`, `finalize`, `ship`, `fix-issue`, `fix-gap`, `refresh`, `import`, `init`, `backlog done`, `backlog promote`. Either parameterize with `it.each(BLOCKED_SUBS)(...)` so every entry in the hook's blocklist is exercised automatically, or add the missing direct `it(...)` cases. This matters because a future edit that silently narrows either `BLOCKED_SUBCOMMANDS` or `BLOCKED_TWO_WORD` will only be caught by the currently-exercised subset.
- `src/templates/hooks/metta-guard-bash.mjs:61` — `while (i < tokens.length && !['&&', ';', '||', '|'].includes(tokens[i])) i++;` still treats bare `|` as a chain terminator. `foo | metta propose` is scanned identically to `foo ; metta propose` — probably desired (block), but undocumented; document the intent in a comment or narrow the separator set.
- `src/templates/hooks/metta-guard-bash.mjs:46` — whitespace-only tokenization misses concatenated forms: `metta propose&&ls` remains a single token and evades detection. Document as a known limitation in the header or harden the splitter; low likelihood of real-world occurrence but easy to land in a future `spawnSync` invocation that omits separators.

### Suggestions (nice to have)

- `src/templates/hooks/metta-guard-bash.mjs:39-65` — `tokenize` is now doing scan+classify-prep, not pure tokenization. Rename to `scanMettaInvocations` and drop the `tokens = command.split(...)` local to match the naming.
- `src/templates/hooks/metta-guard-bash.mjs:79` — `main` is `async` but awaits nothing. Drop the `async`.
- `tests/metta-guard-bash.test.ts:15-37` and `tests/cli-metta-guard-bash-integration.test.ts` — shared `runHook` and `bashEvent` helpers duplicate across files. Extract to `tests/helpers/metta-guard-bash.ts`.
- `src/cli/commands/install.ts:378-396` — the parallel try/catch blocks for edit-guard, bash-guard, and statusline install each set a boolean and log a warning. If you extract the helper (Warning above), also collapse into a single `for` loop over `[{name, fn}]`.
- `src/templates/hooks/metta-guard-bash.mjs:12` — the comment `// intentional pass-through for human/CI-driven install (no matching skill yet)` on the `install` ALLOW entry is a reasonable call, but contradicts `spec.md:9` which includes `metta install` in the blocklist. Either reconcile the spec (drop `install` from the blocklist) or flip the hook to block. Current divergence is a low-risk inconsistency but should be tracked.

## Verdict

NEEDS_CHANGES

Must-fix before merge:

1. Prefix the three `metta refresh` invocation instructions in `src/templates/skills/metta-refresh/SKILL.md` (lines 7, 16, 17) with `METTA_SKILL=1`. Update the byte-identical mirror `.claude/skills/metta-refresh/SKILL.md`.

Critical count: 1. All other prior-review issues are either resolved (2 critical, 1 warning, 1 suggestion), partially addressed (1 warning), or still outstanding as non-blocking warnings/suggestions.
