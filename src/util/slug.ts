// Shared slug validation for store methods that build filesystem paths from
// user-supplied slugs. Single source of truth — was duplicated in
// issues-store.ts, backlog-store.ts, and cli/commands/backlog.ts.

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/

export function assertSafeSlug(slug: string, label = 'slug'): void {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`Invalid ${label} '${slug}' — must match ${SLUG_RE}`)
  }
}
