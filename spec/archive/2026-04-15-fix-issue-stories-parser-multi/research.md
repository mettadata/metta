# Research: fix-issue-stories-parser-multi

Surgical fix. Decisions locked in intent.

## Confirmed
- `src/specs/stories-parser.ts:225-232` — paragraph match loop:
  ```
  if (node.type === 'paragraph') {
    const paraText = extractText(node).trim()
    for (const { prefix, key } of FIELD_PREFIXES) {
      if (paraText.startsWith(prefix)) { ... break }
    }
  }
  ```
- `extractText` returns concatenated paragraph content with newlines preserved between text nodes.
- Fix: split `paraText` on `\n`, match each trimmed line independently, allow multiple field assignments per paragraph.
