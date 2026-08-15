import { z } from 'zod'
import { SLUG_RE } from '../util/slug.js'

// Frontmatter layer for files under spec/issues/ and spec/issues/resolved/.
// All fields are optional with documented defaults — a frontmatter-less file
// is semantically { type: 'issue', backlog: false }. Strictness ensures
// unknown keys surface as Zod `unrecognized_keys` issues.
export const IssueFrontmatterSchema = z.object({
  type: z.enum(['issue', 'idea']).default('issue'),
  backlog: z.boolean().default(false),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  milestone: z.string().regex(SLUG_RE).optional(),
  order: z.number().optional(),
}).strict()

export type IssueFrontmatter = z.infer<typeof IssueFrontmatterSchema>
export type IssueFrontmatterPatch = Partial<z.input<typeof IssueFrontmatterSchema>>
