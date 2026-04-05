/**
 * Character-based token estimator: 4 characters ≈ 1 token.
 * Fast, no dependencies, accurate enough for budget enforcement.
 * Tuned for English and code; CJK or emoji-heavy content may undercount by 2-3x.
 */
export function countTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
