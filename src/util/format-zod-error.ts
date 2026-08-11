import type { ZodError, ZodIssue } from 'zod'

/**
 * Replace control characters (which Zod messages can echo verbatim from
 * hostile input values, e.g. a raw ESC byte enabling ANSI escape injection)
 * with their `\uXXXX` escape sequence. Newline and tab are excluded so
 * legitimate multi-line messages survive.
 */
function escapeControlCharacters(text: string): string {
  return text.replace(
    /[\x00-\x08\x0b-\x1f\x7f]/g,
    ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/**
 * Render a single Zod issue as a `path: message` line.
 * Issues with an empty path render as the bare message (no leading `: `).
 */
function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.join('.')
  const line = path.length > 0 ? `${path}: ${issue.message}` : issue.message
  return escapeControlCharacters(line)
}

/**
 * Canonical human-readable rendering of a `ZodError`: one `path: message`
 * line per issue, joined with newlines.
 *
 * Lives in `util/` so both the config layer (env-override warnings) and the
 * CLI edge (`handleError`) share a single rendering of Zod issues instead of
 * leaking the JSON-serialized issues array in `err.message`.
 *
 * @param prefix Optional string prepended to every line (e.g. `'  - '` for
 *               bulleted warning output).
 */
export function formatZodError(err: ZodError, options?: { prefix?: string }): string {
  const prefix = options?.prefix ?? ''
  return err.issues.map(issue => `${prefix}${formatZodIssue(issue)}`).join('\n')
}
