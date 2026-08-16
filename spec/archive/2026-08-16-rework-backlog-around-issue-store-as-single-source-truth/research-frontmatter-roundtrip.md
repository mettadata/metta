# Research: Frontmatter Parsing + Round-Trip Write Strategy

**Change:** rework-backlog-around-issue-store-as-single-source-truth
**Area:** how issue/milestone files gain optional YAML frontmatter with byte-preserving body round-trip
**Date:** 2026-08-16

## Decision

**Approach 1 — manual `---` delimiter split + the existing `yaml` v2 package + strict Zod schema, with one refinement: mutations go through `YAML.parseDocument()` / `doc.set()` / `doc.toString()` (the CST-preserving Document API), not parse-to-object-and-restringify.** No new dependencies.

This is the same pattern the codebase already uses for minimal-diff YAML edits in `src/config/config-writer.ts` (`YAML.parseDocument(raw)` → mutate → `doc.toString()`), and the plain-object read path matches `src/state/state-store.ts` / `src/config/config-loader.ts` (`YAML.parse` → Zod → `formatZodError`). The body is never parsed at all on the write path — it is carried as a verbatim string slice, which makes byte-for-byte preservation trivially true by construction rather than a property to test around a markdown serializer.

### Approaches Considered

1. **Manual delimiter split + `yaml` package + strict Zod** (recommended, with the Document-API refinement for writes)
2. **Add `gray-matter` as a dependency**
3. **remark/unified pipeline with `remark-frontmatter`**

### Rationale

Three requirements in `spec.md` drive the choice:

- *"the frontmatter MUST be parsed with the existing `yaml` dependency"* — the spec itself already names the parser. gray-matter would violate this outright (it embeds js-yaml 3.x, a second YAML engine alongside `yaml` ^2.7.1). remark-frontmatter only tokenizes the block — *"Doesn't parse the data inside them: create your own plugin to do that"*[^3] — so `yaml` is needed anyway and remark adds nothing but a heavier tokenizer.
- *"the markdown body … MUST be byte-preserved"* — any approach that round-trips the body through a markdown AST (remark-stringify) normalizes emphasis markers, list bullets, heading styles, and line wrapping; it cannot byte-preserve. gray-matter preserves the body string but normalizes the *frontmatter* on `stringify` (js-yaml `dump` re-serializes every key: reordered per its own rules, re-quoted, defaults materialized), which collides with the next requirement.
- *"MUST NOT rewrite the values of frontmatter fields it was not asked to change. The relative order of pre-existing frontmatter keys MUST be preserved; a newly added key MAY be appended"* — this is exactly the contract of `yaml`'s Document API: untouched scalar nodes keep their original quoting/representation, key order is preserved, `doc.set()` on a new key appends it. The library documents comment/blank-line round-tripping as its primary differentiator ("Supports parsing, modifying, and writing YAML comments and blank lines")[^2]. A parse-to-`Record` + `YAML.stringify` write would *usually* produce the same text for untouched keys but gives no guarantee (quoting style, key order under object spread, number formatting) — the Document API gives the guarantee structurally, and `config-writer.ts` is prior art in this repo.

Secondary factors:

- **gray-matter is effectively frozen.** Last publish is 4.0.3, roughly five years ago, with no recent repo activity; npm ecosystem trackers flag it as low-maintenance/possibly discontinued despite heavy download counts[^1]. Adding a frozen dep that duplicates an existing one contradicts the project's no-new-deps bias.
- **Strictness lives in Zod either way.** All three approaches end at the same `IssueFrontmatterSchema.strict()` — the schema layer is invariant, so the comparison is purely about tokenizing/serializing, where approach 1 is the smallest and the only one already idiomatic here.
- **Error rendering is already solved.** Zod 3's `invalid_enum_value` message ("Invalid enum value. Expected 'high' | 'medium' | 'low', received 'urgent'") plus the existing `src/util/format-zod-error.ts` `path: message` rendering satisfies the spec scenario (names the field, the received value, and the allowed values) with zero new code. `unrecognized_keys` ("Unrecognized key(s) in object: 'assignee'") satisfies the unknown-key scenario.

[^1]: https://security.snyk.io/package/npm/gray-matter accessed 2026-08-16 (latest 4.0.3, "last published 5 years ago", flagged as low maintainer attention)
[^2]: https://eemeli.org/yaml/ accessed 2026-08-16
[^3]: https://github.com/remarkjs/remark-frontmatter accessed 2026-08-16

### Pros/Cons per Approach

#### Approach 1 — delimiter split + `yaml` Document API + strict Zod (chosen)

