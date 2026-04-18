// Shared slug validation for store methods that build filesystem paths from
// user-supplied slugs. Single source of truth — was duplicated in
// issues-store.ts, backlog-store.ts, and cli/commands/backlog.ts.

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

export function assertSafeSlug(slug: string, label = 'slug'): void {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid ${label} '${slug}' — must match ${SLUG_RE}`)
  }
}

export interface ToSlugOptions {
  maxLen?: number
  stopWords?: Set<string>
}

export function toSlug(input: string, opts: ToSlugOptions = {}): string {
  const maxLen = opts.maxLen ?? 60
  const stopWords = opts.stopWords

  let slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  if (stopWords) {
    slug = slug.split('-').filter(w => w && !stopWords.has(w)).join('-')
  }

  if (slug.length === 0) {
    throw new Error('toSlug: input produced empty slug')
  }

  if (slug.length <= maxLen) {
    return slug.replace(/-$/, '')
  }

  // Word-boundary truncation
  const lastHyphen = slug.lastIndexOf('-', maxLen)
  if (lastHyphen > 0) {
    return slug.slice(0, lastHyphen)
  }

  // No word boundary fits — single long word. Hard truncate.
  const hard = slug.slice(0, maxLen).replace(/-$/, '')
  if (hard.length === 0) {
    throw new Error('toSlug: input produced empty slug after hard truncate')
  }
  return hard
}
