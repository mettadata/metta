import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, Content, Heading, Text, InlineCode } from 'mdast'

const FILE_EXTENSIONS = [
  '.ts',
  '.yaml',
  '.yml',
  '.md',
  '.js',
  '.jsx',
  '.tsx',
  '.go',
  '.py',
  '.rs',
  '.sh',
  '.json',
  '.toml',
] as const

const PATH_PREFIXES = [
  'src/',
  'tests/',
  'dist/',
  '.metta/',
  'spec/',
] as const

function extractText(node: Content): string {
  if (node.type === 'text') return (node as Text).value
  if (node.type === 'inlineCode') return (node as InlineCode).value
  if ('children' in node) {
    return (node.children as Content[]).map(extractText).join('')
  }
  return ''
}

function getHeadingText(node: Heading): string {
  return node.children.map(c => extractText(c as Content)).join('')
}

function isFileLikeToken(token: string): boolean {
  const trimmed = token.trim()
  if (trimmed.length === 0) return false
  for (const ext of FILE_EXTENSIONS) {
    if (trimmed.endsWith(ext)) return true
  }
  for (const prefix of PATH_PREFIXES) {
    if (trimmed.startsWith(prefix)) return true
  }
  return false
}

function collectInlineCodeNodes(node: Content | Root): InlineCode[] {
  const out: InlineCode[] = []
  const visit = (n: Content | Root): void => {
    if ((n as Content).type === 'inlineCode') {
      out.push(n as InlineCode)
      return
    }
    if ('children' in n) {
      for (const child of (n.children as Content[])) {
        visit(child)
      }
    }
  }
  visit(node)
  return out
}

/**
 * Parse the count of file-like inline-code references in a markdown section.
 *
 * Walks the mdast for `markdownSource`, locates the first H2 whose text matches
 * `sectionHeading` exactly, collects all `inlineCode` nodes in the section body
 * (between that H2 and the next H2 at the same depth, or end of document),
 * filters them with an extension/prefix discriminator, deduplicates by exact
 * string, and returns the count.
 *
 * @param markdownSource the full markdown document.
 * @param sectionHeading the H2 heading text to locate (e.g. `## Impact` or `## Files`).
 *   The leading `## ` is tolerated and stripped for comparison.
 * @returns the count of unique file-like inline-code tokens in the section.
 *   Returns 0 when the heading is absent or no file-like tokens are present.
 */
export function parseFileCountFromSection(
  markdownSource: string,
  sectionHeading: string,
): number {
  const normalizedHeading = sectionHeading.replace(/^#+\s*/, '').trim()

  const tree = unified().use(remarkParse).parse(markdownSource) as Root
  const children = tree.children as Content[]

  let inSection = false
  const sectionNodes: Content[] = []

  for (const node of children) {
    if (node.type === 'heading') {
      const heading = node as Heading
      const text = getHeadingText(heading).trim()

      if (inSection) {
        if (heading.depth === 2) {
          // Reached next H2 boundary; stop collecting.
          break
        }
        // Deeper heading inside the section; include it.
        sectionNodes.push(node)
        continue
      }

      if (heading.depth === 2 && text === normalizedHeading) {
        inSection = true
        continue
      }
      continue
    }

    if (inSection) {
      sectionNodes.push(node)
    }
  }

  if (!inSection) return 0

  const inlineCodeNodes: InlineCode[] = []
  for (const node of sectionNodes) {
    inlineCodeNodes.push(...collectInlineCodeNodes(node))
  }

  const uniqueTokens = new Set<string>()
  for (const icn of inlineCodeNodes) {
    const value = icn.value
    if (isFileLikeToken(value)) {
      uniqueTokens.add(value)
    }
  }

  return uniqueTokens.size
}
