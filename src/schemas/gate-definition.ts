import { z } from 'zod'

export const GateDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  command: z.string(),
  timeout: z.number().int().positive().default(120000),
  required: z.boolean().default(true),
  on_failure: z.enum(['retry_once', 'stop', 'continue_with_warning']).default('retry_once'),
}).strict()

export type GateDefinition = z.infer<typeof GateDefinitionSchema>
