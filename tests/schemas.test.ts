import { describe, it, expect } from 'vitest'
import {
  ChangeMetadataSchema,
  SpecLockSchema,
  SpecLockRequirementSchema,
  ReconciliationRequirementSchema,
  ExecutionStateSchema,
  DeviationSchema,
  ExecutionTaskSchema,
  ExecutionBatchSchema,
  AutoStateSchema,
  ProjectConfigSchema,
  GateResultSchema,
  GateFailureSchema,
  WorkflowDefinitionSchema,
  AgentDefinitionSchema,
  GateDefinitionSchema,
  PluginManifestSchema,
  StateFileSchema,
  ViolationSchema,
  ViolationListSchema,
  SeveritySchema,
} from '../src/schemas/index.js'

describe('ChangeMetadataSchema', () => {
  it('validates a valid change metadata object', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: { 'auth/spec.md': 'sha256:abc123' },
      artifacts: {
        intent: 'complete',
        spec: 'in_progress',
        design: 'pending',
      },
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects unknown fields (.strict())', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      extra_field: 'should fail',
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid status values', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'invalid',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid artifact status values', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: { intent: 'invalid_status' },
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid datetime strings', () => {
    const data = {
      workflow: 'standard',
      created: 'not-a-date',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })
})

describe('SpecLockSchema', () => {
  it('validates a valid spec lock', () => {
    const data = {
      version: 3,
      hash: 'sha256:e3b0c44298',
      updated: '2026-04-04T12:00:00Z',
      requirements: [
        { id: 'user-login', hash: 'sha256:a1b2c3', scenarios: ['successful-login', 'invalid-password'] },
        { id: 'session-management', hash: 'sha256:d4e5f6', scenarios: ['session-expiry'] },
      ],
    }
    const result = SpecLockSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates with optional reconciliation', () => {
    const data = {
      version: 1,
      hash: 'sha256:abc',
      updated: '2026-04-05T14:00:00Z',
      status: 'draft',
      source: 'scan',
      scanned_from: ['src/app/api/auth/'],
      reconciliation: {
        verified_at: '2026-04-05T14:00:00Z',
        requirements: [
          { id: 'checkout-flow', status: 'verified', evidence: ['src/app/api/checkout/'] },
          { id: 'refund-processing', status: 'partial', gaps: ['partial refunds not implemented'] },
        ],
      },
      requirements: [
        { id: 'checkout-flow', hash: 'sha256:xyz', scenarios: ['success'] },
      ],
    }
    const result = SpecLockSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects version <= 0', () => {
    const data = {
      version: 0,
      hash: 'sha256:abc',
      updated: '2026-04-04T12:00:00Z',
      requirements: [],
    }
    const result = SpecLockSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid reconciliation requirement status', () => {
    const result = SpecLockSchema.safeParse({
      version: 1, hash: 'sha256:abc', updated: '2026-04-04T12:00:00Z',
      reconciliation: {
        verified_at: '2026-04-04T12:00:00Z',
        requirements: [{ id: 'r1', status: 'unknown' }],
      },
      requirements: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid status enum value', () => {
    const result = SpecLockSchema.safeParse({
      version: 1, hash: 'sha256:abc', updated: '2026-04-04T12:00:00Z',
      status: 'pending', requirements: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid source enum value', () => {
    const result = SpecLockSchema.safeParse({
      version: 1, hash: 'sha256:abc', updated: '2026-04-04T12:00:00Z',
      source: 'auto', requirements: [],
    })
    expect(result.success).toBe(false)
  })
})

describe('ExecutionStateSchema', () => {
  it('validates execution state with batches and deviations', () => {
    const data = {
      change: 'add-mfa',
      started: '2026-04-04T12:00:00Z',
      batches: [
        {
          id: 1,
          status: 'complete',
          tasks: [
            { id: '1.1', status: 'complete', commit: 'abc123f', gates: { tests: 'pass', lint: 'pass' } },
          ],
        },
        {
          id: 2,
          status: 'in_progress',
          tasks: [
            { id: '2.1', status: 'in_progress', worktree: '/tmp/metta-worktree-2.1' },
            { id: '2.2', status: 'pending' },
          ],
        },
      ],
      deviations: [
        {
          rule: 1,
          description: 'Fixed null check in auth middleware',
          commit: 'abc123f',
          files: ['src/auth/middleware.ts'],
        },
      ],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects deviation rules outside 1-4 range', () => {
    const data = {
      change: 'test',
      started: '2026-04-04T12:00:00Z',
      batches: [],
      deviations: [{ rule: 5, description: 'invalid' }],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects when change is omitted', () => {
    const data = {
      started: '2026-04-04T12:00:00Z',
      batches: [],
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects when started is omitted', () => {
    const data = {
      change: 'test',
      batches: [],
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects when started is an invalid datetime', () => {
    const data = {
      change: 'test',
      started: 'not-a-date',
      batches: [],
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects when batches is omitted', () => {
    const data = {
      change: 'test',
      started: '2026-04-04T12:00:00Z',
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects when deviations is omitted', () => {
    const data = {
      change: 'test',
      started: '2026-04-04T12:00:00Z',
      batches: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid task status enum', () => {
    const data = {
      change: 'test',
      started: '2026-04-04T12:00:00Z',
      batches: [
        { id: 1, status: 'complete', tasks: [{ id: '1.1', status: 'cancelled' }] },
      ],
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid batch status enum', () => {
    const data = {
      change: 'test',
      started: '2026-04-04T12:00:00Z',
      batches: [
        { id: 1, status: 'cancelled', tasks: [] },
      ],
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects batch id that is zero or negative', () => {
    const data = {
      change: 'test',
      started: '2026-04-04T12:00:00Z',
      batches: [
        { id: 0, status: 'pending', tasks: [] },
      ],
      deviations: [],
    }
    const result = ExecutionStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })
})

describe('AutoStateSchema', () => {
  const validAutoState = {
    description: 'build payment system',
    started: '2026-04-04T12:00:00Z',
    max_cycles: 10,
    current_cycle: 2,
    cycles: [
      {
        id: 1,
        phase: 'complete',
        artifacts: ['intent', 'spec', 'design', 'tasks'],
        batches_run: 3,
        verification: {
          total_scenarios: 14,
          passing: 11,
          failing: 3,
          gaps: ['MFA challenge timeout'],
        },
      },
    ],
  }

  it('validates auto mode state', () => {
    const result = AutoStateSchema.safeParse(validAutoState)
    expect(result.success).toBe(true)
  })

  it('rejects when description is missing', () => {
    const { description, ...data } = validAutoState
    const result = AutoStateSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects when started is not a valid datetime', () => {
    const result = AutoStateSchema.safeParse({ ...validAutoState, started: 'yesterday' })
    expect(result.success).toBe(false)
  })

  it('rejects when max_cycles is zero', () => {
    const result = AutoStateSchema.safeParse({ ...validAutoState, max_cycles: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects when max_cycles is negative', () => {
    const result = AutoStateSchema.safeParse({ ...validAutoState, max_cycles: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects when current_cycle is zero', () => {
    const result = AutoStateSchema.safeParse({ ...validAutoState, current_cycle: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects when a cycle batches_run is negative', () => {
    const result = AutoStateSchema.safeParse({
      ...validAutoState,
      cycles: [{ id: 1, phase: 'complete', artifacts: [], batches_run: -1 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects when verification.failing is negative', () => {
    const result = AutoStateSchema.safeParse({
      ...validAutoState,
      cycles: [{
        id: 1, phase: 'complete', artifacts: [], batches_run: 0,
        verification: { total_scenarios: 5, passing: 5, failing: -1, gaps: [] },
      }],
    })
    expect(result.success).toBe(false)
  })
})

describe('ProjectConfigSchema', () => {
  it('validates a minimal config', () => {
    const data = {
      project: { name: 'My App' },
    }
    const result = ProjectConfigSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates a full config', () => {
    const data = {
      project: {
        name: 'My App',
        description: 'E-commerce platform',
        stack: 'Next.js, Prisma, PostgreSQL',
      },
      defaults: {
        workflow: 'full',
        mode: 'supervised',
      },
      providers: {
        main: { provider: 'anthropic', model: 'claude-opus-4-6-20250415' },
      },
      tools: ['claude-code'],
      gates: {
        tests: { command: 'npm test', timeout: 120000 },
      },
      git: {
        enabled: true,
        commit_convention: 'conventional',
        protected_branches: ['main'],
        merge_strategy: 'ff-only',
        snapshot_retention: 'until_ship',
        create_pr: false,
        pr_base: 'main',
      },
      docs: {
        output: './docs',
        generate_on: 'finalize',
        types: ['architecture', 'api'],
      },
      auto: {
        max_cycles: 10,
        ship_on_success: false,
      },
    }
    const result = ProjectConfigSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('applies defaults for git config', () => {
    const data = {
      git: {},
    }
    const result = ProjectConfigSchema.parse(data)
    expect(result.git?.enabled).toBe(true)
    expect(result.git?.commit_convention).toBe('conventional')
    expect(result.git?.merge_strategy).toBe('ff-only')
  })

  it('rejects unknown fields (.strict())', () => {
    const data = {
      project: { name: 'App', unknown: true },
    }
    const result = ProjectConfigSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid defaults.mode enum value', () => {
    const result = ProjectConfigSchema.safeParse({
      defaults: { mode: 'manual' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid git.merge_strategy enum value', () => {
    const result = ProjectConfigSchema.safeParse({
      git: { merge_strategy: 'rebase' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid git.commit_convention enum value', () => {
    const result = ProjectConfigSchema.safeParse({
      git: { commit_convention: 'angular' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts context_sections, adapters, and cleanup fields', () => {
    const result = ProjectConfigSchema.safeParse({
      context_sections: ['architecture', 'api'],
      adapters: ['jira'],
      cleanup: { log_retention_days: 7 },
    })
    expect(result.success).toBe(true)
  })

  it('applies default cleanup.log_retention_days of 30', () => {
    const result = ProjectConfigSchema.parse({ cleanup: {} })
    expect(result.cleanup?.log_retention_days).toBe(30)
  })
})

describe('GateResultSchema', () => {
  it('validates a passing gate result', () => {
    const data = {
      gate: 'tests',
      status: 'pass',
      duration_ms: 1234,
    }
    const result = GateResultSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates a failing gate result with failures', () => {
    const data = {
      gate: 'lint',
      status: 'fail',
      duration_ms: 567,
      output: 'ESLint found 2 errors',
      failures: [
        { file: 'src/index.ts', line: 10, message: 'no-unused-vars', severity: 'error' },
      ],
    }
    const result = GateResultSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects invalid status enum value', () => {
    const result = GateResultSchema.safeParse({ gate: 'tests', status: 'success', duration_ms: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects when duration_ms is missing', () => {
    const result = GateResultSchema.safeParse({ gate: 'tests', status: 'pass' })
    expect(result.success).toBe(false)
  })

  it('rejects when gate is missing', () => {
    const result = GateResultSchema.safeParse({ status: 'pass', duration_ms: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects a GateFailure with invalid severity', () => {
    const result = GateResultSchema.safeParse({
      gate: 'lint', status: 'fail', duration_ms: 100,
      failures: [{ file: 'a.ts', message: 'bad', severity: 'critical' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('WorkflowDefinitionSchema', () => {
  it('validates a standard workflow definition', () => {
    const data = {
      name: 'standard',
      version: 1,
      artifacts: [
        { id: 'intent', type: 'intent', template: 'intent.md', generates: 'intent.md', requires: [], agents: ['proposer'], gates: [] },
        { id: 'spec', type: 'spec', template: 'spec.md', generates: 'spec.md', requires: ['intent'], agents: ['specifier'], gates: ['spec-quality'] },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates workflow with extends and overrides', () => {
    const data = {
      name: 'extended',
      version: 1,
      extends: 'standard',
      artifacts: [
        { id: 'domain-research', type: 'domain-research', template: 'dr.md', generates: 'dr.md', requires: [], agents: ['researcher'], gates: [] },
      ],
      overrides: [
        { id: 'intent', requires: ['domain-research'] },
      ],
    }
    const result = WorkflowDefinitionSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects when version is zero or negative', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'test', version: 0, artifacts: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a WorkflowArtifact missing a required field (generates)', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'test', version: 1,
      artifacts: [{ id: 'a', type: 'a', template: 'a.md', requires: [], agents: [], gates: [] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields on WorkflowArtifactSchema (.strict())', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'test', version: 1,
      artifacts: [{ id: 'a', type: 'a', template: 'a.md', generates: 'a.md', requires: [], agents: [], gates: [], extra: true }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields on WorkflowOverrideSchema (.strict())', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'test', version: 1, artifacts: [],
      overrides: [{ id: 'a', unknown_field: true }],
    })
    expect(result.success).toBe(false)
  })
})

describe('AgentDefinitionSchema', () => {
  it('validates an agent with string tools', () => {
    const data = {
      name: 'architect',
      persona: 'You are a senior systems architect.',
      capabilities: ['design', 'review'],
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
      context_budget: 80000,
    }
    const result = AgentDefinitionSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates an agent with Bash tool config', () => {
    const data = {
      name: 'executor',
      persona: 'You are an executor.',
      capabilities: ['implementation'],
      tools: [
        'Read', 'Write', 'Edit',
        { Bash: { deny_patterns: ['git checkout main'], allow_cwd: 'worktree_only' } },
      ],
      context_budget: 10000,
      rules: ['Do not modify shared code without approval'],
    }
    const result = AgentDefinitionSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects when persona is missing', () => {
    const result = AgentDefinitionSchema.safeParse({
      name: 'test', capabilities: ['a'], tools: ['Read'], context_budget: 1000,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when capabilities is missing', () => {
    const result = AgentDefinitionSchema.safeParse({
      name: 'test', persona: 'You are a test.', tools: ['Read'], context_budget: 1000,
    })
    expect(result.success).toBe(false)
  })

  it('rejects when context_budget is zero or negative', () => {
    const result = AgentDefinitionSchema.safeParse({
      name: 'test', persona: 'p', capabilities: ['a'], tools: ['Read'], context_budget: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects BashToolConfig with unknown fields (.strict())', () => {
    const result = AgentDefinitionSchema.safeParse({
      name: 'test', persona: 'p', capabilities: ['a'],
      tools: [{ Bash: { allow_cwd: 'worktree_only', unknown: true } }],
      context_budget: 1000,
    })
    expect(result.success).toBe(false)
  })

  it('rejects BashToolConfig with invalid allow_cwd enum', () => {
    const result = AgentDefinitionSchema.safeParse({
      name: 'test', persona: 'p', capabilities: ['a'],
      tools: [{ Bash: { allow_cwd: 'everywhere' } }],
      context_budget: 1000,
    })
    expect(result.success).toBe(false)
  })
})

describe('GateDefinitionSchema', () => {
  it('validates a gate definition with defaults', () => {
    const data = {
      name: 'tests',
      description: 'Run project test suite',
      command: 'npm test',
    }
    const result = GateDefinitionSchema.parse(data)
    expect(result.timeout).toBe(120000)
    expect(result.required).toBe(true)
    expect(result.on_failure).toBe('retry_once')
  })

  it('rejects when name is missing', () => {
    const result = GateDefinitionSchema.safeParse({ description: 'desc', command: 'npm test' })
    expect(result.success).toBe(false)
  })

  it('rejects when description is missing', () => {
    const result = GateDefinitionSchema.safeParse({ name: 'tests', command: 'npm test' })
    expect(result.success).toBe(false)
  })

  it('rejects when command is missing', () => {
    const result = GateDefinitionSchema.safeParse({ name: 'tests', description: 'desc' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid on_failure enum value', () => {
    const result = GateDefinitionSchema.safeParse({
      name: 'tests', description: 'desc', command: 'npm test', on_failure: 'abort',
    })
    expect(result.success).toBe(false)
  })

  it('rejects when timeout is zero or negative', () => {
    const result = GateDefinitionSchema.safeParse({
      name: 'tests', description: 'desc', command: 'npm test', timeout: 0,
    })
    expect(result.success).toBe(false)
  })
})

describe('PluginManifestSchema', () => {
  it('validates a plugin manifest', () => {
    const data = {
      type: 'gate',
      name: 'quality-gates',
      version: '1.0.0',
      description: 'Additional quality gates',
    }
    const result = PluginManifestSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects invalid name format', () => {
    const data = {
      type: 'gate',
      name: 'Invalid Name',
      version: '1.0.0',
      description: 'Bad name',
    }
    const result = PluginManifestSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid version format', () => {
    const data = {
      type: 'gate',
      name: 'my-gate',
      version: 'v1',
      description: 'Bad version',
    }
    const result = PluginManifestSchema.safeParse(data)
    expect(result.success).toBe(false)
  })
})

describe('StateFileSchema', () => {
  it('validates a state file with execution state', () => {
    const data = {
      schema_version: 1,
      execution: {
        change: 'add-mfa',
        started: '2026-04-04T12:00:00Z',
        batches: [],
        deviations: [],
      },
    }
    const result = StateFileSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('validates a minimal state file', () => {
    const data = { schema_version: 1 }
    const result = StateFileSchema.parse(data)
    expect(result.schema_version).toBe(1)
  })

  it('rejects state file without schema_version', () => {
    const result = StateFileSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects schema_version <= 0', () => {
    const result = StateFileSchema.safeParse({ schema_version: 0 })
    expect(result.success).toBe(false)
  })
})

describe('DeviationSchema', () => {
  it('validates a valid deviation', () => {
    const result = DeviationSchema.safeParse({
      rule: 1,
      description: 'Fixed null check in auth middleware',
      commit: 'abc123f',
      files: ['src/auth/middleware.ts'],
      action: 'fixed',
    })
    expect(result.success).toBe(true)
  })

  it('rejects rule 0 (below minimum)', () => {
    const result = DeviationSchema.safeParse({
      rule: 0,
      description: 'invalid rule',
    })
    expect(result.success).toBe(false)
  })

  it('rejects rule 5 (above maximum)', () => {
    const result = DeviationSchema.safeParse({
      rule: 5,
      description: 'invalid rule',
    })
    expect(result.success).toBe(false)
  })

  it('rejects when description is missing', () => {
    const result = DeviationSchema.safeParse({ rule: 2 })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = DeviationSchema.safeParse({
      rule: 1,
      description: 'test',
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('GateFailureSchema', () => {
  it('validates a valid gate failure', () => {
    const result = GateFailureSchema.safeParse({
      file: 'src/index.ts',
      line: 10,
      message: 'no-unused-vars',
      severity: 'error',
    })
    expect(result.success).toBe(true)
  })

  it('validates with severity warning', () => {
    const result = GateFailureSchema.safeParse({
      file: 'src/index.ts',
      message: 'prefer-const',
      severity: 'warning',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid severity enum', () => {
    const result = GateFailureSchema.safeParse({
      file: 'src/index.ts',
      message: 'bad',
      severity: 'critical',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = GateFailureSchema.safeParse({
      file: 'a.ts',
      message: 'msg',
      severity: 'error',
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('SpecLockRequirementSchema', () => {
  it('validates a valid requirement', () => {
    const result = SpecLockRequirementSchema.safeParse({
      id: 'user-login',
      hash: 'sha256:a1b2c3',
      scenarios: ['successful-login', 'invalid-password'],
    })
    expect(result.success).toBe(true)
  })

  it('rejects when id is missing', () => {
    const result = SpecLockRequirementSchema.safeParse({
      hash: 'sha256:a1b2c3',
      scenarios: ['test'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects when hash is missing', () => {
    const result = SpecLockRequirementSchema.safeParse({
      id: 'user-login',
      scenarios: ['test'],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = SpecLockRequirementSchema.safeParse({
      id: 'user-login',
      hash: 'sha256:a1b2c3',
      scenarios: [],
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('ReconciliationRequirementSchema', () => {
  it('validates a valid reconciliation requirement', () => {
    const result = ReconciliationRequirementSchema.safeParse({
      id: 'checkout-flow',
      status: 'verified',
      evidence: ['src/app/api/checkout/'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid status values', () => {
    const statuses = ['verified', 'partial', 'missing', 'unimplemented', 'diverged', 'undocumented'] as const
    for (const status of statuses) {
      const result = ReconciliationRequirementSchema.safeParse({ id: 'r1', status })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid status enum', () => {
    const result = ReconciliationRequirementSchema.safeParse({
      id: 'r1',
      status: 'unknown',
    })
    expect(result.success).toBe(false)
  })

  it('rejects when id is missing', () => {
    const result = ReconciliationRequirementSchema.safeParse({
      status: 'verified',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = ReconciliationRequirementSchema.safeParse({
      id: 'r1',
      status: 'verified',
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('ExecutionTaskSchema', () => {
  it('validates a valid task', () => {
    const result = ExecutionTaskSchema.safeParse({
      id: '1.1',
      status: 'complete',
      commit: 'abc123f',
      gates: { tests: 'pass', lint: 'pass' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid status values', () => {
    const statuses = ['pending', 'in_progress', 'complete', 'failed', 'skipped'] as const
    for (const status of statuses) {
      const result = ExecutionTaskSchema.safeParse({ id: '1.1', status })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid status enum', () => {
    const result = ExecutionTaskSchema.safeParse({
      id: '1.1',
      status: 'cancelled',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = ExecutionTaskSchema.safeParse({
      id: '1.1',
      status: 'pending',
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('ExecutionBatchSchema', () => {
  it('validates a valid batch', () => {
    const result = ExecutionBatchSchema.safeParse({
      id: 1,
      status: 'complete',
      tasks: [
        { id: '1.1', status: 'complete', commit: 'abc123f' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts all valid status values', () => {
    const statuses = ['pending', 'in_progress', 'complete', 'failed'] as const
    for (const status of statuses) {
      const result = ExecutionBatchSchema.safeParse({ id: 1, status, tasks: [] })
      expect(result.success).toBe(true)
    }
  })

  it('rejects invalid batch status enum', () => {
    const result = ExecutionBatchSchema.safeParse({
      id: 1,
      status: 'cancelled',
      tasks: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects id of zero', () => {
    const result = ExecutionBatchSchema.safeParse({
      id: 0,
      status: 'pending',
      tasks: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects negative id', () => {
    const result = ExecutionBatchSchema.safeParse({
      id: -1,
      status: 'pending',
      tasks: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = ExecutionBatchSchema.safeParse({
      id: 1,
      status: 'pending',
      tasks: [],
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('ViolationSchema', () => {
  it('parses a valid violation object', () => {
    const data = {
      article: 'No singletons',
      severity: 'major',
      evidence: 'a singleton registry instance',
      suggestion: 'Refactor to inject the registry',
    }
    const result = ViolationSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('rejects unknown severity values', () => {
    const data = {
      article: 'No singletons',
      severity: 'fatal',
      evidence: 'evidence text',
      suggestion: 'fix it',
    }
    const result = ViolationSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects missing fields', () => {
    const data = {
      article: 'No singletons',
      severity: 'minor',
      evidence: 'evidence text',
    }
    const result = ViolationSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects empty string fields', () => {
    const data = {
      article: '',
      severity: 'minor',
      evidence: 'e',
      suggestion: 's',
    }
    const result = ViolationSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('accepts each severity value', () => {
    for (const severity of ['critical', 'major', 'minor'] as const) {
      const result = SeveritySchema.safeParse(severity)
      expect(result.success).toBe(true)
    }
  })
})

describe('ViolationListSchema', () => {
  it('accepts an empty violations array (clean spec signal)', () => {
    const result = ViolationListSchema.safeParse({ violations: [] })
    expect(result.success).toBe(true)
  })

  it('accepts a populated violations array', () => {
    const result = ViolationListSchema.safeParse({
      violations: [
        {
          article: 'No singletons',
          severity: 'critical',
          evidence: 'a singleton registry instance',
          suggestion: 'inject the registry',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects when violations field is missing', () => {
    const result = ViolationListSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
