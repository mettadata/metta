VERDICT: PASS_WITH_WARNINGS

# Correctness Review: uat-document-generation-at-finalize-every-finalized-change

Scope: commits `8003a0d04..9a2abfc37` (diff `2fc869140..HEAD -- src tests`), reviewed against
`spec.md` (9 ADDED requirements), `design.md` (authoritative per tasks.md), and `tasks.md`.
All claims below were verified by reading the code, running targeted regex probes under node,
and running the five touched test files (69/69 pass) plus `npx tsc --noEmit` (clean).

## Summary

The implementation is faithful to the design and satisfies every spec scenario I could trace.
No critical or major correctness defects found. Three minor issues (a silently dropped warning,
a fragile ENOENT detection, and an inaccurate warning message) and three informational notes.

## Verified-correct highlights (checked, not assumed)

- **Six FinalizeResult return literals** — all six paths updated: incomplete artifacts
  (`src/finalize/finalizer.ts:86`), dry-run-merge conflict (:104), gate failure (:129),
  caller dry-run (:145), applying-merge conflict (:161) all carry `uatPath: null`; success
  (:248-249) carries the derived `uatPath` plus conditional `uatError` spread. Compiler-enforced
  (`tsc --noEmit` clean).
- **Step 5b placement** — after the real merge write and its conflict return (:150-163),
  before `archive()` (:196). All failure/dry-run exits are structurally upstream, so "No Stray
  UAT On Failed Finalize Paths" holds by construction; pinned by tests
  (`tests/finalizer.test.ts:500-591`).
- **Path handling** — `uatPath` derived from `archive()`'s returned name via `join()`
  (`finalizer.ts:196-197`), never a pre-computed `<date>-<name>`; no string concatenation
  anywhere in the new path logic. `changeDir` is `join(this.specDir, 'changes', changeName)`,
  consistent with the rest of the class.
- **US-id word boundary** — `new RegExp('\\b' + storyId + '\\b')`
  (`src/finalize/uat-generator.ts:156`): verified under node that `\bUS-1\b` does NOT match
  inside `"US-12 verified by tests"` (digit-digit is not a boundary) and does match `"US-1:"`.
  Story ids are parser-guaranteed `US-\d+`, so the unescaped interpolation is safe (hyphen is
  literal outside a character class). Test at `tests/uat-generator.test.ts:388` pins this.
- **15-char floor** — applied to the *normalized* scenario name and requirement name
  independently (`uat-generator.ts:143,147`), matching design clause 1+2; clause 3
  (US-id + verification-context line) applied only to AC-derived steps (:294), clauses 1+2 only
  to scenario-derived steps (:327,:362) — consistent with the design ("deriving requirement"
  exists only for scenario steps). `gatesOk = gates.length > 0 && gatesPassed` (:457) correctly
  refuses vacuous zero-gate passes as evidence.
- **Command extraction** — `COMMAND_FILTER_RE` (`uat-generator.ts:69`) verified under node:
  accepts `metta finalize --json`, `npm run build`; rejects `UAT.md` (single token) and
  `uat.enabled: false` (colon breaks the first-token class). Max-2 slice and first-match
  dedupe (:76) match design. ITC fallback hint attaches only to a story's first step and only
  when no AC in the story yielded a command (:298-306); `steps[0]` access is safe because
  `flushStory` (`src/specs/stories-parser.ts:92-98`) rejects zero-AC stories, so kind
  `'stories'` guarantees ≥1 AC per story.
- **Dedupe normalization** — scenario `norm(split.doText + ' ' + split.observe)` compared
  against AC `norm(ac.when + ' ' + ac.then)` (:296,:335-336); both sides computed from
  *un-hinted* text (hints applied only to the rendered `doText`), same-story only,
  exact-normalized only. Matches design; pinned by `tests/uat-generator.test.ts:232`.
