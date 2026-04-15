import { z } from 'zod'

export const SeveritySchema = z.enum(['critical', 'major', 'minor'])
export type ViolationSeverity = z.infer<typeof SeveritySchema>

export const ViolationSchema = z.object({
  article: z.string().min(1),
  severity: SeveritySchema,
  evidence: z.string().min(1),
  suggestion: z.string().min(1),
})
export type Violation = z.infer<typeof ViolationSchema>

export const ViolationListSchema = z.object({
  violations: z.array(ViolationSchema),
})
export type ViolationList = z.infer<typeof ViolationListSchema>
