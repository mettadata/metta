import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, Content, Text, InlineCode } from 'mdast'
import {
  AgentFrontmatterSchema,
  type AgentFrontmatter,
} from '../schemas/agent-definition.js'

/**
 * Thrown when an agent short name referenced by a workflow artifact cannot be
 * resolved to a well-formed agent definition file. Resolution MUST fail
 * loudly — there is no silent fallback agent.
 */
export class AgentResolutionError extends Error {
  constructor(
    public readonly agentName: string,
    public readonly artifactId: string,
  ) {
    super(
      `Could not resolve agent '${agentName}' for artifact '${artifactId}': ` +
      `no valid agent definition file 'metta-${agentName}.md' was found`,
    )
    this.name = 'AgentResolutionError'
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

/**
 * Extract the persona: the plain text of every markdown node between the
 * closing frontmatter `---` and the first heading in the agent file body.
 */
function extractPersona(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const tree = unified().use(remarkParse).parse(body) as Root
  const parts: string[] = []
  for (const node of tree.children as Content[]) {
    if (node.type === 'heading') break
    const text = extractText(node).trim()
    if (text) parts.push(text)
  }
  return parts.join('\n\n').trim()
}

/**
 * Load an agent definition from its template file at runtime.
 *
 * Resolves `metta-<shortName>.md` inside `templateDir` (defaulting to the
 * built-in `templates/agents` directory shipped with metta) — the filename
 * convention is the single routing authority for short-name → file; there is
 * no lookup table. `name` and `tools` come from frontmatter; `persona` is the
 * remark-parsed body text before the first heading.
 *
 * @throws AgentResolutionError on a missing/unreadable file, an empty
 *   persona, or a parse result that fails schema validation.
 */
export async function loadAgentDefinition(
  shortName: string,
  artifactId: string,
  templateDir?: string,
): Promise<AgentFrontmatter> {
  const dir = templateDir ?? new URL('../templates/agents', import.meta.url).pathname
  const filePath = join(dir, `metta-${shortName}.md`)

  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    throw new AgentResolutionError(shortName, artifactId)
  }

  const nameMatch = content.match(/^name:\s*(.+)$/m)
  const name = nameMatch ? nameMatch[1].trim() : ''

  const toolsMatch = content.match(/^tools:\s*\[(.*)\]\s*$/m)
  const tools = toolsMatch
    ? toolsMatch[1]
        .split(',')
        .map(t => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(t => t.length > 0)
    : []

  const persona = extractPersona(content)
  if (persona.trim().length === 0) {
    throw new AgentResolutionError(shortName, artifactId)
  }

  try {
    return AgentFrontmatterSchema.parse({ name, persona, tools })
  } catch {
    throw new AgentResolutionError(shortName, artifactId)
  }
}
