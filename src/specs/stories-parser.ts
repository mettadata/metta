import { readFile } from 'node:fs/promises'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, Content, Heading, Text, InlineCode, List, ListItem, Paragraph } from 'mdast'
import { StoriesDocumentSchema, type StoriesDocument, type Story, type AcceptanceCriterion, type Priority } from '../schemas/story.js'

export class StoriesParseError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly storyId?: string,
  ) {
    super(message)
    this.name = 'StoriesParseError'
  }
}

function extractText(node: Content): string {
  if (node.type === 'text') return (node as Text).value
  if (node.type === 'inlineCode') return `\`${(node as InlineCode).value}\``
  if (node.type === 'strong' || node.type === 'emphasis') {
    const inner = (node as { children: Content[] }).children.map(extractText).join('')
    return node.type === 'strong' ? `**${inner}**` : `*${inner}*`
  }
  if ('children' in node) {
    return (node.children as Content[]).map(extractText).join('')
  }
  return ''
}

function getHeadingText(node: Heading): string {
  return node.children.map(c => extractText(c as Content)).join('')
}

interface StoryDraft {
  id: string
  numericId: number
  title: string
  asA?: string
  iWantTo?: string
  soThat?: string
  priority?: string
  independentTestCriteria?: string
  acceptanceCriteria: AcceptanceCriterion[]
}

const FIELD_PREFIXES: Array<{ prefix: string; key: keyof StoryDraft }> = [
  { prefix: '**As a**', key: 'asA' },
  { prefix: '**I want to**', key: 'iWantTo' },
  { prefix: '**So that**', key: 'soThat' },
  { prefix: '**Priority:**', key: 'priority' },
  { prefix: '**Independent Test Criteria:**', key: 'independentTestCriteria' },
]

function stripFieldPrefix(text: string, prefix: string): string {
  return text.slice(prefix.length).trim().replace(/^[:\-\s]+/, '').trim()
}

function parseAcceptanceCriterion(itemText: string): AcceptanceCriterion | null {
  // Expected: **Given** ... **When** ... **Then** ...
  const re = /\*\*Given\*\*\s*(.+?)\s*\*\*When\*\*\s*(.+?)\s*\*\*Then\*\*\s*(.+)$/s
  const m = itemText.match(re)
  if (!m) return null
  return {
    given: m[1].trim().replace(/[,;]+$/, '').trim(),
    when: m[2].trim().replace(/[,;]+$/, '').trim(),
    then: m[3].trim(),
  }
}

function flushStory(draft: StoryDraft): Story {
  const required: Array<[keyof StoryDraft, string]> = [
    ['asA', 'asA'],
    ['iWantTo', 'iWantTo'],
    ['soThat', 'soThat'],
    ['priority', 'priority'],
    ['independentTestCriteria', 'independentTestCriteria'],
  ]
  for (const [key, fieldName] of required) {
    const val = draft[key]
    if (typeof val !== 'string' || val.length === 0) {
      throw new StoriesParseError(
        `Story ${draft.id} is missing required field: ${fieldName}`,
        fieldName,
        draft.id,
      )
    }
  }
  if (draft.acceptanceCriteria.length === 0) {
    throw new StoriesParseError(
      `Story ${draft.id} is missing acceptance criteria`,
      'acceptanceCriteria',
      draft.id,
    )
  }
  const priority = draft.priority as Priority
  if (priority !== 'P1' && priority !== 'P2' && priority !== 'P3') {
    throw new StoriesParseError(
      `Story ${draft.id} has invalid priority "${draft.priority}"`,
      'priority',
      draft.id,
    )
  }
  return {
    id: draft.id,
    title: draft.title,
    asA: draft.asA as string,
    iWantTo: draft.iWantTo as string,
    soThat: draft.soThat as string,
    priority,
    independentTestCriteria: draft.independentTestCriteria as string,
    acceptanceCriteria: draft.acceptanceCriteria,
  }
}

function extractJustification(children: Content[]): string {
  for (const node of children) {
    if (node.type === 'paragraph') {
      const text = extractText(node).trim()
      if (text.startsWith('**Justification:**')) {
        return text.slice('**Justification:**'.length).trim()
      }
    }
  }
  return ''
}

