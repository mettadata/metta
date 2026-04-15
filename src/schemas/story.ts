import { z } from 'zod'

export const PrioritySchema = z.enum(['P1', 'P2', 'P3'])
export type Priority = z.infer<typeof PrioritySchema>

export const AcceptanceCriterionSchema = z.object({
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
})
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>

export const StorySchema = z.object({
  id: z.string().regex(/^US-\d+$/, 'Story ID must match US-N (e.g. US-1)'),
  title: z.string().min(1),
  asA: z.string().min(1),
  iWantTo: z.string().min(1),
  soThat: z.string().min(1),
  priority: PrioritySchema,
  independentTestCriteria: z.string().min(1),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
})
export type Story = z.infer<typeof StorySchema>

export const StoriesDocumentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stories'), stories: z.array(StorySchema).min(1) }),
  z.object({ kind: z.literal('sentinel'), justification: z.string().min(10) }),
])
export type StoriesDocument = z.infer<typeof StoriesDocumentSchema>
