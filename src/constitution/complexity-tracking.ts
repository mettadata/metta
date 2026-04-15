import { readFile } from 'node:fs/promises'

const SECTION_REGEX = /^## Complexity Tracking\s*\n([\s\S]*?)(?:\n## |$(?![\s\S]))/m
const ENTRY_REGEX = /^- (.+?):\s*(.+)$/gm

/**
 * Parse the `## Complexity Tracking` section of a spec.md file.
 *
 * Returns a Map of article -> rationale. Returns an empty Map when the section
 * is absent or empty (this is not an error). Article keys are matched exactly
 * (no fuzzy matching) per REQ-2.8.
 *
 * Only filesystem errors propagate.
 */
export async function parseComplexityTracking(specMdPath: string): Promise<Map<string, string>> {
  const content = await readFile(specMdPath, 'utf8')
  const sectionMatch = SECTION_REGEX.exec(content)
  const result = new Map<string, string>()
  if (!sectionMatch) return result

  const body = sectionMatch[1] ?? ''
  ENTRY_REGEX.lastIndex = 0
  let entry: RegExpExecArray | null
  while ((entry = ENTRY_REGEX.exec(body)) !== null) {
    const article = entry[1]?.trim()
    const rationale = entry[2]?.trim()
    if (article && rationale) {
      result.set(article, rationale)
    }
  }
  return result
}
