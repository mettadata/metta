import { z } from 'zod'

export const ProviderConfigSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  api_key_env: z.string().optional(),
}).strict()

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const GateConfigSchema = z.object({
  command: z.string(),
  timeout: z.number().int().positive().optional(),
  required: z.boolean().optional(),
  on_failure: z.enum(['retry_once', 'stop', 'continue_with_warning']).optional(),
}).strict()

export type GateConfig = z.infer<typeof GateConfigSchema>

export const GitConfigSchema = z.object({
  enabled: z.boolean().default(true),
  commit_convention: z.enum(['conventional', 'none', 'custom']).default('conventional'),
  commit_template: z.string().optional(),
  protected_branches: z.array(z.string()).default(['main', 'master']),
  merge_strategy: z.enum(['ff-only', 'no-ff', 'squash']).default('ff-only'),
  snapshot_retention: z.enum(['until_ship', 'always', 'never']).default('until_ship'),
  create_pr: z.boolean().default(false),
  pr_base: z.string().default('main'),
  worktree: z.object({
    enabled: z.boolean().default(true),
    dir: z.string().default('.metta/worktrees'),
  }).strict().default({}),
}).strict()

export type GitConfig = z.infer<typeof GitConfigSchema>

export const DocsConfigSchema = z.object({
  output: z.string().default('./docs'),
  generate_on: z.enum(['finalize', 'verify', 'manual']).default('finalize'),
  types: z.array(z.string()).default(['architecture', 'api', 'changelog', 'getting-started']),
}).strict()

export type DocsConfig = z.infer<typeof DocsConfigSchema>

export const UatConfigSchema = z.object({
  enabled: z.boolean().default(true),
  enforce_on_ship: z.boolean().default(true),
}).strict()

export type UatConfig = z.infer<typeof UatConfigSchema>

export const TokensConfigSchema = z.object({
  enabled: z.boolean().default(true),
}).strict()

export type TokensConfig = z.infer<typeof TokensConfigSchema>

export const AutoConfigSchema = z.object({
  max_cycles: z.number().int().positive().default(10),
  ship_on_success: z.boolean().default(false),
}).strict()

export type AutoConfig = z.infer<typeof AutoConfigSchema>

export const ProjectInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  stack: z.string().optional(),
  stacks: z.array(z.string()).optional(),
  conventions: z.string().optional(),
}).strict()

export type ProjectInfo = z.infer<typeof ProjectInfoSchema>

export const VerificationStrategyEnum = z.enum(['tmux_tui', 'playwright', 'cli_exit_codes', 'tests_only'])

export const VerificationConfigSchema = z.object({
  strategy: VerificationStrategyEnum,
  instructions: z.string().optional(),
}).strict()

export type VerificationConfig = z.infer<typeof VerificationConfigSchema>

export const ModelAliasEnum = z.enum(['sonnet', 'opus', 'haiku', 'fable', 'inherit'])

export type ModelAlias = z.infer<typeof ModelAliasEnum>

export const ModelProfileEnum = z.enum(['quality', 'balanced', 'budget'])

export type ModelProfile = z.infer<typeof ModelProfileEnum>

export const ModelsConfigSchema = z.object({
  profile: ModelProfileEnum.optional(),
  executor: z.object({
    trivial: ModelAliasEnum.optional(),
    quick: ModelAliasEnum.optional(),
  }).strict().optional(),
  reviewer: z.literal('inherit').optional(),
  verifier: z.literal('inherit').optional(),
}).strict().optional()

export type ModelsConfig = NonNullable<z.infer<typeof ModelsConfigSchema>>

export const ReleaseConfigSchema = z.object({
  scheme: z.literal('semver', {
    errorMap: () => ({ message: "release.scheme: only 'semver' is supported" }),
  }),
  version_file: z.string().min(1, {
    message: 'release.version_file: must be a non-empty path to the file holding the product version',
  }),
  tag_prefix: z.string().default('v'),
  github_release: z.boolean().default(false),
  on_ship: z.enum(['auto', 'prompt', 'off'], {
    errorMap: () => ({ message: "release.on_ship: must be one of 'auto', 'prompt', 'off'" }),
  }).default('auto'),
  allow_major_pre_1: z.boolean().default(false),
}).strict()

export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>

export const ProjectConfigSchema = z.object({
  project: ProjectInfoSchema.optional(),
  defaults: z.object({
    workflow: z.string().default('standard'),
    mode: z.enum(['interactive', 'autonomous', 'supervised']).default('supervised'),
  }).strict().optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  tools: z.array(z.string()).optional(),
  gates: z.record(z.string(), GateConfigSchema).optional(),
  git: GitConfigSchema.optional(),
  docs: DocsConfigSchema.default({}),
  uat: UatConfigSchema.default({}),
  tokens: TokensConfigSchema.default({}),
  auto: AutoConfigSchema.optional(),
  context_sections: z.array(z.string()).optional(),
  adapters: z.array(z.string()).optional(),
  cleanup: z.object({
    log_retention_days: z.number().int().positive().default(30),
  }).strict().optional(),
  verification: VerificationConfigSchema.optional(),
  models: ModelsConfigSchema,
  release: ReleaseConfigSchema.optional(),
  installed_version: z.string().optional(),
}).strict()

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>
