import { type ComplexityScore } from '../schemas/change-metadata.js'
import { color } from '../cli/helpers.js'

type Tier = 'trivial' | 'quick' | 'standard' | 'full'

const TIER_ORDER: Record<Tier, number> = {
  trivial: 0,
  quick: 1,
  standard: 2,
  full: 3,
}

function tierRank(tier: string): number {
  return TIER_ORDER[tier as Tier] ?? -1
}

/**
 * Render a one-line advisory banner comparing the current workflow tier
 * to the scored recommendation.
 *
 * Returns the empty string when `score` is null/undefined.
 *
 * Output forms (yellow "Advisory:" prefix, code 33):
 *   - agreement: "Advisory: current workflow <tier> matches recommendation <tier>"
 *   - downscale: "Advisory: current <chosen>, scored <recommended> -- downscale recommended"
 *   - upscale:   "Advisory: current <chosen>, scored <recommended> -- upscale recommended"
 */
export function renderBanner(
  score: ComplexityScore | null | undefined,
  currentWorkflow: string,
): string {
  if (score === null || score === undefined) return ''

  const prefix = color('Advisory:', 33)
  const recommended = score.recommended_workflow

  if (recommended === currentWorkflow) {
    return `${prefix} current workflow ${currentWorkflow} matches recommendation ${recommended}`
  }

  const chosenRank = tierRank(currentWorkflow)
  const recRank = tierRank(recommended)

  if (recRank < chosenRank) {
    return `${prefix} current ${currentWorkflow}, scored ${recommended} -- downscale recommended`
  }

  return `${prefix} current ${currentWorkflow}, scored ${recommended} -- upscale recommended`
}

/**
 * Render a one-line status line summarizing the complexity score.
 *
 * Returns the empty string when `score` is null/undefined.
 *
 * Output form (cyan "Complexity:" label, code 36):
 *   "Complexity: <tier> (N file[s]) -- recommended: <workflow>"
 */
export function renderStatusLine(
  score: ComplexityScore | null | undefined,
): string {
  if (score === null || score === undefined) return ''

  const label = color('Complexity:', 36)
  const fileCount = score.signals.file_count
  const fileWord = fileCount === 1 ? 'file' : 'files'
  return `${label} ${score.recommended_workflow} (${fileCount} ${fileWord}) -- recommended: ${score.recommended_workflow}`
}
