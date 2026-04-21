/**
 * Format a millisecond duration for compact display in `metta progress` /
 * `metta status`. Rounds to the nearest second and chooses the smallest
 * unit combination that fits:
 *   - under 60 s → `<N>s`
 *   - under 1 h → `<N>m <N>s`
 *   - 1 h or more → `<N>h <N>m`
 *
 * Negative inputs are clamped to `0s` so renderers never emit minus signs
 * (which would almost always indicate a clock-skew bug, not a useful
 * datum).
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return `${hours}h ${remMinutes}m`
}
