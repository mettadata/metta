import { z } from 'zod'

export const WorkflowArtifactSchema = z.object({
  id: z.string(),
  type: z.string(),
  template: z.string(),
  generates: z.string(),
  requires: z.array(z.string()),
  agents: z.array(z.string()),
  gates: z.array(z.string()),
}).strict()

export type WorkflowArtifact = z.infer<typeof WorkflowArtifactSchema>

export const WorkflowDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.number().int().positive(),
  artifacts: z.array(WorkflowArtifactSchema),
}).strict()

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>
