import { describe, it, expect } from 'vitest'
import {
  ChangeMetadataSchema,
  SpecLockSchema,
  ExecutionStateSchema,
  AutoStateSchema,
  ProjectConfigSchema,
  GateResultSchema,
  WorkflowDefinitionSchema,
  AgentDefinitionSchema,
  GateDefinitionSchema,
  PluginManifestSchema,
  StateFileSchema,
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
})

describe('AutoStateSchema', () => {
  it('validates auto mode state', () => {
    const data = {
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
    const result = AutoStateSchema.safeParse(data)
    expect(result.success).toBe(true)
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

  it('validates an empty state file with defaults', () => {
    const data = {}
    const result = StateFileSchema.parse(data)
    expect(result.schema_version).toBe(1)
  })
})
