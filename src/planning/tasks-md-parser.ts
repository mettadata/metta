/**
 * tasks-md-parser: converts a tasks.md document into a TaskGraph suitable for
 * consumption by `computeWaves`.
 *
 * Expected structure (soft-parse — unknown/missing fields degrade gracefully):
 *
 *   ## Batch 1 (no dependencies — fully parallel)
 *
 *   - **Task 1.1: <name>**
 *     - **Files**: `src/a.ts`, `tests/a.test.ts`
 *     - **Depends on**: Task 1.2, Task 2.3
 *     - **Action**: <prose, ignored>
 *     - **Verify**: <prose, ignored>
 *     - **Done**: <prose, ignored>
 *
 * Notes:
 *   - H2 headings matching `## Batch N` or `## Batch N (<label>)` delimit batches.
 *   - Malformed batch headers (no trailing integer) are skipped silently.
 *   - `Files` can be an inline comma-separated list OR a nested bullet list; both
 *     are supported. Surrounding backticks are stripped from each entry. A
 *     missing Files field yields an empty array.
 *   - `Depends on` values are parsed as `Task N.M` tokens; anything else on the
 *     line is ignored. A missing Depends on field yields an empty array.
 */

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type {
  Root,
  Content,
  Heading,
  List,
  ListItem,
  Text,
  InlineCode,
  Strong,
  Paragraph,
} from 'mdast'
import { type TaskGraph, type Task, type Batch } from './parallel-wave-computer.js'

function extractText(node: Content): string {
  if (node.type === 'text') return (node as Text).value
  if (node.type === 'inlineCode') return `\`${(node as InlineCode).value}\``
  if ('children' in node) {
    return (node.children as Content[]).map(extractText).join('')
  }
  return ''
}

function getHeadingText(node: Heading): string {
  return node.children.map(c => extractText(c as Content)).join('')
}

interface InProgressBatch {
  batch: number
  label: string
  tasks: Task[]
}

/**
 * Parse `## Batch <N>` or `## Batch <N> (<label>)`. Returns null when the
 * heading does not match the expected shape.
 */
function parseBatchHeading(text: string): { batch: number; label: string } | null {
  const trimmed = text.trim()
  const match = trimmed.match(/^Batch\s+(\d+)(?:\s*\((.+)\))?\s*$/)
  if (!match) return null
  const batchNum = Number.parseInt(match[1], 10)
  if (!Number.isFinite(batchNum)) return null
  return {
    batch: batchNum,
    label: match[2]?.trim() ?? `Batch ${batchNum}`,
  }
}

/**
 * Extract a task ID from the leading bold of a task list item.
 *
 * Matches `**Task 1.2: <name>**` or `**Task 1.2:<name>**`.
 * Returns `null` when the bold prefix does not begin with `Task`.
 */
function parseTaskHeading(strongText: string): { id: string; name: string } | null {
  const match = strongText.match(/^Task\s+(\d+\.\d+)\s*:?\s*(.*)$/)
  if (!match) return null
  return { id: match[1], name: match[2].trim() }
}

/**
 * Get the leading strong/bold node and the remaining text for a list item's
 * first paragraph (e.g. `**Task 1.1: ...**` or `**Files**: a, b, c`).
 *
 * Tolerates leading whitespace-only or GFM task-marker text nodes (e.g. `[ ] `
 * or `[x] ` that remark emits when listItem.checked is not consumed).
 */
function splitLeadingBold(
  paragraph: Paragraph,
): { bold: string; rest: string } | null {
  const children = paragraph.children as Content[]
  if (children.length === 0) return null

  // Skip leading text nodes that are pure whitespace or GFM task markers
  // (which remark-parse without gfm renders as literal `[ ] ` text).
  let idx = 0
  while (idx < children.length) {
    const c = children[idx]
    if (c.type === 'text') {
      const v = (c as Text).value
      if (/^\s*(\[[ xX]\]\s*)?$/.test(v)) {
        idx += 1
        continue
      }
    }
    break
  }
  if (idx >= children.length) return null
  const first = children[idx]
  if (first.type !== 'strong') return null
  const bold = (first as Strong).children.map(c => extractText(c as Content)).join('')
  const rest = children
    .slice(idx + 1)
    .map(c => extractText(c))
    .join('')
  return { bold, rest }
}

/**
 * Parse the `Files` value. Supports both inline comma-separated form
 * (`**Files**: a, b, c`) and a nested bullet list with one file per line.
 * Backticks surrounding a path are stripped.
 */
