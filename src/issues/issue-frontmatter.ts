import YAML from 'yaml'
import { IssueFrontmatterSchema } from '../schemas/issue-frontmatter.js'
import type { IssueFrontmatter, IssueFrontmatterPatch } from '../schemas/issue-frontmatter.js'
import { formatZodError } from '../util/format-zod-error.js'

/**
 * Pure frontmatter round-trip for issue files (`spec/issues/**`).
 *
 * The markdown body is carried as a verbatim substring slice of the original
 * content and is never re-serialized, so byte preservation of the body is
 * structural — true by construction. Frontmatter mutations go through the
 * `yaml` Document API (`parseDocument` / `doc.set` / `doc.toString`), the
 * same minimal-diff pattern as `src/config/config-writer.ts`: untouched keys
 * keep their value text, quoting, and relative order; new keys append.
 *
 * Known upstream caveat: the `yaml` package's comment round-trip can
 * re-associate a *trailing* comment adjacent to a mutated node. metta never
 * writes frontmatter comments, and hand-added comments on untouched lines
 * survive, so this is accepted as-is rather than worked around.
 *
 * BOM-prefixed files do not start with `---` at byte 0 and therefore take
 * the legacy (frontmatter-less) path — harmless, no such files exist under
 * `spec/issues/`.
 */

/** Canonical key order for newly minted frontmatter blocks. */
const CANONICAL_KEYS = ['type', 'backlog', 'priority', 'milestone', 'order'] as const

export class IssueFrontmatterError extends Error {
  constructor(
    public readonly filePath: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'IssueFrontmatterError'
  }
}

export interface SplitFrontmatterResult {
  /** YAML text between the fences; `undefined` when the file has no block. */
  rawFrontmatter: string | undefined
  /** Everything after the closing fence's newline — a verbatim slice of `content`. */
  body: string
  /** EOL style of the opening fence line (or `'\n'` when there is no block). */
  eol: '\n' | '\r\n'
}

/**
 * Locate the closing `---` fence: a line consisting of exactly `---`
 * (optionally with a trailing `\r`), scanning line starts from `from`.
 * Returns the fence's start offset and the offset where the body begins.
 */
function findClosingFence(content: string, from: number): { fenceStart: number; bodyStart: number } | undefined {
  let pos = from
  while (pos <= content.length) {
    if (content.startsWith('---', pos)) {
      const after = pos + 3
      if (after === content.length) return { fenceStart: pos, bodyStart: content.length }
      if (content[after] === '\n') return { fenceStart: pos, bodyStart: after + 1 }
      if (content[after] === '\r') {
        if (content[after + 1] === '\n') return { fenceStart: pos, bodyStart: after + 2 }
        if (after + 1 === content.length) return { fenceStart: pos, bodyStart: content.length }
      }
    }
    const nextNewline = content.indexOf('\n', pos)
    if (nextNewline === -1) return undefined
    pos = nextNewline + 1
  }
  return undefined
}

/**
 * Pure lexical split. Frontmatter exists iff the content starts with the
 * exact bytes `---\n` or `---\r\n` at offset 0; `---` sequences later in the
 * file (thematic breaks, second fence pairs) are body content and are never
 * scanned or rewritten. Throws a plain `Error` for an opening fence with no
 * closing fence — a legacy issue file can never begin with `---`, so this is
 * always a malformed frontmatter attempt, not legacy content. Callers with a
 * file path wrap it in `IssueFrontmatterError`.
 */
export function splitFrontmatter(content: string): SplitFrontmatterResult {
  let eol: '\n' | '\r\n'
  let openEnd: number
  if (content.startsWith('---\n')) {
    eol = '\n'
    openEnd = 4
  } else if (content.startsWith('---\r\n')) {
    eol = '\r\n'
    openEnd = 5
  } else {
    return { rawFrontmatter: undefined, body: content, eol: '\n' }
  }

  const fence = findClosingFence(content, openEnd)
  if (fence === undefined) {
    throw new Error("frontmatter opened with '---' at offset 0 has no closing '---' fence")
  }
  return {
    rawFrontmatter: content.slice(openEnd, fence.fenceStart),
    body: content.slice(fence.bodyStart),
    eol,
  }
}

