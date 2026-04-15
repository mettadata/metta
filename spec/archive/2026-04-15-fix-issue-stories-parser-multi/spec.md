# fix-issue-stories-parser-multi

## ADDED: Requirement: stories-parser-tolerates-compact-format

`parseStories` MUST correctly extract all 5 labeled fields (`asA`, `iWantTo`, `soThat`, `priority`, `independentTestCriteria`) from a story whose fields appear on consecutive lines within a single paragraph (no blank-line separators). The parser MUST split paragraph text on newlines and match each line independently against the field-prefix table. Single-line-per-paragraph format MUST continue to work unchanged.

### Scenario: compact stories.md parses all fields
- GIVEN a stories.md with `## US-1: title` followed by 5 consecutive lines (each starting with a labeled prefix, no blank lines between)
- WHEN `parseStories(path)` is called
- THEN all 5 fields are populated correctly and no `StoriesParseError` is thrown

### Scenario: spaced stories.md (existing format) still works
- GIVEN a stories.md with each labeled field on its own paragraph (blank lines between)
- WHEN `parseStories(path)` is called
- THEN behavior is unchanged from current baseline

### Scenario: mixed format works
- GIVEN a stories.md where US-1 uses compact format and US-2 uses spaced format
- WHEN `parseStories(path)` is called
- THEN both stories parse correctly with all fields populated
