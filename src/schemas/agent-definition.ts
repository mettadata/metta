import { z } from 'zod'

export const BashToolConfigSchema = z.object({
  deny_patterns: z.array(z.string()).optional(),
  allow_cwd: z.enum(['worktree_only', 'any']).optional(),
}).strict()

export type BashToolConfig = z.infer<typeof BashToolConfigSchema>

export const ToolEntrySchema = z.union([
  z.string(),
  z.record(z.string(), BashToolConfigSchema),
])

export type ToolEntry = z.infer<typeof ToolEntrySchema>

export const AgentDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  version: z.number().int().positive().optional(),
  persona: z.string(),
  capabilities: z.array(z.string()).optional(),
  tools: z.array(ToolEntrySchema),
  context_budget: z.number().int().positive(),
  rules: z.array(z.string()).optional(),
}).strict()

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>

/**
 * Subset of AgentDefinitionSchema covering exactly the fields the runtime
 * agent-registry loader parses out of an agent template's frontmatter + body
 * (`name:`, `tools:`, and the pre-heading persona paragraph). Kept co-located
 * with AgentDefinitionSchema so the two shapes cannot drift silently.
 */
export const AgentFrontmatterSchema = z.object({
  name: z.string().min(1),
  persona: z.string().min(1),
  tools: z.array(z.string()),
}).strict()

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>
