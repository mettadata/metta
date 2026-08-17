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

/** Highest tier the advisory banner will ever recommend upscaling to. */
const MAX_UPSCALE_TIER: Tier = 'standard'

/**
 * Render a one-line advisory banner comparing the current workflow tier
 * to the scored recommendation.
 *
 * Returns the empty string when `score` is null/undefined.
 *
 * Upscale advisories are capped at `MAX_UPSCALE_TIER` ('standard'): the
 * banner stays truthful about the scored tier but never recommends moving
 * above standard.
 *
 * Output forms (yellow "Advisory:" prefix, code 33):
 *   - agreement:       "Advisory: current workflow <tier> matches recommendation <tier>"
 *   - downscale:       "Advisory: current <chosen>, scored <recommended> -- downscale recommended"
 *   - upscale:         "Advisory: current <chosen>, scored <recommended> -- upscale recommended"
 *   - capped upscale:  "Advisory: current <chosen>, scored <recommended> -- upscale to standard recommended (<recommended> upscale not supported)"
 *   - capped at current: "Advisory: current standard, scored <recommended> -- <recommended> tier not supported; staying at standard"
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

  const capRank = tierRank(MAX_UPSCALE_TIER)
  if (recRank > capRank) {
    if (chosenRank >= capRank) {
      return `${prefix} current ${currentWorkflow}, scored ${recommended} -- ${recommended} tier not supported; staying at ${currentWorkflow}`
    }
    return `${prefix} current ${currentWorkflow}, scored ${recommended} -- upscale to ${MAX_UPSCALE_TIER} recommended (${recommended} upscale not supported)`
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