**Pros**
- Zero new dependencies; uses the exact library the spec mandates.
- Body byte-preservation is structural: the body is a substring slice of the original file, never re-serialized.
- Untouched-field and key-order preservation come from `parseDocument`/`doc.set`, already proven in `src/config/config-writer.ts` — minimal `git diff` when flipping one flag (one added/changed line).
- Detection is a ~15-line pure function, ideal for the project's functional-core convention and 1:1 test ratio.
- Handles CRLF, missing trailing newline, and `---` in body correctly because only byte-offset-0 delimiters are ever considered frontmatter.

**Cons**
- We own the delimiter-detection edge cases (opening with no closing fence, empty block, non-map YAML) — mitigated by the edge-case table below and unit tests.
- `yaml`'s comment round-trip has a documented instability for *trailing* comments (comments can re-associate to a different node)[^2] — low risk here: metta-authored frontmatter never contains comments; hand-added comments on untouched lines survive; only a trailing comment adjacent to a mutated key could shift.

#### Approach 2 — `gray-matter`

**Pros**
- Battle-tested detection logic (~8M weekly downloads), handles excerpts/alt languages for free (unneeded here).
- Slightly less code for the read path.

**Cons**
- Violates the spec line that frontmatter "MUST be parsed with the existing `yaml` dependency" — gray-matter bundles js-yaml 3.x, a second, older YAML engine.
- `matter.stringify()` re-serializes the whole frontmatter via js-yaml `dump`: key order, quoting, and formatting of untouched fields are normalized → breaks the "MUST NOT rewrite untouched fields" requirement and produces noisy diffs; we would have to bypass its writer and hand-roll serialization anyway, keeping only the trivial part of the library.
- Also normalizes the body boundary (strips the newline between fence and body on parse, re-adds `\n` on stringify) — byte preservation would need workarounds.
- Frozen project: last publish ~5 years ago[^1]; adds `js-yaml`, `section-matter`, `strip-bom-string` to the tree.
- Has a content-keyed internal cache that has caused stale-read surprises in long-lived processes.

#### Approach 3 — remark-frontmatter (unified pipeline)

**Pros**
- remark-parse/unified are already dependencies; frontmatter becomes a first-class mdast node with source positions.
- Correctly ignores `---` thematic breaks mid-document by grammar rather than by our offset rule.

**Cons**
- Still requires the `yaml` package for the actual data ("Doesn't parse the data inside them")[^3] — so it adds a dependency (`remark-frontmatter`, plus `remark-stringify` and/or `vfile-matter` for writes) while removing none of the work.
- Writing through the pipeline (`remark-stringify`) normalizes the markdown body — a hard fail on byte preservation. Using it read-only (positions only) and splicing strings manually degenerates into approach 1 with a much heavier tokenizer.
- Highest complexity and slowest path (full markdown tokenization per issue file on every `list`).

### Proposed parse/serialize contract

New pure module `src/issues/issue-frontmatter.ts` (+ `issue-frontmatter.test.ts`), schema in `src/schemas/issue-frontmatter.ts` following the existing `.strict()` pattern (`src/schemas/agent-definition.ts`).

```ts
// src/schemas/issue-frontmatter.ts
export const IssueFrontmatterSchema = z.object({
  type: z.enum(['issue', 'idea']).default('issue'),
  backlog: z.boolean().default(false),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  milestone: z.string().regex(SLUG_PATTERN).optional(),   // reuse slug pattern from src/util/slug.ts
  order: z.number().optional(),
}).strict()
export type IssueFrontmatter = z.infer<typeof IssueFrontmatterSchema>
// Patch type for writes: raw field values, no defaults applied
export type IssueFrontmatterPatch = Partial<z.input<typeof IssueFrontmatterSchema>>
```

```ts
// src/issues/issue-frontmatter.ts
export class IssueFrontmatterError extends Error {
  constructor(public readonly filePath: string, message: string, public readonly cause?: unknown)
}

/**
 * Pure lexical split. Frontmatter exists iff the content starts with the
 * exact bytes `---\n` or `---\r\n` at offset 0. `body` is a verbatim
 * substring of `content` (byte-identical slice) — never re-serialized.
 */
export function splitFrontmatter(content: string): {
  rawFrontmatter: string | undefined  // YAML text between the fences, undefined if no block
  body: string                        // everything after the closing fence's newline, verbatim
  eol: '\n' | '\r\n'                  // EOL style of the opening fence line (or '\n' default)
}

/** Read path: split + YAML.parse + strict Zod. Returns undefined frontmatter for legacy files. */
export function parseIssueFrontmatter(content: string, filePath: string): {
  frontmatter: IssueFrontmatter | undefined  // defaults applied (type: 'issue', backlog: false)
  body: string
}

/**
 * Write path: returns the complete new file content.
 * - Existing block: YAML.parseDocument(rawFrontmatter); validate current fields
 *   (strict Zod on doc.toJS() ?? {}); doc.set(key, value) per defined patch key
 *   (undefined patch values are ignored, not deleted); re-fence with the file's
 *   eol; append the ORIGINAL body slice unchanged.
 * - No block: build fields in canonical order (type, backlog, priority,
 *   milestone, order — only keys present in the patch plus required semantics
 *   decided by the caller), stringify with YAML.stringify(fields, { lineWidth: 0 }),
 *   prepend `---${eol}...---${eol}` to the original content unchanged.
 * - Validates the resulting field set with IssueFrontmatterSchema.strict()
 *   BEFORE returning — no unvalidated state writes.
 * Callers implement idempotency by comparing the return value to the input
 * (`backlog add` no-op scenario).
 */
export function applyFrontmatterPatch(
  content: string,
  patch: IssueFrontmatterPatch,
  filePath: string,
): string
```

