import { z } from 'zod'

export const BumpLevelEnum = z.enum(['major', 'minor', 'patch'])

export type BumpLevel = z.infer<typeof BumpLevelEnum>

export const ReleaseEntrySchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  tag: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  bump: BumpLevelEnum.optional(),
  bump_source: z.enum(['derived', 'override']).optional(),
  backfilled: z.boolean().default(false),
  changes: z.array(z.string()),
}).strict()

export type ReleaseEntry = z.infer<typeof ReleaseEntrySchema>

export const ReleasesRecordSchema = z.object({
  releases: z.array(ReleaseEntrySchema),
}).strict()

export type ReleasesRecord = z.infer<typeof ReleasesRecordSchema>
