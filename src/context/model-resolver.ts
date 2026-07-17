import type { ModelAlias, ModelProfile, ModelsConfig } from '../schemas/project-config.js'

/**
 * Agent role short names, matching the `metta-` prefix-stripped agent names used by
 * AGENT_CONTEXT_BUDGETS in src/cli/commands/instructions.ts. Defined locally (not
 * imported from instructions.ts) to avoid a cli->context reverse dependency.
 * Any other role string is legal input and falls through to the non-executor branch.
 */
export type AgentRole =
  | 'proposer'
  | 'specifier'
  | 'product'
  | 'researcher'
  | 'architect'
  | 'planner'
  | 'executor'
  | 'verifier'
  | 'reviewer'
  | (string & {})

/** Planning-cohort roles: hard inherit path, never looked up in config. */
const PLANNING_COHORT = new Set<string>([
  'proposer',
  'specifier',
  'product',
  'researcher',
  'architect',
  'planner',
])

/** Named-profile expansion table (design.md Data Model section). */
const PROFILE_MAP: Record<ModelProfile, { trivial: ModelAlias; quick: ModelAlias }> = {
  quality: { trivial: 'inherit', quick: 'inherit' },
  balanced: { trivial: 'sonnet', quick: 'sonnet' },
  budget: { trivial: 'haiku', quick: 'sonnet' },
}

/**
 * Resolve the model alias an agent should run under for a given workflow tier.
 *
 * Pure function — no I/O. Planning-cohort roles and reviewer/verifier are hard
 * inherit paths that never read modelsConfig; only the executor at trivial/quick
 * tier can resolve to a non-inherit value, with an explicit executor map entry
 * winning over the named profile's expansion for that tier key.
 */
export function resolveAgentModel(
  role: AgentRole,
  workflowTier: string,
  modelsConfig: ModelsConfig | undefined
): ModelAlias {
  if (PLANNING_COHORT.has(role)) return 'inherit'
  if (role === 'reviewer' || role === 'verifier') return 'inherit'
  if (role !== 'executor') return 'inherit'
  if (!modelsConfig || (workflowTier !== 'trivial' && workflowTier !== 'quick')) return 'inherit'
  const explicit = modelsConfig.executor?.[workflowTier]
  if (explicit) return explicit
  if (modelsConfig.profile) return PROFILE_MAP[modelsConfig.profile]?.[workflowTier] ?? 'inherit'
  return 'inherit'
}
