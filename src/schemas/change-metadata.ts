import { z } from 'zod'
import { ModelAliasEnum } from './project-config.js'

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

export const ArtifactTimingSchema = z.object({
  started: z.string().datetime().optional(),
  completed: z.string().datetime().optional(),
}).strict()

export type ArtifactTiming = z.infer<typeof ArtifactTimingSchema>

export const ArtifactTokensSchema = z.object({
  context: z.number().int().nonnegative(),
  budget: z.number().int().nonnegative(),
}).strict()

export type ArtifactTokens = z.infer<typeof ArtifactTokensSchema>

export const EscalationSchema = z.object({
  from_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  to_tier: z.enum(['trivial', 'quick', 'standard', 'full']),
  justification: z.string().min(1),
  timestamp: z.string().datetime(),
}).strict()

export type Escalation = z.infer<typeof EscalationSchema>

export const ModelEscalationSchema = z.object({
  task: z.string().min(1),
  from_model: ModelAliasEnum,
  to_model: ModelAliasEnum,
  trigger: z.enum(['stop_deviation', 'verify_fail']),
  timestamp: z.string().datetime(),
}).strict()

export type ModelEscalation = z.infer<typeof ModelEscalationSchema>

export const ModelRunSchema = z.object({
  task: z.string().min(1),
  model: ModelAliasEnum,
  timestamp: z.string().datetime(),
}).strict()

export type ModelRun = z.infer<typeof ModelRunSchema>

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
  artifact_timings: z.record(z.string(), ArtifactTimingSchema).optional(),
  artifact_tokens: z.record(z.string(), ArtifactTokensSchema).optional(),
  review_iterations: z.number().int().nonnegative().optional(),
  verify_iterations: z.number().int().nonnegative().optional(),
  stop_after: z.string().optional(),
  escalation: EscalationSchema.optional(),
  model_escalations: z.array(ModelEscalationSchema).optional(),
  model_runs: z.array(ModelRunSchema).optional(),
}).strict()

export type ChangeMetadata = z.infer<typeof ChangeMetadataSchema>