function isSentinelHeading(text: string): boolean {
  return /^No user stories\s*[\u2014\u2013\-]\s*internal\/infrastructure change/i.test(text.trim())
}

export async function parseStories(path: string): Promise<StoriesDocument> {
  let markdown: string
  try {
    markdown = await readFile(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new StoriesParseError(`stories.md not found at ${path}`)
    }
    throw err
  }

  const tree = unified().use(remarkParse).parse(markdown) as Root
  const children = tree.children as Content[]

  // Sentinel detection: look for a heading OR paragraph matching the sentinel line.
  for (const node of children) {
    if (node.type === 'heading') {
      const text = getHeadingText(node as Heading)
      if (isSentinelHeading(text)) {
        const justification = extractJustification(children)
        try {
          return StoriesDocumentSchema.parse({ kind: 'sentinel', justification })
        } catch (err) {
          throw new StoriesParseError(
            `Invalid sentinel document: ${(err as Error).message}`,
            'justification',
          )
        }
      }
    } else if (node.type === 'paragraph') {
      const text = extractText(node).trim()
      if (isSentinelHeading(text)) {
        const justification = extractJustification(children)
        try {
          return StoriesDocumentSchema.parse({ kind: 'sentinel', justification })
        } catch (err) {
          throw new StoriesParseError(
            `Invalid sentinel document: ${(err as Error).message}`,
            'justification',
          )
        }
      }
    }
  }

  // Stories parsing
  const stories: Story[] = []
  const seenIds = new Set<string>()
  const numericIds: number[] = []
  let current: StoryDraft | null = null
  const storyHeadingRe = /^US-(\d+):\s*(.+)$/
  const nonNumericRe = /^US-([^\d:][^:]*):/

  for (const node of children) {
    if (node.type === 'heading' && (node as Heading).depth === 2) {
      const text = getHeadingText(node as Heading).trim()
      const m = text.match(storyHeadingRe)
      if (m) {
        if (current) {
          stories.push(flushStory(current))
        }
        const idNum = parseInt(m[1], 10)
        const id = `US-${idNum}`
        if (seenIds.has(id)) {
          throw new StoriesParseError(
            `Duplicate story ID ${id}`,
            'id',
            id,
          )
        }
        seenIds.add(id)
        numericIds.push(idNum)
        current = {
          id,
          numericId: idNum,
          title: m[2].trim(),
          acceptanceCriteria: [],
        }
        continue
      }
      // Detect non-numeric US-X headings
      if (/^US-/.test(text) && !m) {
        throw new StoriesParseError(
          `Invalid story heading "${text}": ID must match US-N where N is a positive integer`,
          'id',
        )
      }
    }

    if (!current) continue

    if (node.type === 'paragraph') {
      const paraText = extractText(node).trim()
      for (const { prefix, key } of FIELD_PREFIXES) {
        if (paraText.startsWith(prefix)) {
          const value = stripFieldPrefix(paraText, prefix)
          ;(current as unknown as Record<string, string>)[key as string] = value
          break
        }
      }
      continue
    }

    if (node.type === 'list') {
      const list = node as List
      for (const item of list.children as ListItem[]) {
        const itemText = (item.children as Content[])
          .map(child => {
            if (child.type === 'paragraph') return extractText(child as Paragraph)
            return extractText(child)
          })
          .join(' ')
          .trim()
        const ac = parseAcceptanceCriterion(itemText)
        if (ac) current.acceptanceCriteria.push(ac)
      }
      continue
    }
  }

  if (current) {
    stories.push(flushStory(current))
  }

  if (stories.length === 0) {
    throw new StoriesParseError('No stories found and no sentinel declaration present')
  }

  // Monotonic ID check
  for (let i = 0; i < numericIds.length; i++) {
    const expected = i + 1
    if (numericIds[i] !== expected) {
      throw new StoriesParseError(
        `Non-monotonic story IDs: expected US-${expected} at position ${i + 1}, got US-${numericIds[i]}`,
        'id',
        `US-${numericIds[i]}`,
      )
    }
  }

  try {
    return StoriesDocumentSchema.parse({ kind: 'stories', stories })
  } catch (err) {
    throw new StoriesParseError(
      `Stories document failed schema validation: ${(err as Error).message}`,
    )
  }
}
