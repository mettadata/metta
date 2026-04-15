import { readFile } from 'node:fs/promises'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, Content, Heading, Text, InlineCode } from 'mdast'

export interface ConstitutionArticles {
  conventions: string[]
  offLimits: string[]
}

export class ConstitutionParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConstitutionParseError'
  }
}

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

function stripSurroundingBackticks(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function collectListItems(nodes: Content[]): string[] {
  const items: string[] = []
  for (const node of nodes) {
    if (node.type === 'list') {
      for (const item of (node as { children: Content[] }).children) {
        if ('children' in item) {
          const text = (item.children as Content[]).map(extractText).join('').trim()
          if (text) {
            items.push(stripSurroundingBackticks(text))
          }
        }
      }
    }
  }
  return items
}

export async function parseConstitution(projectMdPath: string): Promise<ConstitutionArticles> {
  const markdown = await readFile(projectMdPath, 'utf-8')
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const children = tree.children as Content[]

  const sectionNodes: Record<string, Content[]> = {
    Conventions: [],
    'Off-Limits': [],
  }

  let currentSection: string | null = null

  for (const node of children) {
    if (node.type === 'heading') {
      const heading = node as Heading
      if (heading.depth === 2) {
        const text = getHeadingText(heading).trim()
        if (text === 'Conventions' || text === 'Off-Limits') {
          currentSection = text
          continue
        }
        currentSection = null
        continue
      }
    }
    if (currentSection) {
      sectionNodes[currentSection].push(node)
    }
  }

  const conventions = collectListItems(sectionNodes['Conventions'])
  const offLimits = collectListItems(sectionNodes['Off-Limits'])

  if (conventions.length === 0 && offLimits.length === 0) {
    throw new ConstitutionParseError(
      `No "Conventions" or "Off-Limits" section found in ${projectMdPath}`,
    )
  }

  return { conventions, offLimits }
}