/** Split, wrapping malformed-fence errors with the file path. */
function splitOrThrow(content: string, filePath: string): SplitFrontmatterResult {
  try {
    return splitFrontmatter(content)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new IssueFrontmatterError(filePath, message, err)
  }
}

/** Validate a plain field set against the strict schema, rendering Zod issues. */
function validateFields(fields: unknown, filePath: string): IssueFrontmatter {
  const result = IssueFrontmatterSchema.safeParse(fields)
  if (!result.success) {
    throw new IssueFrontmatterError(
      filePath,
      `invalid issue frontmatter:\n${formatZodError(result.error, { prefix: '  ' })}`,
      result.error,
    )
  }
  return result.data
}

/** Reject frontmatter whose YAML value is not a mapping (list, scalar, …). */
function assertMapping(value: unknown, filePath: string): Record<string, unknown> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new IssueFrontmatterError(filePath, 'frontmatter must be a YAML mapping')
  }
  return value as Record<string, unknown>
}

/**
 * Read path: split + `YAML.parse` + strict Zod (defaults applied).
 * `frontmatter` is `undefined` for legacy (frontmatter-less) files —
 * semantically `{ type: 'issue', backlog: false }`, decided by the caller.
 */
export function parseIssueFrontmatter(
  content: string,
  filePath: string,
): { frontmatter: IssueFrontmatter | undefined; body: string } {
  const { rawFrontmatter, body } = splitOrThrow(content, filePath)
  if (rawFrontmatter === undefined) {
    return { frontmatter: undefined, body }
  }

  let data: unknown
  try {
    data = YAML.parse(rawFrontmatter)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new IssueFrontmatterError(filePath, `invalid YAML in frontmatter: ${message}`, err)
  }
  const fields = assertMapping(data, filePath)
  return { frontmatter: validateFields(fields, filePath), body }
}

/** Serialize patch fields in canonical order, omitting absent fields. */
function serializeCanonicalBlock(patch: IssueFrontmatterPatch, eol: string): string {
  const fields: Record<string, unknown> = {}
  for (const key of CANONICAL_KEYS) {
    const value = patch[key]
    if (value !== undefined) fields[key] = value
  }
  return YAML.stringify(fields, { lineWidth: 0 }).replace(/\r?\n/g, eol)
}

/**
 * Write path: returns the complete new file content.
 *
 * - Existing block: `YAML.parseDocument` + `doc.set` per defined patch key
 *   (`undefined` patch values are ignored, not deleted); untouched keys keep
 *   their value text, quoting, and relative order; new keys append. The block
 *   is re-fenced with the file's original EOL style.
 * - No block: a canonical-order block (`type`, `backlog`, `priority`,
 *   `milestone`, `order`; absent fields omitted) is prepended above the
 *   original content, which is carried through byte-identical.
 *
 * The resulting field set is validated with the strict schema BEFORE
 * returning — no unvalidated state writes. A patch with no defined keys
 * returns the input unchanged. Callers implement idempotency by comparing
 * the return value to the input.
 */
export function applyFrontmatterPatch(
  content: string,
  patch: IssueFrontmatterPatch,
  filePath: string,
): string {
  const { rawFrontmatter, body, eol } = splitOrThrow(content, filePath)

  const hasDefinedKeys = Object.values(patch).some(value => value !== undefined)
  if (!hasDefinedKeys) return content

  if (rawFrontmatter === undefined) {
    const block = serializeCanonicalBlock(patch, eol)
    validateFields(
      Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      filePath,
    )
    return `---${eol}${block}---${eol}${content}`
  }

  const doc = YAML.parseDocument(rawFrontmatter)
  if (doc.errors.length > 0) {
    throw new IssueFrontmatterError(
      filePath,
      `invalid YAML in frontmatter: ${doc.errors[0].message}`,
      doc.errors[0],
    )
  }
  // Validate the pre-existing field set first so corruption already on disk
  // (unknown keys, bad enums, non-map blocks) fails loudly before mutation.
  validateFields(assertMapping(doc.toJS(), filePath), filePath)

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) doc.set(key, value)
  }
  validateFields(assertMapping(doc.toJS(), filePath), filePath)

  const blockText = doc.toString().replace(/\r?\n/g, eol)
  return `---${eol}${blockText}---${eol}${body}`
}
