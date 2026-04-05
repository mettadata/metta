import { z } from 'zod'

export const GateFailureSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
}).strict()

export type GateFailure = z.infer<typeof GateFailureSchema>

export const GateResultSchema = z.object({
  gate: z.string(),
  status: z.enum(['pass', 'fail', 'warn', 'skip']),
  duration_ms: z.number(),
  output: z.string().optional(),
  failures: z.array(GateFailureSchema).optional(),
}).strict()

export type GateResult = z.infer<typeof GateResultSchema>
