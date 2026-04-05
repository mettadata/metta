import { z } from 'zod'
import { ExecutionStateSchema } from './execution-state.js'
import { AutoStateSchema } from './auto-state.js'

export const StateFileSchema = z.object({
  schema_version: z.number().int().positive().default(1),
  execution: ExecutionStateSchema.optional(),
  auto: AutoStateSchema.optional(),
}).strict()

export type StateFile = z.infer<typeof StateFileSchema>
