import { z } from 'zod'

export const PluginManifestSchema = z.object({
  type: z.enum(['workflow', 'agent', 'provider', 'gate', 'hook']),
  name: z.string().regex(/^[a-z0-9-]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string(),
  requires: z.object({
    metta: z.string().optional(),
    plugins: z.array(z.string()).optional(),
  }).strict().optional(),
}).strict()

export type PluginManifest = z.infer<typeof PluginManifestSchema>
