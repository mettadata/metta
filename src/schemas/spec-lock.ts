import { z } from 'zod'

export const SpecLockRequirementSchema = z.object({
  id: z.string(),
  hash: z.string(),
  scenarios: z.array(z.string()),
}).strict()

export type SpecLockRequirement = z.infer<typeof SpecLockRequirementSchema>

export const ReconciliationStatusSchema = z.enum([
  'verified',
  'partial',
  'missing',
  'unimplemented',
  'diverged',
  'undocumented',
])

export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>

export const ReconciliationRequirementSchema = z.object({
  id: z.string(),
  status: ReconciliationStatusSchema,
  gaps: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
}).strict()

export type ReconciliationRequirement = z.infer<typeof ReconciliationRequirementSchema>

export const ReconciliationSchema = z.object({
  verified_at: z.string().datetime(),
  requirements: z.array(ReconciliationRequirementSchema),
}).strict()

export type Reconciliation = z.infer<typeof ReconciliationSchema>

export const SpecLockSchema = z.object({
  version: z.number().int().positive(),
  hash: z.string(),
  updated: z.string().datetime(),
  status: z.enum(['draft', 'reviewed', 'approved']).optional(),
  source: z.enum(['scan', 'manual', 'change']).optional(),
  scanned_from: z.array(z.string()).optional(),
  uncovered_behaviors: z.number().int().nonnegative().optional(),
  reconciliation: ReconciliationSchema.optional(),
  requirements: z.array(SpecLockRequirementSchema),
}).strict()

export type SpecLock = z.infer<typeof SpecLockSchema>
