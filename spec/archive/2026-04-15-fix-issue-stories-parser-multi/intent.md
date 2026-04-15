# fix-issue-stories-parser-multi

## Problem
`stories-parser.ts` walks remark AST paragraphs and matches `paraText.startsWith('**As a**')` etc. When a user writes a stories.md with field-labeled lines on CONSECUTIVE lines (no blank separators), remark groups them into ONE paragraph. The parser then sees the paragraph as starting with `**As a**` (the first label), assigns the entire concatenated text to `asA`, and reports the other fields as missing.

Discovered while shipping T5: my hand-written stories.md used the natural compact format (one field per line, no blank between). Parser failed `iWantTo` field as "missing" even though it was clearly present.

## Proposal
Inside the paragraph-matching loop in `parseStories`, split the extracted paragraph text on newlines and match each line independently against `FIELD_PREFIXES`. Each line that matches a prefix sets that field. Lines that don't match are ignored (already the behavior).

This is purely additive — single-line-per-paragraph (separated-by-blank-lines) format still works exactly as before.

## Impact
- Stories.md with compact-format (no blank lines between fields) parses correctly.
- Existing fixtures and shipped stories.md files unchanged in behavior.
- Parser stays format-tolerant: both styles work.

## Out of Scope
- Changing the artifact template format.
- Updating already-shipped stories.md files.
- Hardening other parsers (spec, constitution) for the same edge case.