`IssuesStore.create()` grows optional frontmatter fields and prepends a block via the same canonical-order serializer; `archive()` already copies raw content, so frontmatter survives resolution with zero changes there. The milestone store reuses `splitFrontmatter` with its own `MilestoneFrontmatterSchema`.

Validation errors are thrown as `IssueFrontmatterError` wrapping the `ZodError`; the CLI edge renders via the existing `formatZodError` (`src/util/format-zod-error.ts`), which yields e.g. `priority: Invalid enum value. Expected 'high' | 'medium' | 'low', received 'urgent'` — satisfying the spec's field/received/allowed scenario without new formatting code.

#### Edge-case table

| Case | Behavior |
|------|----------|
| Legacy file (`# Title` first line, bold-label block) | `rawFrontmatter: undefined`; existing `parseIssue` path untouched; treated as `type: issue`, `backlog: false`; never rewritten on read |
| Valid block, LF file | YAML.parse → strict Zod; body = verbatim slice after closing `---\n` |
| CRLF file | Opening/closing fence match allows trailing `\r`; `eol: '\r\n'` reused when writing the block; body slice preserves all `\r\n` bytes |
| Body with no trailing newline | Preserved — body is a slice, writer appends it verbatim |
| `---` appearing mid-body (thematic break, second fence pair) | Ignored — only offset-0 fences are frontmatter; body slice is never scanned or rewritten |
| Empty block (`---\n---\n`) | Parses to `null` → coerced to `{}` → all defaults; `doc.set` on the empty document creates the map on first mutation |
| Opening fence, no closing fence | `IssueFrontmatterError` (fail loudly — a legacy issue file can never begin with `---`, so this is always a malformed frontmatter attempt, not legacy content) |
| Block is valid YAML but not a map (list/scalar) | `IssueFrontmatterError` naming the file: frontmatter must be a mapping |
| YAML syntax error inside block | `YAMLParseError` wrapped in `IssueFrontmatterError` with file path |
| Unknown key (`assignee: alice`) | Zod `unrecognized_keys` → "Unrecognized key(s) in object: 'assignee'" |
| `priority: urgent` | Zod `invalid_enum_value` naming field, received value, allowed values |
| Flip one flag on existing block | `doc.set('backlog', true)` → single-line diff; untouched keys keep value text, quoting, and relative order (`parseDocument` preserves untouched node representation)[^2] |
| Add key to existing block | Appended after existing keys (spec: "a newly added key MAY be appended") |
| New block on legacy file (`backlog add` on plain issue) | Canonical key order `type, backlog, priority, milestone, order` (omitting absent fields); block prepended, original content byte-identical below it |
| Hand-written comments in frontmatter | Preserved for untouched lines (Document API); known upstream caveat: trailing comments adjacent to a mutated node may re-associate[^2] — acceptable, metta never writes comments |
| BOM-prefixed file | Fence detection requires `---` at byte 0, so a BOM file takes the legacy path; harmless (no such files exist in `spec/issues/`), documented in the module |

### Complexity estimate

- `src/schemas/issue-frontmatter.ts` (+ milestone schema): ~40 lines, trivial — mirrors existing schema files.
- `src/issues/issue-frontmatter.ts`: ~120 lines (split ~25, parse ~25, patch ~60, error class ~10).
- Tests: ~200–250 lines covering the edge-case table (the bulk of the effort, as intended by the spec's byte-preservation scenarios).
- Store integration (issues-store, new milestone-store) consumes the module; no changes to `state-store`.
- **Overall: Small-Medium (S+).** No new dependencies, one new pure module + schema, prior art for every technique already in the repo (`config-writer.ts` for Document mutation, `config-loader.ts` for YAML+Zod+formatZodError reads).
