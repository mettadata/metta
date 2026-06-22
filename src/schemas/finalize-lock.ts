import { z } from 'zod'

export const FinalizeLockSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string(),
  change: z.string(),
}).strict()

export type FinalizeLock = z.infer<typeof FinalizeLockSchema>
