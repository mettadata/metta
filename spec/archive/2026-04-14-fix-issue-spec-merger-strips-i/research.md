# Research: fix-issue-spec-merger-strips-i

Two surgical bugs. Both confirmed by reading the source. Decisions locked below.

---

## Decision 1: inlineCode handling in extractText

### Confirmed bug location

`src/specs/spec-parser.ts` lines 41-47:

```typescript
function extractText(node: Content): string {
  if (node.type === 'text') return (node as Text).value
  if ('children' in node) {
    return (node.children as Content[]).map(extractText).join('')
  }
  return ''
}
```

remark-parse emits `inlineCode` nodes with a `value` property and no `children`. The `'children'` branch never fires for them; the function falls through to `return ''`. Both `parseSpec` (line 139) and `parseDeltaSpec` (line 245) call `extractText` on paragraph nodes, and both call it on list-item children at lines 128 and 234. Every inline code span in a requirement body or scenario step is silently dropped at all four call sites.

`getHeadingText` (line 50) calls `extractText` on heading children — also affected, but headings containing inline code are less common than requirement bodies and step bullets.

### Options evaluated

**Option A — one-line branch for inlineCode**

Add before the `'children'` branch:

```typescript
if (node.type === 'inlineCode') return `\`${(node as InlineCode).value}\``
```

Import `InlineCode` from `mdast` (already a dev dep; `Text` is already imported at line 4).

Pros: minimal diff, no new dependency, exact match for the failure mode, readable intent.

Cons: does not cover `code` (fenced block), `strong`, `emphasis`, or `link` nodes. Acceptable because: (a) those types do not appear in any current spec under `spec/specs/`; (b) the intent.md explicitly limits scope to `inlineCode`; (c) silent `''` for other exotic nodes is the same behavior as before.

**Option B — mdast-util-to-markdown stringify fallback**

Add `mdast-util-to-markdown` and call `toMarkdown({ type: 'root', children: [node] })` for unrecognized node types.

Pros: handles any future node type automatically.

Cons: new runtime dependency, output format is controlled by the library's serializer (may add trailing newlines or extra whitespace), adds complexity to a 7-line function.

**Decision: Option A.** One import, one line. The scope is confirmed to be only `inlineCode`.

### Note on block-level `code` nodes

`code` nodes (fenced code blocks) carry `value` and no `children`. They would also return `''` under the current code. However, requirement bodies in this codebase use only inline code spans — fenced blocks do not appear inside `## Requirement:` sections in any spec under `spec/specs/`. The intent.md excludes `code` from scope. Leave it returning `''` for now; a follow-up can add the branch if fenced code appears in specs.

---

## Decision 2: applyDelta replacement strategy

### Confirmed bug location

`src/finalize/spec-merger.ts` lines 141-151 (MODIFIED branch inside `applyDelta`):

```typescript
} else if (delta.operation === 'MODIFIED') {
  const reqPattern = new RegExp(
    `## Requirement: ${delta.requirement.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=## Requirement:|$)`,
  )
  content = content.replace(reqPattern, '')
  content += `\n\n## Requirement: ${delta.requirement.name}\n\n...`
}
```

Failure mode confirmed: the regex is non-greedy and relies on end-of-string `$` to terminate the last section. In practice, a file ending with a trailing newline causes `$` to match the newline position, not the end of the requirement body, so the match terminates early and the old block remains. The unconditional `content +=` then appends the new block, producing old + new in the output. On the next delta in the loop the file is re-read with the duplication already present, and the next regex pass also fails for the same reason, compounding the problem.

The RENAMED branch (lines 152-168) uses the same regex pattern for removal and the same `content +=` append — same failure mode.

`applyDelta` operates on **raw text** (`state.readRaw` / `state.writeRaw`). It does not use `parseSpec` section boundaries at all. The spec-parser's structured output is used only after writing (line 178: `parseSpec(content)` to update the lock), not to drive the replacement.

### Options evaluated

**Option A — section-boundary split on raw text**

Split the raw string on `\n## Requirement:` to produce an array of sections. The first element is everything before the first `## Requirement:` heading (the title block). Each subsequent element is the heading name plus its body. Build a map keyed by requirement name. For MODIFIED: look up the key, replace the body, re-join in original order. For ADDED: append a new entry. If a MODIFIED key is not found: record a `MergeConflict` with `reason: 'requirement not found'` and return without writing.

