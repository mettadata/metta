import { unified } from 'unified'
import remarkParse from 'remark-parse'
import { createHash } from 'node:crypto'
import type { Root, Content, Heading, Text, InlineCode } from 'mdast'
import { toSlugUntruncated } from '../util/slug.js'

export interface ParsedScenario {
  name: string
  steps: string[]
}

export interface ParsedRequirement {
  id: string
  name: string
  text: string
  keyword: 'MUST' | 'SHOULD' | 'MAY'
  scenarios: ParsedScenario[]
  hash: string
  fulfills: string[]
  warnings: string[]
}

function parseFulfillsLine(
  text: string,
  req: Partial<ParsedRequirement>,
): boolean {
  const match = text.match(/^(?:\*\*Fulfills:\*\*|Fulfills:)\s*(.*)$/)
  if (!match) return false
  const raw = match[1].trim()
  const tokens = raw.split(',').map(t => t.trim()).filter(Boolean)
  const valid = tokens.filter(t => /^US-\d+$/.test(t))
  if (tokens.length === 0 || valid.length !== tokens.length) {
    req.warnings = req.warnings ?? []
    req.warnings.push(`Malformed Fulfills line: "${text}"`)
    req.fulfills = []
  } else {
    req.fulfills = valid
  }
  return true
}

export type DeltaOperation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED'

export interface ParsedDelta {
  operation: DeltaOperation
  requirement: ParsedRequirement
}

export interface ParsedSpec {
  title: string
  requirements: ParsedRequirement[]
}

export interface ParsedDeltaSpec {
  title: string
  deltas: ParsedDelta[]
}

