# Research: File-Count Parsing from intent.md Impact Section

**Change:** adaptive-workflow-tier-selection-emit-complexity-score-after
**Date:** 2026-04-19
**Scope:** Advisory complexity scorer — v1 signal is distinct file/module reference count from `## Impact`

---

## Real-World Format Survey

Before evaluating approaches, nine archived `intent.md` files were read to understand how the Impact section actually looks in practice. Three distinct formats appeared:

**Format A — structured bullet list with inline-code paths** (most common, ~60% of sample):
```
- `src/gates/gate-registry.ts` — add `runWithPolicy(...)`
- `src/execution/execution-engine.ts` — line 355 change
- `tests/gate-registry.test.ts` — new tests
```
Examples: fix-gate-infrastructure-bundle, stack-detection, project-local-gate-overrides, fix-slug-truncation, bump-finalize-tests-gate-timeout.

**Format B — prose with embedded backtick references** (~30%):
```
The spec parser surface area grows by one optional field. Downstream consumers of parsed requirements
(`context-engine`, `execution-engine`) receive a `fulfills` array...
```
Examples: t5-user-story-layer, t4-research-model-tier-split, metta-fix-issues-cli-command.

**Format C — bare prose, no backtick file references** (~10%):
```
src/cli/commands/refresh.ts rewritten.
```
or entirely prose without any code spans at all.
Examples: build-metta-refresh-cli-slash (oldest entry, pre-convention era).

**Key observation:** The current active intent.md for this change uses Format A exclusively in its Impact section — seven bullet points each leading with a bold module name followed by a prose description. The backtick references within those bullets are module-level labels (`ArtifactStore`, `metta status`, `metta complete`, `/metta-quick`) rather than file paths. This is the dominant contemporary format.

The sample reveals that a file-path heuristic must distinguish between:
- `src/foo/bar.ts` — a file path (count it)
- `` `ArtifactStore` `` — a class name (do not count it, or accept the false positive)
- `` `complexity_score` `` — a field name (do not count it)
- `` `metta status` `` — a CLI command (do not count it)

This distinction is the central reliability challenge for all three approaches.

---

## Approach 1: remark unified AST Walk

**Mechanism:** Parse the full `intent.md` into an mdast AST using the already-installed `unified().use(remarkParse)`. Locate the `## Impact` heading node by walking `tree.children` and collect all subsequent nodes until the next `##` heading. Within that range, collect every `inlineCode` node whose `.value` matches a file-path heuristic (e.g., contains `/`, ends in a known extension such as `.ts`, `.yaml`, `.md`, `.js`, `.go`, `.py`, `.rs`, or starts with `src/` / `tests/` / `dist/`). Deduplicate by exact string value and return the count.

**Code complexity:** Roughly 50–70 lines in a new module (`src/complexity/intent-parser.ts`). The section-boundary walk and node collection pattern are already present verbatim in `spec-parser.ts` (the `parseSpec` function locates `## Requirement:` headings and processes subsequent nodes). The `InlineCode` type import is already in `src/specs/spec-parser.ts`. Test cost is low: the existing test infrastructure uses real markdown strings; three or four test fixtures covering Formats A, B, and C plus an empty Impact section are sufficient.

**Parse reliability:**
- Format A (structured bullet list): high. Bullet list items produce `listItem > paragraph > inlineCode` nodes in mdast. The file-path discriminator (has `/`, ends in `.ts` etc.) correctly captures `src/gates/gate-registry.ts` and rejects `` `ArtifactStore` ``, `` `complexity_score` ``, and `` `metta status` ``.
- Format B (prose with embedded refs): moderate. Class names like `` `context-engine` `` and `` `execution-engine` `` contain a `/`-free hyphenated identifier. The extension filter rejects them cleanly. However, `` `fulfills` `` and `` `runWithPolicy` `` are also correctly rejected. The risk is a glob-style path like `` `src/templates/gate-scaffolds/rust/*.yaml` `` — the `*` character does not break the AST but the discriminator must not require a `.ts` match. A broad "contains slash" rule counts this correctly.
- Format C (bare prose, no backtick refs): returns 0, which maps to `trivial`. This is the correct graceful-degradation behavior for an advisory-only score.
- Ambiguous case — the current active intent uses `` `ArtifactStore` `` and `` `/metta-quick` `` as module labels. `` `/metta-quick` `` starts with `/` and could look like a path. The extension filter rejects it (no `.ts`/`.yaml`/etc.), but a broad `contains /` filter would false-positive it. The discriminator must be extension-anchored or prefix-anchored (`src/`, `tests/`, `dist/`, `.metta/`).