Pros:
- Robust to trailing newlines, `\r\n`, and extra blank lines — no regex matching on body content.
- Idempotent: splitting and re-joining does not change structure on a second pass.
- Section order is preserved (re-join in original array order).
- Not-found MODIFIED becomes an explicit conflict rather than silent append — matches the new spec requirement at line 31 of `spec.md`.
- No new dependencies; plain string operations.

Cons:
- The split token `\n## Requirement:` assumes the heading is always at the start of a line with a preceding newline. This is true for all current specs (markdown convention) and is the same assumption the old regex made.
- Requires re-joining with `\n## Requirement:` prefix, so trailing-newline hygiene must be handled explicitly (trim each section body and add a consistent trailing newline on re-join).

**Option B — remark-based AST round-trip**

Parse the existing spec with `remark-parse`, mutate the AST to find and replace the matching heading + its following nodes, then serialize back to markdown with `remark-stringify`.

Pros: structurally correct, immune to whitespace quirks.

Cons: introduces `remark-stringify` (not currently in the dependency tree); serialized output may differ from the hand-authored spec source in ways that confuse diffs and git history; adds significant complexity for a two-file surgical fix.

**Decision: Option A.** The section-split is the pattern that mirrors how the existing `merge` method resolves delta conflicts (keyed by `delta.requirement.id`) and how `parseSpec` itself walks headings. No new dependency. The not-found conflict path satisfies the new spec requirement and closes the silent-corruption failure mode.

### applyDelta operates on raw text — not spec-parser output

Confirmed: `applyDelta` reads raw string via `state.readRaw` (line 133) and reconstructs sections by string concatenation. `parseSpec` is called only after writing to update the lock (line 178-179). The section-split approach stays in the same raw-text layer; no interface changes needed.

---

## Decision 3: test fixture placement

### Confirmed pattern

`tests/spec-parser.test.ts` and `tests/spec-merger.test.ts` both use inline template literal strings for all fixtures. There is no `tests/fixtures/` directory; the test file uses `writeFile` to write tmpdir files directly from inline strings (see spec-merger.test.ts lines 29-40, 50-62, etc.).

The spec requirement at `spec/changes/.../spec.md` line 70 explicitly mandates inline fixture strings: "Each test case MUST use inline fixture strings rather than external fixture files so the assertions are self-contained and readable without context."

**Decision: Inline strings in test files. No new fixture directory.** Add new `it(...)` blocks to the existing `describe` blocks in `tests/spec-parser.test.ts` and `tests/spec-merger.test.ts`, following the exact pattern already present.

---

## Decision 4: ADDED capability folder name

Out of scope per intent.md. Not addressed here.

---

## Exact change surface

| File | Change |
|------|--------|
| `src/specs/spec-parser.ts` | Add `InlineCode` to mdast import (line 4). Add one branch in `extractText` (after line 42). |
| `src/finalize/spec-merger.ts` | Replace MODIFIED and RENAMED branches in `applyDelta` (lines 141-168) with section-split logic. Add not-found conflict path. |
| `tests/spec-parser.test.ts` | Add `it` block: `extractText returns backtick-wrapped value for inlineCode nodes`. |
| `tests/spec-merger.test.ts` | Add `it` blocks: backtick round-trip, no-duplication on MODIFIED, idempotency, not-found conflict. |

No schema changes. No interface changes. No new dependencies.
