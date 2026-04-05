import { z } from 'zod'
import { GateResultSchema } from './gate-result.js'

export const DeviationSchema = z.object({
  rule: z.number().int().min(1).max(4),
  description: z.string(),
  commit: z.string().optional(),
  files: z.array(z.string()).optional(),
  action: z.enum(['fixed', 'added', 'stopped']).optional(),
  reason: z.string().optional(),
}).strict()

export type Deviation = z.infer<typeof DeviationSchema>

export const TaskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'complete',
  'failed',
  'skipped',
])

export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const ExecutionTaskSchema = z.object({
  id: z.string(),
  status: TaskStatusSchema,
  commit: z.string().optional(),
  worktree: z.string().optional(),
  gates: z.record(z.string(), z.enum(['pass', 'fail', 'warn', 'skip'])).optional(),
  deviations: z.array(DeviationSchema).optional(),
}).strict()

export type ExecutionTask = z.infer<typeof ExecutionTaskSchema>

export const ExecutionBatchSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['pending', 'in_progress', 'complete', 'failed']),
  tasks: z.array(ExecutionTaskSchema),
}).strict()

export type ExecutionBatch = z.infer<typeof ExecutionBatchSchema>

export const ExecutionStateSchema = z.object({
  change: z.string(),
  started: z.string().datetime(),
  batches: z.array(ExecutionBatchSchema),
  deviations: z.array(DeviationSchema),
}).strict()

export type ExecutionState = z.infer<typeof ExecutionStateSchema>