**Failure modes:**
- Missing `## Impact` heading: returns 0, scores as trivial. Acceptable for advisory.
- Malformed markdown (unclosed backtick): remark-parse is tolerant; unclosed backticks degrade to text nodes, which are ignored by the `inlineCode` collector.
- Extension set gaps (e.g., a `.sh` or `.json` file reference): missed count, lowering the score. Acceptable — the extension set is easy to extend.
- False positives from CLI paths like `` `/metta-quick` ``: prevented by extension or prefix filter.

**Fit with existing conventions:** Excellent. `unified().use(remarkParse)` is already a project dependency (`remark-parse: ^11.0.0`, `unified: ^11.0.5`). `src/specs/spec-parser.ts` and `src/specs/stories-parser.ts` both import `unified`, `remarkParse`, and the same `mdast` types. A new module in `src/complexity/` follows the established pattern with zero new dependencies. This is the idiom the project already uses for all markdown parsing.

---

## Approach 2: Regex Heuristic

**Mechanism:** Extract the text of the `## Impact` section by splitting the raw markdown string on heading boundaries (e.g., split on `\n## ` and find the Impact slice). Apply a regex like:

```
/`([^`]+(?:\/[^`]+)+\.[a-z]{1,5})`/g
```

or more broadly:

```
/`([^`\s]+\/[^`\s]+)`/g
```

Collect all matches, deduplicate, and count.

**Code complexity:** 15–25 lines. The section extraction is a string split plus array index lookup. The regex is one line. Deduplication is a `Set`. Test cost is comparable to Approach 1 — the same fixture set is needed to validate the heuristic.

**Parse reliability:**
- Format A: high for simple cases. The regex captures `` `src/gates/gate-registry.ts` `` correctly.
- Format B: same moderate accuracy as Approach 1. The discriminator quality depends entirely on the regex design.
- Multi-file references in a single backtick span (e.g., `` `src/foo.ts` and `src/bar.ts` `` written inside a single code span — rare but syntactically legal in raw markdown): the section-level regex cannot distinguish whether the markdown rendered one code span or two. The remark AST does not have this ambiguity because the parser splits them structurally.
- Backtick spans containing newlines: the raw markdown section split may misidentify a fenced code block boundary or a block quote as a heading boundary if the regex is not anchored. A regex-based section extractor is more brittle than an AST walk for edge cases like this.
- The critical failure mode unique to regex: it operates on raw bytes before parsing. A heading written as `### Impact` (depth 3) or with a trailing space `## Impact ` will be missed by a naive `\n## Impact\n` split. In the surveyed files, `## Impact` is always at depth 2 with no trailing content, but that is a convention maintained by AI agents, not enforced by any schema.

