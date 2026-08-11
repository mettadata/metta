import type { ZodError, ZodIssue } from 'zod'

/**
 * Render a single Zod issue as a `path: message` line.
 * Issues with an empty path render as the bare message (no leading `: `).
 */
function formatZodIssue(issue: ZodIssue): string {
  const path = issue.path.join('.')
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message
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
