# Fix Issue Spec Merger Strips Inline Code (Delta)

## Requirement: spec-parser-preserves-inline-code

`extractText()` MUST handle the `inlineCode` mdast node type and reconstruct the original `` `value` `` form by wrapping `node.value` in backtick characters. `extractText()` MUST NOT return an empty string for any `inlineCode` node. All callers of `extractText` — including the paragraph-text extraction path in `parseSpec` and the list-item step extraction path in `parseDeltaSpec` — MUST receive a faithful round-trip of the source markdown for inline code spans so that the reconstructed `requirement.text` and scenario `step` strings contain backtick-delimited code exactly as written in the source file.

### Scenario: Requirement body with inline code round-trips through extractText

- GIVEN a spec file whose requirement body contains the sentence `The user MUST run \`metta install\` before \`metta init\``
- WHEN `parseSpec` is called on that file
- THEN the returned `ParsedRequirement.text` contains the substring `` `metta install` `` verbatim
- AND the returned `ParsedRequirement.text` contains the substring `` `metta init` `` verbatim
- AND neither inline code span is replaced by an empty string or omitted

### Scenario: Scenario step with inline code round-trips through extractText

- GIVEN a delta spec file whose scenario step bullet reads `WHEN the user runs \`metta init --json\``
- WHEN `parseDeltaSpec` is called on that file
- THEN the returned scenario step string equals `WHEN the user runs \`metta init --json\``
- AND the backtick-delimited token `--json` is present in the step text

### Scenario: inlineCode node at the start of a paragraph

- GIVEN a spec file whose requirement body begins with `` `SpecMerger` MUST validate the lock hash ``
- WHEN `parseSpec` is called on that file
- THEN the returned `ParsedRequirement.text` starts with `` `SpecMerger` ``
- AND the reconstructed text does not begin with a space or empty token

## Requirement: spec-merger-applies-delta-idempotent

`applyDelta()` MUST replace a `MODIFIED` requirement section in place using a section-boundary split strategy rather than a regex-removal-plus-append pattern. The old section content MUST NOT remain in the output file after a `MODIFIED` merge. The replacement requirement MUST appear exactly once in the merged output regardless of how many times `applyDelta()` is called with the same input. ADDED requirements MUST appear exactly once in the merged output even when the capability spec already contains one or more requirements. When a `MODIFIED` delta targets a requirement name that does not match any `## Requirement:` heading in the existing spec, `applyDelta()` MUST record a `MergeConflict` with `reason` set to `"requirement not found"` and MUST NOT append the replacement text to the file.

### Scenario: MODIFIED delta replaces old body without duplication

- GIVEN a capability spec with exactly 3 `## Requirement:` sections named A, B, and C
- AND a delta that marks requirement B as MODIFIED with new body text
- WHEN `applyDelta()` is called once
- THEN the merged output contains exactly 3 `## Requirement:` headings
- AND the body text for requirement B is the new body text only
- AND the old body text for requirement B is absent from the output

### Scenario: Merge is idempotent across two runs

- GIVEN a capability spec with 2 `## Requirement:` sections
- AND a delta that marks one requirement as MODIFIED
- WHEN `applyDelta()` is called a first time producing output file F1
- AND `applyDelta()` is called a second time on F1 with the identical delta
- THEN the content of the output after the second call equals the content after the first call
- AND the number of `## Requirement:` headings has not increased

### Scenario: ADDED requirement appears exactly once in existing spec

- GIVEN a capability spec with 1 `## Requirement:` section
- AND a delta that adds a new requirement named "New-Req"
- WHEN `applyDelta()` is called
- THEN the merged output contains exactly 2 `## Requirement:` headings
- AND the heading `## Requirement: New-Req` appears exactly once

### Scenario: MODIFIED delta targeting missing requirement returns conflict

- GIVEN a capability spec that contains requirement "Existing-Req" only
- AND a delta that marks requirement "Ghost-Req" as MODIFIED
- WHEN `applyDelta()` is called
- THEN `result.status` equals "conflict"
- AND `result.conflicts` contains an entry whose `reason` is "requirement not found"
- AND the capability spec file on disk is unchanged

## Requirement: regression-tests

The file `tests/spec-merger.test.ts` MUST gain test cases that assert: inline code backticks survive a full merge round-trip; the merged output contains no duplicate `## Requirement:` headings after a MODIFIED delta; and a merge run twice produces byte-identical output. The file `tests/spec-parser.test.ts` MUST gain test cases that assert `extractText` returns the `` `value` `` form for `inlineCode` nodes and does not return an empty string. Each test case MUST use inline fixture strings rather than external fixture files so the assertions are self-contained and readable without context.

### Scenario: Backtick round-trip test in spec-merger.test.ts

- GIVEN an inline capability spec fixture whose requirement body contains `` `metta install` ``
- AND an inline delta fixture that modifies that requirement with body text also containing `` `metta install` ``
- WHEN the merger applies the delta
- THEN the output string contains `` `metta install` `` verbatim
- AND the output string does not contain an orphan fragment such as `WHEN the user runs` without the following backtick-delimited token

### Scenario: No-duplicate-requirements test in spec-merger.test.ts

- GIVEN an inline capability spec fixture with 3 `## Requirement:` sections
- AND a delta fixture that modifies all 3 requirements
- WHEN the merger applies the delta
- THEN the number of `## Requirement:` substrings in the output equals 3

### Scenario: Idempotency test in spec-merger.test.ts

- GIVEN an inline capability spec fixture with 2 `## Requirement:` sections
- AND a delta fixture that modifies 1 requirement
- WHEN the merger applies the delta once to get output O1, then applies the same delta to O1 to get output O2
- THEN O1 equals O2

### Scenario: extractText inlineCode test in spec-parser.test.ts

- GIVEN an mdast `inlineCode` node with `value` equal to `metta init`
- WHEN `extractText` is called on that node
- THEN the return value equals `` `metta init` ``
- AND the return value does not equal an empty string
