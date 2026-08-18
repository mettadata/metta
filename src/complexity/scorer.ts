import { unified } from 'unified'
import remarkParse from 'remark-parse'
import type { Root, Content, Heading, Text, InlineCode } from 'mdast'
import { parseFileCountFromSection } from './file-count-parser.js'
import type { ComplexityScore, ChangeMetadata } from '../schemas/change-metadata.js'

export type Tier = 'trivial' | 'quick' | 'standard' | 'full'

const TIER_SCORE: Record<Tier, number> = {
  trivial: 0,
  quick: 1,
  standard: 2,
  full: 3,
}

/**
 * Map a file count to the canonical adaptive-workflow tier.
 *
 * This is the single authoritative definition of the adaptive-workflow
 * thresholds. No other file in the codebase duplicates these boundaries.
 *
 * Thresholds:
 *  - n <= 1          -> 'trivial'
 *  - 2 <= n <= 3     -> 'quick'
 *  - 4 <= n <= 7     -> 'standard'
 *  - n >= 8          -> 'full'
 */
export function tierFromFileCount(n: number): Tier {
  if (n <= 1) return 'trivial'
  if (n <= 3) return 'quick'
  if (n <= 7) return 'standard'
  return 'full'
}

function extractText(node: Content): string {
  if (node.type === 'text') return (node as Text).value
  if (node.type === 'inlineCode') return (node as InlineCode).value
  if ('children' in node) {
    return (node.children as Content[]).map(extractText).join('')
  }
  return ''
}

function hasH2Heading(markdownSource: string, sectionHeading: string): boolean {
  const normalized = sectionHeading.replace(/^#+\s*/, '').trim()
  const tree = unified().use(remarkParse).parse(markdownSource) as Root
  for (const node of tree.children as Content[]) {
    if (node.type !== 'heading') continue
    const heading = node as Heading
    if (heading.depth !== 2) continue
    const text = heading.children
      .map(c => extractText(c as Content))
      .join('')
      .trim()
    if (text === normalized) return true
  }
  return false
}

/**
 * Map a raw file count (including 0) to a full ComplexityScore through the
 * canonical `tierFromFileCount` thresholds. This function has no opinion on
 * whether a 0 count is meaningful -- zero-file no-signal gating is the
 * intent scorer's responsibility (`scoreFromIntentImpact`), not this one.
 */
function buildScore(fileCount: number): ComplexityScore {
  const recommended = tierFromFileCount(fileCount)
  return {
    score: TIER_SCORE[recommended],
    signals: { file_count: fileCount },
    recommended_workflow: recommended,
  }
}

/**
 * Score an intent.md document by counting files in its `## Impact` section.
 *
 * Returns null whenever the parsed file count is 0 -- whether the `## Impact`
 * heading is entirely absent or present but the section lists no files. Zero
 * files at intent time is absence of evidence, not evidence of triviality:
 * intent.md is often authored before the change's scope is known, so an
 * empty `## Impact` section carries no signal about the eventual tier.
 * Contrast with `scoreFromSummaryFiles`, where a 0 count at summary time IS
 * treated as a real `trivial` signal.
 */
export function scoreFromIntentImpact(intentMd: string): ComplexityScore | null {
  const count = parseFileCountFromSection(intentMd, '## Impact')
  if (count === 0) return null
  return buildScore(count)
}

/**
 * Score a summary.md document by counting files in its `## Files` section.
 *
 * Returns null only when the `## Files` heading is entirely absent.
 * Returns a zero-file score when the heading exists but the section is
 * empty -- unlike `scoreFromIntentImpact`, 0 files here IS a real `trivial`
 * signal: by summary time the change's actual file set is known, so an
 * empty `## Files` section means the change genuinely touches no files.
 * This asymmetry with the intent-time scorer is intentional.
 */
export function scoreFromSummaryFiles(summaryMd: string): ComplexityScore | null {
  if (!hasH2Heading(summaryMd, '## Files')) return null
  const count = parseFileCountFromSection(summaryMd, '## Files')
  return buildScore(count)
}

/**
 * Returns true when `metadata.complexity_score` is defined and has a valid
 * integer `score` field in the allowed 0..3 range.
 */
export function isScorePresent(metadata: ChangeMetadata): boolean {
  const cs = metadata.complexity_score
  if (cs === undefined || cs === null) return false
  if (typeof cs.score !== 'number') return false
  if (!Number.isInteger(cs.score)) return false
  if (cs.score < 0 || cs.score > 3) return false
  return true
}