- **Tier ladder edge cases** — sentinel stories → tier 2 silently (kind check :490); stories
  ENOENT → silent demote; malformed stories → warn + demote; tier-2 acceptance is content-based
  (`liveScenarioCount > 0`, :472-474) because `parseDeltaSpec` provably never throws (pure
  mdast traversal, `src/specs/spec-parser.ts:179-289`), so garbage spec.md demotes on content
  (pinned at `tests/uat-generator.test.ts:281`); spec.md ENOENT vs other read errors
  distinguished by `code !== 'ENOENT'` (:467); floor script guarantees never-skip.
- **Per-story step numbering** — `Step ${groupIndex+1}.${stepIndex+1}` (:418), per-group,
  folded delta steps continue the story's K sequence, dangling scenarios form a trailing
  group numbered after the stories. Pinned at `tests/uat-generator.test.ts:125,215,229`.
- **Determinism** — the generator never reads the clock (`generatedAt` injected, verified: no
  `Date` usage in `uat-generator.ts`); no locale-dependent APIs; all iteration is over parser
  arrays in document order; `TemplateEngine.substitute` uses a function callback
  (`src/templates/template-engine.ts:40-42`), so `$&`-style patterns and stray `{word}` tokens
  in assembled body text are inserted literally and never re-scanned. `new Date()` appears
  only in the finalizer (caller side), as the spec permits. Byte-identical test at
  `tests/uat-generator.test.ts:459`.
- **Degradation catch** — `uatError` is assigned *before* the best-effort cleanup
  (`finalizer.ts:187-191`); the cleanup `rm(..., { force: true }).catch(() => {})` cannot throw
  or mask the original error; `uatGenerated` stays false so `uatPath` is null; archive, gate
  recording, docs, and the success return all proceed. Exit stays 0 (CLI test
  `tests/cli-finalize.test.ts:200-218`).
- **Config toggle** — `UatConfigSchema` strict with `enabled: z.boolean().default(true)`,
  registered as `uat: UatConfigSchema.default({})` on the already-`.strict()`
  `ProjectConfigSchema` (`src/schemas/project-config.ts:41-46,104`). Omitted key → enabled;
  unknown key and non-boolean rejected (config-loader tests pass).
- **CLI output** — success JSON gains `uatPath` (always) + conditional `uatWarning`
  (`src/cli/commands/finalize.ts:146-147`); the five error shapes and exit codes are untouched
  (verified by reading the full command body; key-set equality pinned at
  `tests/cli-finalize.test.ts:234`); human mode prints the UAT line only when `uatPath` is
  non-null and the yellow warning on stderr only when degraded (:172-173).

## Issues Found

### Critical (must fix)

None.

### Warnings (should fix)

- `src/finalize/uat-generator.ts:463-470, 490-499` — **Non-ENOENT spec.md read error is
  silently dropped when tier 1 is selected.** `specReadError` is only surfaced on the tier-3
  branch (:498-499). If `stories.md` parses (tier 1) but `spec.md` exists and fails to read
  (e.g. EACCES), delta folding is silently skipped with no entry in `### Generation notes` and
  no `warnings[]` entry — violating the design's warn-and-demote discipline ("read error →
  +warning", design.md Tier fallback tree) and quietly thinning the archived script.
  *Fix:* push `specReadError` into `warnings` unconditionally (immediately after the read),
  not only on the tier-3 path.

- `src/finalize/uat-generator.ts:481-485` — **ENOENT detection by message substring is
  fragile.** `err instanceof StoriesParseError && err.message.includes('not found')` relies on
  the exact wording `stories.md not found at <path>` (`src/specs/stories-parser.ts:142`). Any
  future StoriesParseError whose message happens to contain "not found" (e.g. a Zod schema
  message surfaced via `Stories document failed schema validation: ...`) would demote
  *silently* instead of with a warning. *Fix:* match the specific prefix
  (`err.message.startsWith('stories.md not found')`) or, better, add a `code`/flag to
  `StoriesParseError` for the ENOENT case. (Note: fixing the parser itself is out of scope —
  the spec forbids modifying `parseStories` behavior — but a prefix match is local to the
  generator.)

