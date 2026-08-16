import { z } from 'zod'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// A `target` must be shaped like an ISO date AND name a real calendar day
// (e.g. 2026-02-30 is rejected). The round-trip through Date.UTC catches
// overflow dates that the regex alone would accept.
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

// Frontmatter for milestone files at spec/milestones/<slug>.md. The body
// below the frontmatter is the free-form description.
export const MilestoneFrontmatterSchema = z.object({
  name: z.string().min(1),
  target: z.string()
    .regex(ISO_DATE_RE)
    .refine(isRealCalendarDate, { message: 'target must be a real calendar date (YYYY-MM-DD)' })
    .optional(),
  status: z.enum(['open', 'closed']).default('open'),
}).strict()

export type MilestoneFrontmatter = z.infer<typeof MilestoneFrontmatterSchema>
