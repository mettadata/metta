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

export const ComplexityScoreSchema = z.object({
  score: z.number().int().min(0).max(3),
  signals: z.object({
    file_count: z.number().int().min(0),
  }).strict(),
  recommended_workflow: z.enum(['trivial', 'quick', 'standard', 'full']),
}).strict()

export type ComplexityScore = z.infer<typeof ComplexityScoreSchema>

export const ChangeMetadataSchema = z.object({
  workflow: z.string(),
  created: z.string().datetime(),
  status: ChangeStatusSchema,
  current_artifact: z.string(),
  base_versions: z.record(z.string(), z.string()),
  artifacts: z.record(z.string(), ArtifactStatusSchema),
  complexity_score: ComplexityScoreSchema.optional(),
  actual_complexity_score: ComplexityScoreSchema.optional(),
  auto_accept_recommendation: z.boolean().optional(),
  workflow_locked: z.boolean().optional(),
}).strict()

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>