**Failure modes:**
- Section boundary misidentification due to heading depth variance or trailing whitespace: silent wrong slice. Remark handles this correctly.
- Regex too broad (e.g., `/`.+\/[^`]+`/g`): captures `` `metta complete/implementation` `` or pseudo-paths in prose.
- Regex too narrow (extension whitelist): same gap coverage issue as Approach 1, but harder to debug because failures surface as a wrong integer rather than a missing node type.
- No structural validation: the regex cannot tell the difference between a backtick reference in a list item (likely a file path) and one in a paragraph note (more likely a concept name).

**Fit with existing conventions:** Poor. The project uses remark for all markdown parsing; a regex-on-raw-string approach is an inconsistent pattern. `src/specs/spec-parser.ts`, `src/specs/stories-parser.ts`, and any future markdown reader all parse via the AST. Introducing raw string regex parsing for one module creates two inconsistent paradigms in the same codebase.

---

## Approach 3: Structured Convention (Bullet Format Requirement)

**Mechanism:** Require that the Impact section list all affected files as structured bullet items in a specific format:

```
- `path/to/file.ext` — description
```

The parser, implemented with remark, locates the `## Impact` heading, walks the following list nodes, extracts the first `inlineCode` node in each list item, applies an existence check (the code span must be the first child of the item paragraph), and counts distinct values that match a file-path shape.

**Code complexity:** 60–80 lines — more than Approach 1 because the structured parser must validate bullet format and decide how to handle items that do not match the expected shape (skip, warn, or fail). Tests must cover both compliant and non-compliant bullet formats.

**Parse reliability:**
- Format A: near-perfect when bullets follow the convention, because the parser only processes list items and ignores prose. The leading inline-code-is-a-file-path assumption is strongly supported by actual observed usage (stack-detection, gate-overrides, fix-slug, bump-timeout).
- Format B (prose-only Impact section): returns 0. The parser finds no list at all and gracefully returns an empty set. Score is `trivial`. This is the correct advisory behavior — the author chose not to list files explicitly.
- Format C: same as Format B.
- The active change's Impact section: the bullet items use bold module labels (`**ArtifactStore` / change-metadata Zod schema**`) rather than bare inline-code paths. The first token in each item is a bold span, not an inline-code node. This parser would return 0 for the current intent.md, scoring the change `trivial` — which is incorrect (7 modules are listed). This is a hard reliability failure for the change this scorer is being built for.

**Failure modes:**
- Prose-format Impact sections (the 30–40% minority in the sample): systematically undercounts, producing `trivial` regardless of actual scope. An advisory tool that systematically underestimates on 30% of intents provides misleading guidance.
- Convention drift: the moment an author writes `**src/foo.ts**` (bold) instead of `` `src/foo.ts` `` (inline code), the count drops by one. There is no gate enforcing the bullet format. The scorer's accuracy is entirely contingent on authoring convention adherence, which is not enforceable at intent-authoring time.
- Spec enforcement cost: if a future gate validates the convention, that gate itself requires a parser — returning to Approach 1 complexity.

**Fit with existing conventions:** Neutral. The remark walk is consistent with existing patterns. However, the convention requirement imposes a new structural obligation on intent authoring that does not currently exist and is not validated by any schema or gate. Adding an opinionated structural constraint to `intent.md` just to make a v1 advisory scorer work is a poor tradeoff.

---

## Tradeoff Table

| Criterion | Approach 1 (remark AST) | Approach 2 (regex) | Approach 3 (structured convention) |
|---|---|---|---|
| Lines of code | ~60 | ~20 | ~75 |
| New dependencies | 0 | 0 | 0 |
| Convention consistency | Excellent (matches all existing markdown parsing) | Poor (breaks established pattern) | Neutral |
| Format A reliability | High | High | High (only if leading token is inline-code) |
| Format B reliability | Moderate (extension filter) | Moderate (same discriminator problem) | Low (returns 0 systematically) |
| Format C reliability | Graceful zero | Graceful zero | Graceful zero |
| Active change accuracy | Correct (rejects `` `/metta-quick` `` via extension filter, counts 0 file paths — but the active intent uses bold labels, so both Approach 1 and 3 return 0 for that specific intent; only the discriminator matters for Format A intents) | Same as 1 | Returns 0 (misses 7 entries — hard failure) |
| Section boundary robustness | High (AST handles depth/whitespace) | Moderate (string split is brittle) | High (AST) |
| Test cost | Low (3–4 fixtures) | Low (same) | Moderate (must test compliant + non-compliant bullets) |
| Failure mode severity | Silent undercount on ambiguous paths (advisory only) | Silent undercount + brittle section boundary | Silent systematic zero on prose-format intents |
| Extensibility (future signals) | High (walk can be extended for any node type) | Low (each new signal requires new regex) | Low (locked to bullet convention) |

---

## Recommendation

**Approach 1 — remark unified AST walk.**

**Justification:** It is the only approach that uses the project's established markdown parsing idiom (zero new dependencies, same import chain as `spec-parser.ts` and `stories-parser.ts`), handles all three real-world Impact section formats without systematic failure, and produces the correct graceful-degradation behavior (return 0) for any unrecognized format rather than silent wrong counts or hard misses on the current active intent.

**Implementation notes for the implementer:**

The file-path discriminator must be extension-anchored rather than slash-anchored to avoid false-positive counts for `` `/metta-quick` `` and other CLI command references that contain `/`. A pragmatic extension set covering the project's own conventions: `.ts`, `.js`, `.yaml`, `.yml`, `.md`, `.go`, `.py`, `.rs`, `.sh`, `.json`, `.toml`. Prefix anchoring (`src/`, `tests/`, `dist/`, `.metta/`) is a viable alternative that does not require maintaining an extension list.

The scorer should also collect inline-code nodes from list items as the primary target (most reliable for Format A) and fall back to collecting inline-code nodes from paragraphs for prose-format sections. Both are collected via the same AST walk — no branching is required. Deduplication by exact string value removes redundant references (e.g., a path mentioned in both bullet and closing prose).

For the active change's `intent.md` specifically: the Impact section uses bold module labels rather than inline-code file paths, so the scorer will return 0 and produce a `trivial` score for this change's own self-description. This is acceptable — the score is advisory-only and the change's own complexity scoring behavior is being introduced, not validated, by this intent.
