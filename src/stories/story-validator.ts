import type { StoriesDocument } from '../schemas/story.js'

export interface ValidationIssue {
  kind: 'missing_field' | 'broken_fulfills' | 'drift' | 'duplicate_id'
  severity: 'error' | 'warning'
  message: string
  storyId?: string
  fulfillsRef?: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
}

/**
 * Cross-validate spec.md Fulfills references against the stories document.
 *
 * Returns one `broken_fulfills` error per reference that does not resolve to a
 * known story. For sentinel documents any reference is broken (there are no
 * stories to fulfill).
 */
export function validateFulfillsRefs(
  fulfillsRefs: string[],
  stories: StoriesDocument,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const knownIds =
    stories.kind === 'stories' ? new Set(stories.stories.map((s) => s.id)) : new Set<string>()

  for (const ref of fulfillsRefs) {
    if (!knownIds.has(ref)) {
      issues.push({
        kind: 'broken_fulfills',
        severity: 'error',
        message:
          stories.kind === 'sentinel'
            ? `Fulfills reference "${ref}" cannot resolve: stories document is a sentinel (no stories).`
            : `Fulfills reference "${ref}" does not match any story in stories.md.`,
        fulfillsRef: ref,
      })
    }
  }

  return issues
}

/**
 * Detect drift between `stories.md` and `spec.md` by comparing modification
 * times (in milliseconds). Returns a `drift` warning when stories.md is newer
 * than spec.md, otherwise `null`.
 */
export function detectDrift(storiesMtime: number, specMtime: number): ValidationIssue | null {
  if (storiesMtime > specMtime) {
    return {
      kind: 'drift',
      severity: 'warning',
      message: 'stories.md is newer than spec.md — consider re-deriving spec.',
    }
  }
  return null
}
