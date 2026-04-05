import { z } from 'zod'

export const ArtifactStatusSchema = z.enum([
  'pending',
  'ready',
  'in_progress',
  'complete',
  'failed',
  'skipped',
])

export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>

export const ChangeStatusSchema = z.enum([
  'active',
  'paused',
  'complete',
  'abandoned',
])

export type ChangeStatus = z.infer<typeof ChangeStatusSchema>

export const ChangeMetadataSchema = z.object({
  workflow: z.string(),
  created: z.string().datetime(),
  status: ChangeStatusSchema,
  current_artifact: z.string(),
  base_versions: z.record(z.string(), z.string()),
  artifacts: z.record(z.string(), ArtifactStatusSchema),
}).strict()

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>