- `src/finalize/uat-generator.ts:484` — **Inaccurate demotion warning text.** The malformed-
  stories warning always says "falling back to spec scenarios", but when spec.md has no
  scenarios the run actually lands on tier 3 or floor — the archived floor document then
  carries a Generation note pointing at a fallback that did not happen (observable in the
  passing test `tests/uat-generator.test.ts:444-452`, where the floor doc contains both this
  message and the floor message). *Fix:* drop the destination clause ("; falling back to spec
  scenarios") or word it as "demoting to the next available tier".

### Suggestions (nice to have)

- `src/finalize/finalizer.ts:170-187` — The Step 5b catch also swallows `ConfigLoader.load()`
  failures, so an invalid `.metta/config.yaml` (including a bad `uat` block) surfaces as
  `Warning: UAT generation failed: <zod message>` on an otherwise-successful finalize. The
  spec's "Invalid uat config is rejected strictly" scenario is still satisfied at the schema
  level (rejection happens, is not coerced, and is visibly reported — not silently ignored),
  and Step 7 already had identical silent-swallow semantics for the same load, so this is
  consistent — but the "UAT generation failed" label is slightly misleading for what is a
  config problem. Consider distinguishing the config-load failure in the message.
- `src/finalize/uat-generator.ts:69` — `COMMAND_FILTER_RE` false-accepts multi-word prose in
  backticks (verified: `` `the file exists` `` passes the filter and would render as a `Run:`
  hint). This is the exact regex pinned by design.md (accepted risk, ADR-3/§norm helpers), so
  it is not a defect — recording it here so the accepted risk is on the review record.
- `src/finalize/finalizer.ts:179,196` — `generatedAt` (Step 5b) and `archive()`'s date stamp
  are computed at two different instants; a midnight (UTC) rollover between them can make the
  document's `Generated:` date differ by one day from the archive directory prefix. Path
  correctness is unaffected (path derives from `archive()`'s return, per ADR-1); cosmetic only.

## Spec scenario traceability (all 9 requirements)

| Requirement | Verdict | Evidence |
|---|---|---|
| UAT Script Generation At Finalize | satisfied | Step 5b placement `finalizer.ts:165-193`; sweep via `archive()` move; `uatPath` field; determinism + no-AI verified in generator source and tests |
| No Stray UAT On Failed Finalize Paths | satisfied | all five exits upstream of Step 5b; dry-run returns at :136 before 5b; `tests/finalizer.test.ts:500-591` |
| UAT Source Material Assembly | satisfied | `parseStories`/`parseDeltaSpec` consumed read-only; in-memory gate results per design ADR-5 (gates.yaml does not exist at Step 5b — deliberate, do not "fix"); best-effort annotation absent without error |
| UAT Document Format | satisfied | template header (change name, date, metta-issue instructions); `### US-N` groups, `#### Step N.K`, Setup/Do/Observe, `- [ ] Pass` per step |
| UAT Tier Fallback Chain | satisfied | 4-rung ladder incl. floor; never skips when enabled; sentinel/garbage/ENOENT cases all pinned by tests |
| UAT Configuration Toggle | satisfied | strict schema, defaults, disabled-skip (`finalizer.ts:174`), omitted-key valid |
| UAT Path In Finalize Output | satisfied | JSON `uatPath` always present on success shape, `uatWarning` only on degradation, error shapes byte-identical (key-set test) |
| UAT Template Externality | satisfied | external `src/templates/artifacts/uat.md`, TemplateEngine render, contract test greps `src/**/*.ts` for the sentinel, copy-templates untouched |
| UAT Generation Failure Degradation | satisfied | warn-and-continue catch, cleanup cannot mask the error, exit 0, no error-shape leakage |

One wording tension noted and accepted: the spec scenario "Stories and spec scenarios feed the
generated steps" says what-to-do text "derives from Independent Test Criteria"; the
implementation (per design ADR-3, adopted from research) derives step Do-text from AC WHEN
clauses with the ITC as group preamble and as the CLI-invocation hint source. design.md is the
authoritative resolution of this wording, so it is not counted as a defect.

## Verdict

PASS_WITH_WARNINGS — no must-fix defects; the three warnings are small, localized generator
improvements (dropped warning on tier-1 spec read error, fragile ENOENT string match,
inaccurate demotion message) that do not affect any spec scenario outcome.
