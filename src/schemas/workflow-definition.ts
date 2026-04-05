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

export const WorkflowOverrideSchema = z.object({
  id: z.string(),
  requires: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  gates: z.array(z.string()).optional(),
}).strict()

export type WorkflowOverride = z.infer<typeof WorkflowOverrideSchema>

export const WorkflowDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.number().int().positive(),
  extends: z.string().optional(),
  artifacts: z.array(WorkflowArtifactSchema),
  overrides: z.array(WorkflowOverrideSchema).optional(),
}).strict()

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>