function parseFilesField(restText: string, nested: List | null): string[] {
  const out: string[] = []

  const pushToken = (raw: string): void => {
    let token = raw.trim()
    if (token.length === 0) return
    // Strip a leading colon if the rest text started with ": " residue.
    token = token.replace(/^:\s*/, '')
    // Strip wrapping backticks (`path`) -> path
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      token = token.slice(1, -1)
    }
    token = token.trim()
    if (token.length === 0) return
    out.push(token)
  }

  if (restText && restText.trim().length > 0) {
    const cleaned = restText.replace(/^:\s*/, '')
    for (const part of cleaned.split(',')) {
      pushToken(part)
    }
  }

  if (nested) {
    for (const item of nested.children as ListItem[]) {
      // Each file-item usually has a paragraph child with inline code or text.
      const itemText = (item.children as Content[])
        .map(c => extractText(c))
        .join('')
        .trim()
      // Tolerate multiple files in a single sub-bullet separated by commas.
      for (const part of itemText.split(',')) {
        pushToken(part)
      }
    }
  }

  return out
}

/**
 * Parse the `Depends on` value. Extracts every `Task N.M` token and returns
 * its numeric `N.M` id. Unparseable tokens are dropped silently.
 */
function parseDependsOn(restText: string, nested: List | null): string[] {
  const parts: string[] = []
  const pushLine = (line: string): void => {
    const matches = line.matchAll(/Task\s+(\d+\.\d+)/g)
    for (const m of matches) parts.push(m[1])
  }

  if (restText) pushLine(restText)
  if (nested) {
    for (const item of nested.children as ListItem[]) {
      const itemText = (item.children as Content[])
        .map(c => extractText(c))
        .join('')
      pushLine(itemText)
    }
  }

  // Deduplicate while preserving order.
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p)
      out.push(p)
    }
  }
  return out
}

/**
 * Parse a single task list item. Returns null when the item does not begin
 * with a `**Task N.M: ...**` bold header.
 */
function parseTaskItem(item: ListItem): Task | null {
  const children = item.children as Content[]
  if (children.length === 0) return null
  const first = children[0]
  if (first.type !== 'paragraph') return null
  const lead = splitLeadingBold(first as Paragraph)
  if (!lead) return null
  const heading = parseTaskHeading(lead.bold)
  if (!heading) return null

  let files: string[] = []
  let dependsOn: string[] = []

  // Sub-bullets live in nested List nodes as subsequent children of the item.
  for (const child of children.slice(1)) {
    if (child.type !== 'list') continue
    for (const sub of (child as List).children as ListItem[]) {
      const subChildren = sub.children as Content[]
      if (subChildren.length === 0) continue
      const subFirst = subChildren[0]
      if (subFirst.type !== 'paragraph') continue
      const subLead = splitLeadingBold(subFirst as Paragraph)
      if (!subLead) continue

      // Find the optional nested list under this sub-bullet (e.g. multi-line
      // Files listing).
      let nested: List | null = null
      for (const grand of subChildren.slice(1)) {
        if (grand.type === 'list') {
          nested = grand as List
          break
        }
      }

      const label = subLead.bold.trim().toLowerCase()
      if (label === 'files') {
        files = parseFilesField(subLead.rest, nested)
      } else if (label === 'depends on' || label === 'depends') {
        dependsOn = parseDependsOn(subLead.rest, nested)
      }
      // Other labels (Action, Verify, Done, etc.) are ignored by design.
    }
  }

  return {
    id: heading.id,
    files,
    dependsOn,
  }
}

/**
 * Parse a tasks.md document into a TaskGraph.
 *
 * Missing fields degrade gracefully: an absent `Files` sub-bullet yields an
 * empty array; an absent `Depends on` yields an empty array. Malformed batch
 * headings are skipped without raising.
 *
 * Returns `{ batches: [] }` for an empty document.
 */
export function parseTasksMd(markdown: string): TaskGraph {
  if (!markdown || markdown.trim().length === 0) {
    return { batches: [] }
  }

  const tree = unified().use(remarkParse).parse(markdown) as Root
  const children = tree.children as Content[]

  const batches: Batch[] = []
  let current: InProgressBatch | null = null

  const flush = (): void => {
    if (current) {
      batches.push({
        batch: current.batch,
        label: current.label,
        tasks: current.tasks,
      })
      current = null
    }
  }

  for (const node of children) {
    if (node.type === 'heading') {
      const heading = node as Heading
      if (heading.depth === 2) {
        const text = getHeadingText(heading)
        const parsed = parseBatchHeading(text)
        if (parsed) {
          flush()
          current = {
            batch: parsed.batch,
            label: parsed.label,
            tasks: [],
          }
        }
        // Non-matching H2 (e.g. "Batch" without a number) is skipped; we do
        // not reset current on these so intervening H2 prose does not break
        // in-progress batches. This follows the soft-parse posture.
        continue
      }
      continue
    }

    if (node.type === 'list' && current) {
      for (const item of (node as List).children as ListItem[]) {
        const task = parseTaskItem(item)
        if (task) current.tasks.push(task)
      }
      continue
    }
  }

  flush()

  return { batches }
}
