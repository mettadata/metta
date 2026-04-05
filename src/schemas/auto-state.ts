import { z } from 'zod'

export const AutoCycleSchema = z.object({
  id: z.number().int().positive(),
  phase: z.string(),
  artifacts: z.array(z.string()),
  batches_run: z.number().int().nonnegative(),
  verification: z.object({
    total_scenarios: z.number().int().nonnegative(),
    passing: z.number().int().nonnegative(),
    failing: z.number().int().nonnegative(),
    gaps: z.array(z.string()),
  }).strict().optional(),
}).strict()

export type AutoCycle = z.infer<typeof AutoCycleSchema>

export const AutoStateSchema = z.object({
  description: z.string(),
  started: z.string().datetime(),
  max_cycles: z.number().int().positive(),
  current_cycle: z.number().int().positive(),
  cycles: z.array(AutoCycleSchema),
}).strict()

export type AutoState = z.infer<typeof AutoStateSchema>