function contentHash(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 12)}`
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

function extractKeyword(text: string): 'MUST' | 'SHOULD' | 'MAY' {
  if (/\bMUST\b/.test(text)) return 'MUST'
  if (/\bSHOULD\b/.test(text)) return 'SHOULD'
  if (/\bMAY\b/.test(text)) return 'MAY'
  return 'SHOULD'
}

export function parseSpec(markdown: string): ParsedSpec {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const children = tree.children as Content[]

  let title = ''
  const requirements: ParsedRequirement[] = []
  let currentReq: Partial<ParsedRequirement> | null = null
  let currentScenario: ParsedScenario | null = null
  let reqTextParts: string[] = []

  for (const node of children) {
    if (node.type === 'heading') {
      const heading = node as Heading
      const text = getHeadingText(heading)

      if (heading.depth === 1) {
        title = text
        continue
      }

      if (heading.depth === 2 && text.startsWith('Requirement:')) {
        // Flush previous requirement
        if (currentReq) {
          if (currentScenario) {
            currentReq.scenarios = currentReq.scenarios ?? []
            currentReq.scenarios.push(currentScenario)
            currentScenario = null
          }
          currentReq.text = reqTextParts.join('\n').trim()
          currentReq.hash = contentHash(currentReq.text + JSON.stringify(currentReq.scenarios))
          requirements.push(currentReq as ParsedRequirement)
        }

        const name = text.replace('Requirement:', '').trim()
        currentReq = {
          id: toSlugUntruncated(name),
          name,
          text: '',
          keyword: 'SHOULD',
          scenarios: [],
          fulfills: [],
          warnings: [],
        }
        reqTextParts = []
        continue
      }

      if (heading.depth === 3 && text.startsWith('Scenario:')) {
        if (currentScenario && currentReq) {
          currentReq.scenarios = currentReq.scenarios ?? []
          currentReq.scenarios.push(currentScenario)
        }
        currentScenario = {
          name: text.replace('Scenario:', '').trim(),
          steps: [],
        }
        continue
      }
    }

    if (currentScenario && node.type === 'list') {
      for (const item of (node as { children: Content[] }).children) {
        if ('children' in item) {
          const stepText = (item.children as Content[]).map(extractText).join('').trim()
          if (stepText) {
            currentScenario.steps.push(stepText)
          }
        }
      }
      continue
    }

    if (currentReq && !currentScenario) {
      if (node.type === 'paragraph') {
        const text = extractText(node)
        reqTextParts.push(text)
        currentReq.keyword = extractKeyword(text)
        parseFulfillsLine(text, currentReq)
      }
    }
  }

  // Flush last requirement
  if (currentReq) {
    if (currentScenario) {
      currentReq.scenarios = currentReq.scenarios ?? []
      currentReq.scenarios.push(currentScenario)
    }
    currentReq.text = reqTextParts.join('\n').trim()
    currentReq.hash = contentHash(currentReq.text + JSON.stringify(currentReq.scenarios))
    requirements.push(currentReq as ParsedRequirement)
  }

  return { title, requirements }
}

export function parseDeltaSpec(markdown: string): ParsedDeltaSpec {
  const tree = unified().use(remarkParse).parse(markdown) as Root
  const children = tree.children as Content[]

  let title = ''
  const deltas: ParsedDelta[] = []
  let currentDelta: { operation: DeltaOperation; req: Partial<ParsedRequirement> } | null = null
  let currentScenario: ParsedScenario | null = null
  let reqTextParts: string[] = []

  const deltaPattern = /^(ADDED|MODIFIED|REMOVED|RENAMED):\s*Requirement:\s*(.+)/

  for (const node of children) {
    if (node.type === 'heading') {
      const heading = node as Heading
      const text = getHeadingText(heading)

      if (heading.depth === 1) {
        title = text
        continue
      }

      if (heading.depth === 2) {
        const match = text.match(deltaPattern)
        if (match) {
          // Flush previous delta
          if (currentDelta) {
            if (currentScenario) {
              currentDelta.req.scenarios = currentDelta.req.scenarios ?? []
              currentDelta.req.scenarios.push(currentScenario)
              currentScenario = null
            }
            currentDelta.req.text = reqTextParts.join('\n').trim()
            currentDelta.req.hash = contentHash(currentDelta.req.text + JSON.stringify(currentDelta.req.scenarios))
            deltas.push({
              operation: currentDelta.operation,
              requirement: currentDelta.req as ParsedRequirement,
            })
          }

          const operation = match[1] as DeltaOperation
          const name = match[2]
          currentDelta = {
            operation,
            req: {
              id: toSlugUntruncated(name),
              name,
              text: '',
              keyword: 'SHOULD',
              scenarios: [],
              fulfills: [],
              warnings: [],
            },
          }
          reqTextParts = []
          continue
        }
      }

      if (heading.depth === 3 && currentDelta) {
        const scenarioText = getHeadingText(heading)
        if (scenarioText.includes('Scenario:')) {
          if (currentScenario) {
            currentDelta.req.scenarios = currentDelta.req.scenarios ?? []
            currentDelta.req.scenarios.push(currentScenario)
          }
          const scenarioName = scenarioText.replace(/^(ADDED\s+)?Scenario:\s*/, '').trim()
          currentScenario = { name: scenarioName, steps: [] }
          continue
        }
      }
    }

    if (currentScenario && node.type === 'list') {
      for (const item of (node as { children: Content[] }).children) {
        if ('children' in item) {
          const stepText = (item.children as Content[]).map(extractText).join('').trim()
          if (stepText) {
            currentScenario.steps.push(stepText)
          }
        }
      }
      continue
    }

    if (currentDelta && !currentScenario) {
      if (node.type === 'paragraph') {
        const text = extractText(node)
        reqTextParts.push(text)
        currentDelta.req.keyword = extractKeyword(text)
        parseFulfillsLine(text, currentDelta.req)
      }
    }
  }

  // Flush last delta
  if (currentDelta) {
    if (currentScenario) {
      currentDelta.req.scenarios = currentDelta.req.scenarios ?? []
      currentDelta.req.scenarios.push(currentScenario)
    }
    currentDelta.req.text = reqTextParts.join('\n').trim()
    currentDelta.req.hash = contentHash(currentDelta.req.text + JSON.stringify(currentDelta.req.scenarios))
    deltas.push({
      operation: currentDelta.operation,
      requirement: currentDelta.req as ParsedRequirement,
    })
  }

  return { title, deltas }
}

export function hashSpec(spec: ParsedSpec): string {
  const combined = spec.requirements.map(r => r.hash).join(':')
  return contentHash(combined)
}
