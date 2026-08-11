import { describe, it, expect } from 'vitest'
import {
  ChangeMetadataSchema,
  ArtifactTimingSchema,
  ArtifactTokensSchema,
  ComplexityScoreSchema,
  SpecLockSchema,
  SpecLockRequirementSchema,
  ReconciliationRequirementSchema,
  ExecutionStateSchema,
  DeviationSchema,
  ExecutionTaskSchema,
  ExecutionBatchSchema,
  ProjectConfigSchema,
  GateResultSchema,
  GateFailureSchema,
  WorkflowDefinitionSchema,
  AgentDefinitionSchema,
  GateDefinitionSchema,
  StateFileSchema,
  ViolationSchema,
  ViolationListSchema,
  SeveritySchema,
  VerificationConfigSchema,
  VerificationStrategyEnum,
  ModelAliasEnum,
  ModelsConfigSchema,
  GitConfigSchema,
  TokenUsageRecordSchema,
  TokensConfigSchema,
  ReleaseConfigSchema,
} from '../src/schemas/index.js'
import type { ComplexityScore } from '../src/schemas/index.js'

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

  it('accepts metadata with a full complexity_score block', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      complexity_score: {
        score: 2,
        signals: { file_count: 5 },
        recommended_workflow: 'standard',
      },
      auto_accept_recommendation: true,
      workflow_locked: true,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.complexity_score?.recommended_workflow).toBe('standard')
      expect(result.data.auto_accept_recommendation).toBe(true)
      expect(result.data.workflow_locked).toBe(true)
    }
  })

  it('accepts legacy metadata with no complexity fields', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.complexity_score).toBeUndefined()
      expect(result.data.actual_complexity_score).toBeUndefined()
      expect(result.data.workflow_locked).toBeUndefined()
      expect(result.data.auto_accept_recommendation).toBeUndefined()
    }
  })

  it('accepts metadata with artifact_timings, artifact_tokens, and iteration counters', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: { intent: 'complete', spec: 'in_progress' },
      artifact_timings: {
        intent: {
          started: '2026-04-21T11:30:00Z',
          completed: '2026-04-21T11:45:00Z',
        },
        spec: { started: '2026-04-21T11:46:00Z' },
      },
      artifact_tokens: {
        intent: { context: 775, budget: 20000 },
        spec: { context: 4086, budget: 40000 },
      },
      review_iterations: 2,
      verify_iterations: 1,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.artifact_timings?.intent?.completed).toBe('2026-04-21T11:45:00Z')
      expect(result.data.artifact_tokens?.spec?.budget).toBe(40000)
      expect(result.data.review_iterations).toBe(2)
      expect(result.data.verify_iterations).toBe(1)
    }
  })

  it('accepts legacy metadata with none of the new optional fields', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.artifact_timings).toBeUndefined()
      expect(result.data.artifact_tokens).toBeUndefined()
      expect(result.data.review_iterations).toBeUndefined()
      expect(result.data.verify_iterations).toBeUndefined()
    }
  })

  it('rejects negative review_iterations', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      review_iterations: -1,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects negative verify_iterations', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      verify_iterations: -5,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects non-integer review_iterations', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      review_iterations: 1.5,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('accepts stop_after as a string', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'tasks',
      base_versions: {},
      artifacts: { intent: 'complete' as const },
      stop_after: 'tasks',
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stop_after).toBe('tasks')
    }
  })

  it('omits stop_after when absent', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'tasks',
      base_versions: {},
      artifacts: { intent: 'complete' as const },
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.stop_after).toBeUndefined()
    }
  })

  it('rejects non-string stop_after', () => {
    const data = {
      workflow: 'standard',
      created: '2026-04-21T12:00:00Z',
      status: 'active',
      current_artifact: 'tasks',
      base_versions: {},
      artifacts: {},
      stop_after: 42,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('allows complexity_score and actual_complexity_score to coexist independently', () => {
    const intentScore: ComplexityScore = {
      score: 1,
      signals: { file_count: 2 },
      recommended_workflow: 'quick',
    }
    const actualScore: ComplexityScore = {
      score: 2,
      signals: { file_count: 5 },
      recommended_workflow: 'standard',
    }
    const data = {
      workflow: 'quick',
      created: '2026-04-04T12:00:00Z',
      status: 'active',
      current_artifact: 'implementation',
      base_versions: {},
      artifacts: {},
      complexity_score: intentScore,
      actual_complexity_score: actualScore,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.complexity_score).toEqual(intentScore)
      expect(result.data.actual_complexity_score).toEqual(actualScore)
      // ensure the two fields are independent references
      expect(result.data.complexity_score?.recommended_workflow).toBe('quick')
      expect(result.data.actual_complexity_score?.recommended_workflow).toBe('standard')
    }
  })

  it('accepts metadata with a populated escalation block and round-trips it', () => {
    const escalation = {
      from_tier: 'quick' as const,
      to_tier: 'standard' as const,
      justification: 'kept standard: declined downscale',
      timestamp: '2026-07-14T12:00:00Z',
    }
    const data = {
      workflow: 'standard',
      created: '2026-07-14T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      escalation,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.escalation).toEqual(escalation)
      expect(result.data.escalation?.from_tier).toBe('quick')
      expect(result.data.escalation?.to_tier).toBe('standard')
    }
  })

  it('accepts legacy metadata omitting escalation (field undefined)', () => {
    const data = {
      workflow: 'standard',
      created: '2026-07-14T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.escalation).toBeUndefined()
    }
  })

  it('rejects escalation with an empty justification', () => {
    const data = {
      workflow: 'standard',
      created: '2026-07-14T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
      escalation: {
        from_tier: 'quick',
        to_tier: 'standard',
        justification: '',
        timestamp: '2026-07-14T12:00:00Z',
      },
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('parses legacy metadata with no model_escalations/model_runs keys unchanged', () => {
    const data = {
      workflow: 'standard',
      created: '2026-07-14T12:00:00Z',
      status: 'active',
      current_artifact: 'spec',
      base_versions: {},
      artifacts: {},
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model_escalations).toBeUndefined()
      expect(result.data.model_runs).toBeUndefined()
    }
  })

  it('parses populated model_escalations and model_runs arrays and round-trips them', () => {
    const modelEscalations = [
      {
        task: 'implementation',
        from_model: 'sonnet' as const,
        to_model: 'inherit' as const,
        trigger: 'stop_deviation' as const,
        timestamp: '2026-07-14T12:00:00Z',
      },
      {
        task: 'implementation',
        from_model: 'haiku' as const,
        to_model: 'inherit' as const,
        trigger: 'verify_fail' as const,
        timestamp: '2026-07-14T13:00:00Z',
      },
    ]
    const modelRuns = [
      { task: 'implementation', model: 'sonnet' as const, timestamp: '2026-07-14T11:00:00Z' },
    ]
    const data = {
      workflow: 'quick',
      created: '2026-07-14T12:00:00Z',
      status: 'active',
      current_artifact: 'implementation',
      base_versions: {},
      artifacts: {},
      model_escalations: modelEscalations,
      model_runs: modelRuns,
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model_escalations).toEqual(modelEscalations)
      expect(result.data.model_runs).toEqual(modelRuns)
    }
  })

  it('rejects a model_escalations record with an out-of-vocabulary trigger', () => {
    const data = {
      workflow: 'quick',
      created: '2026-07-14T12:00:00Z',
      status: 'active',
      current_artifact: 'implementation',
      base_versions: {},
      artifacts: {},
      model_escalations: [
        {
          task: 'implementation',
          from_model: 'sonnet',
          to_model: 'inherit',
          trigger: 'gut_feeling',
          timestamp: '2026-07-14T12:00:00Z',
        },
      ],
    }
    const result = ChangeMetadataSchema.safeParse(data)
    expect(result.success).toBe(false)
  })
})

describe('ArtifactTimingSchema', () => {
  it('accepts empty object (both fields optional)', () => {
    const result = ArtifactTimingSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts only started', () => {
    const result = ArtifactTimingSchema.safeParse({ started: '2026-04-21T10:00:00Z' })
    expect(result.success).toBe(true)
  })

  it('accepts only completed', () => {
    const result = ArtifactTimingSchema.safeParse({ completed: '2026-04-21T10:00:00Z' })
    expect(result.success).toBe(true)
  })

  it('accepts both started and completed', () => {
    const result = ArtifactTimingSchema.safeParse({
      started: '2026-04-21T09:00:00Z',
      completed: '2026-04-21T10:00:00Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-ISO started', () => {
    const result = ArtifactTimingSchema.safeParse({ started: 'yesterday' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = ArtifactTimingSchema.safeParse({
      started: '2026-04-21T10:00:00Z',
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('ArtifactTokensSchema', () => {
  it('accepts non-negative context and budget', () => {
    const result = ArtifactTokensSchema.safeParse({ context: 100, budget: 1000 })
    expect(result.success).toBe(true)
  })

  it('accepts zeros', () => {
    const result = ArtifactTokensSchema.safeParse({ context: 0, budget: 0 })
    expect(result.success).toBe(true)
  })

  it('rejects negative context', () => {
    const result = ArtifactTokensSchema.safeParse({ context: -1, budget: 1000 })
    expect(result.success).toBe(false)
  })

  it('rejects negative budget', () => {
    const result = ArtifactTokensSchema.safeParse({ context: 100, budget: -1 })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer values', () => {
    const result = ArtifactTokensSchema.safeParse({ context: 1.5, budget: 1000 })
    expect(result.success).toBe(false)
  })

  it('rejects when context is missing', () => {
    const result = ArtifactTokensSchema.safeParse({ budget: 1000 })
    expect(result.success).toBe(false)
  })

  it('rejects when budget is missing', () => {
    const result = ArtifactTokensSchema.safeParse({ context: 100 })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = ArtifactTokensSchema.safeParse({
      context: 100,
      budget: 1000,
      extra: true,
    })
    expect(result.success).toBe(false)
  })
})

describe('ComplexityScoreSchema', () => {
  it('validates a complete complexity score', () => {
    const result = ComplexityScoreSchema.safeParse({
      score: 0,
      signals: { file_count: 1 },
      recommended_workflow: 'trivial',
    })
    expect(result.success).toBe(true)
  })

  it('accepts all recommended_workflow enum values', () => {
    const workflows = ['trivial', 'quick', 'standard', 'full'] as const
    for (const rw of workflows) {
      const result = ComplexityScoreSchema.safeParse({
        score: 1,
        signals: { file_count: 3 },
        recommended_workflow: rw,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects score below 0', () => {
    const result = ComplexityScoreSchema.safeParse({
      score: -1,
      signals: { file_count: 0 },
      recommended_workflow: 'trivial',
    })
    expect(result.success).toBe(false)
  })

  it('rejects score above 3', () => {
    const result = ComplexityScoreSchema.safeParse({
      score: 4,
      signals: { file_count: 10 },
      recommended_workflow: 'full',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid recommended_workflow enum', () => {
    const result = ComplexityScoreSchema.safeParse({
      score: 1,
      signals: { file_count: 2 },
      recommended_workflow: 'mega',
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (.strict())', () => {
    const result = ComplexityScoreSchema.safeParse({
      score: 1,
      signals: { file_count: 2 },
      recommended_workflow: 'quick',
      extra: true,
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields on signals (.strict())', () => {
    const result = ComplexityScoreSchema.safeParse({
      score: 1,
      signals: { file_count: 2, extra_signal: 99 },
      recommended_workflow: 'quick',
    })
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

  it('accepts installed_version on a full valid config and exposes the string', () => {
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
      installed_version: '0.4.0',
    }
    const result = ProjectConfigSchema.safeParse(data)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.installed_version).toBe('0.4.0')
    }
  })

  it('parses a legacy config without installed_version as undefined', () => {
    const result = ProjectConfigSchema.parse({ project: { name: 'Legacy App' } })
    expect(result.installed_version).toBeUndefined()
  })

  it('rejects a non-string installed_version with an issue at the field path', () => {
    const result = ProjectConfigSchema.safeParse({
      project: { name: 'App' },
      installed_version: 4,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'installed_version')).toBe(true)
    }
  })

  it('applies defaults for absent docs block', () => {
    const result = ProjectConfigSchema.parse({})
    expect(result.docs).toEqual({
      output: './docs',
      generate_on: 'finalize',
      types: ['architecture', 'api', 'changelog', 'getting-started'],
    })
  })

  it('fills missing docs fields when only output is set', () => {
    const result = ProjectConfigSchema.parse({ docs: { output: './website' } })
    expect(result.docs.output).toBe('./website')
    expect(result.docs.generate_on).toBe('finalize')
    expect(result.docs.types).toEqual(['architecture', 'api', 'changelog', 'getting-started'])
  })

  it('preserves explicit generate_on: manual', () => {
    const result = ProjectConfigSchema.parse({ docs: { generate_on: 'manual' } })
    expect(result.docs.generate_on).toBe('manual')
    expect(result.docs.output).toBe('./docs')
  })

  it('docs default applies even when only project block is set', () => {
    const result = ProjectConfigSchema.parse({ project: { name: 'x' } })
    expect(result.docs).toEqual({
      output: './docs',
      generate_on: 'finalize',
      types: ['architecture', 'api', 'changelog', 'getting-started'],
    })
  })

  it('ModelAliasEnum accepts all five documented model aliases', () => {
    for (const alias of ['sonnet', 'opus', 'haiku', 'fable', 'inherit']) {
      expect(ModelAliasEnum.safeParse(alias).success).toBe(true)
    }
  })

  it('rejects an out-of-vocabulary model alias with a typed error naming the field', () => {
    const result = ProjectConfigSchema.safeParse({
      models: { executor: { trivial: 'gpt-4o' } },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join('.') === 'models.executor.trivial'
      )
      expect(issue).toBeDefined()
      expect(issue?.code).toBe('invalid_enum_value')
    }
  })

  it('accepts an absent models key with no behavior change to the rest of the config', () => {
    const result = ProjectConfigSchema.safeParse({ project: { name: 'My App' } })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.models).toBeUndefined()
      expect(result.data.docs).toEqual({
        output: './docs',
        generate_on: 'finalize',
        types: ['architecture', 'api', 'changelog', 'getting-started'],
      })
    }
  })

  it('rejects models.reviewer values other than the literal inherit with issue path models.reviewer', () => {
    const result = ProjectConfigSchema.safeParse({
      models: { reviewer: 'haiku' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'models.reviewer')
      expect(issue).toBeDefined()
    }
  })

  it('rejects models.verifier values other than the literal inherit with issue path models.verifier', () => {
    const result = ProjectConfigSchema.safeParse({
      models: { verifier: 'sonnet' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'models.verifier')
      expect(issue).toBeDefined()
    }
  })

  it('accepts the literal inherit for models.reviewer and models.verifier', () => {
    const result = ProjectConfigSchema.safeParse({
      models: { reviewer: 'inherit', verifier: 'inherit' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts every named profile value (quality, balanced, budget)', () => {
    for (const profile of ['quality', 'balanced', 'budget']) {
      const result = ProjectConfigSchema.safeParse({ models: { profile } })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an unknown profile value', () => {
    const result = ProjectConfigSchema.safeParse({ models: { profile: 'premium' } })
    expect(result.success).toBe(false)
  })

  it('rejects planning-cohort role names as models keys (.strict())', () => {
    for (const role of ['proposer', 'specifier', 'product', 'researcher', 'architect', 'planner']) {
      const result = ModelsConfigSchema.safeParse({ [role]: 'sonnet' })
      expect(result.success).toBe(false)
    }
  })

  it('rejects unknown executor tier keys in models.executor (.strict())', () => {
    const result = ProjectConfigSchema.safeParse({
      models: { executor: { standard: 'haiku' } },
    })
    expect(result.success).toBe(false)
  })
})

describe('ReleaseConfigSchema', () => {
  it('accepts a valid semver config with all four keys', () => {
    const result = ReleaseConfigSchema.parse({
      scheme: 'semver',
      version_file: 'package.json',
      tag_prefix: 'v',
      github_release: false,
    })
    expect(result).toEqual({
      scheme: 'semver',
      version_file: 'package.json',
      tag_prefix: 'v',
      github_release: false,
    })
  })

  it('rejects an unsupported scheme with a message naming release.scheme', () => {
    const result = ReleaseConfigSchema.safeParse({
      scheme: 'calver',
      version_file: 'package.json',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'scheme')
      expect(issue).toBeDefined()
      expect(issue?.message).toBe("release.scheme: only 'semver' is supported")
    }
  })

  it('rejects an empty version_file with a message naming release.version_file', () => {
    const result = ReleaseConfigSchema.safeParse({
      scheme: 'semver',
      version_file: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'version_file')
      expect(issue).toBeDefined()
      expect(issue?.message).toContain('release.version_file')
    }
  })

  it('defaults tag_prefix to v and github_release to false when only scheme and version_file are given', () => {
    const result = ReleaseConfigSchema.parse({
      scheme: 'semver',
      version_file: 'package.json',
    })
    expect(result.tag_prefix).toBe('v')
    expect(result.github_release).toBe(false)
  })

  it('rejects unknown keys (.strict())', () => {
    const result = ReleaseConfigSchema.safeParse({
      scheme: 'semver',
      version_file: 'package.json',
      push: true,
    })
    expect(result.success).toBe(false)
  })

  it('is accepted under ProjectConfigSchema as the optional release key', () => {
    const result = ProjectConfigSchema.safeParse({
      release: { scheme: 'semver', version_file: 'package.json' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.release).toEqual({
        scheme: 'semver',
        version_file: 'package.json',
        tag_prefix: 'v',
        github_release: false,
      })
    }
  })

  it('surfaces nested issues under the release path via ProjectConfigSchema', () => {
    const result = ProjectConfigSchema.safeParse({
      release: { scheme: 'calver', version_file: 'package.json' },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join('.') === 'release.scheme')
      expect(issue).toBeDefined()
      expect(issue?.message).toBe("release.scheme: only 'semver' is supported")
    }
  })

  it('existing configs without a release key still parse unchanged', () => {
    const result = ProjectConfigSchema.safeParse({
      project: { name: 'legacy' },
      installed_version: '0.4.0',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.release).toBeUndefined()
    }
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

  it('accepts when capabilities is missing (optional dead field)', () => {
    const result = AgentDefinitionSchema.safeParse({
      name: 'test', persona: 'You are a test.', tools: ['Read'], context_budget: 1000,
    })
    expect(result.success).toBe(true)
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

describe('VerificationConfigSchema', () => {
  it('accepts all four valid strategy enum values with optional instructions', () => {
    const strategies: Array<'tmux_tui' | 'playwright' | 'cli_exit_codes' | 'tests_only'> = [
      'tmux_tui',
      'playwright',
      'cli_exit_codes',
      'tests_only',
    ]
    for (const strategy of strategies) {
      expect(() => VerificationConfigSchema.parse({ strategy })).not.toThrow()
      expect(VerificationStrategyEnum.safeParse(strategy).success).toBe(true)
    }
    expect(() =>
      VerificationConfigSchema.parse({
        strategy: 'playwright',
        instructions: 'http://localhost:3000',
      })
    ).not.toThrow()
  })

  it('rejects invalid strategy enum values', () => {
    const result = VerificationConfigSchema.safeParse({ strategy: 'magic' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown fields (strict schema)', () => {
    const result = VerificationConfigSchema.safeParse({
      strategy: 'tests_only',
      foo: 'bar',
    })
    expect(result.success).toBe(false)
  })
})

describe('GitConfigSchema worktree sub-object', () => {
  it('defaults worktree to enabled with .metta/worktrees when omitted (backward compat)', () => {
    const result = GitConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.worktree).toEqual({ enabled: true, dir: '.metta/worktrees' })
    }
  })

  it('keeps existing git configs without worktree valid', () => {
    const result = GitConfigSchema.safeParse({
      enabled: true,
      merge_strategy: 'ff-only',
      pr_base: 'main',
    })
    expect(result.success).toBe(true)
  })

  it('fills inner defaults when worktree is partially specified', () => {
    const result = GitConfigSchema.safeParse({ worktree: { enabled: false } })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.worktree.enabled).toBe(false)
      expect(result.data.worktree.dir).toBe('.metta/worktrees')
    }
  })

  it('accepts a custom worktree dir', () => {
    const result = GitConfigSchema.safeParse({ worktree: { dir: '.wt' } })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.worktree.dir).toBe('.wt')
      expect(result.data.worktree.enabled).toBe(true)
    }
  })

  it('rejects unknown worktree fields (.strict())', () => {
    const result = GitConfigSchema.safeParse({ worktree: { enabled: true, extra: 1 } })
    expect(result.success).toBe(false)
  })

  it('validates worktree through ProjectConfigSchema git section', () => {
    const result = ProjectConfigSchema.safeParse({
      git: { worktree: { enabled: false, dir: 'custom/worktrees' } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.git?.worktree).toEqual({ enabled: false, dir: 'custom/worktrees' })
    }
  })
})

describe('ChangeMetadataSchema worktree field', () => {
  const base = {
    workflow: 'standard',
    created: '2026-04-04T12:00:00Z',
    status: 'active',
    current_artifact: 'spec',
    base_versions: {},
    artifacts: {},
  }

  it('accepts metadata with an absolute worktree path', () => {
    const result = ChangeMetadataSchema.safeParse({
      ...base,
      worktree: '/repo/.metta/worktrees/my-change',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.worktree).toBe('/repo/.metta/worktrees/my-change')
    }
  })

  it('accepts existing records without the worktree field (backward compat)', () => {
    const result = ChangeMetadataSchema.safeParse(base)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.worktree).toBeUndefined()
    }
  })

  it('rejects a non-string worktree value', () => {
    const result = ChangeMetadataSchema.safeParse({ ...base, worktree: 42 })
    expect(result.success).toBe(false)
  })
})


describe('TokenUsageRecordSchema', () => {
  const baseMetadata = {
    workflow: 'standard',
    created: '2026-04-04T12:00:00Z',
    status: 'active',
    current_artifact: 'spec',
    base_versions: {},
    artifacts: {},
  }

  const validRecord = {
    task: '1.1',
    agent: 'metta-executor',
    model: 'haiku',
    tokens: 12345,
    timestamp: '2026-08-08T12:00:00Z',
  }

  it('round-trips a valid record through ChangeMetadataSchema token_usage', () => {
    const result = ChangeMetadataSchema.safeParse({
      ...baseMetadata,
      token_usage: [validRecord],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.token_usage).toEqual([validRecord])
      expect(result.data.token_usage?.[0]?.model).toBe('haiku')
    }
  })

  it('rejects tokens: 0', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, tokens: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects non-integer tokens (12.5)', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, tokens: 12.5 })
    expect(result.success).toBe(false)
  })

  it('rejects negative tokens (-5)', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, tokens: -5 })
    expect(result.success).toBe(false)
  })

  it('rejects a model outside ModelAliasEnum', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, model: 'gpt-4' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown extra keys (.strict())', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, cost: 1.23 })
    expect(result.success).toBe(false)
  })

  it('accepts metadata without token_usage (backward compat)', () => {
    const result = ChangeMetadataSchema.safeParse(baseMetadata)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.token_usage).toBeUndefined()
    }
  })

  it('parses and round-trips a hook-sourced record through ChangeMetadataSchema', () => {
    const hookRecord = {
      task: 'impl',
      agent: 'executor',
      model: 'haiku',
      tokens: 41250,
      timestamp: '2026-08-08T12:00:00.000Z',
      source: 'hook',
    }
    const direct = TokenUsageRecordSchema.safeParse(hookRecord)
    expect(direct.success).toBe(true)
    if (direct.success) {
      expect(direct.data.source).toBe('hook')
    }
    const result = ChangeMetadataSchema.safeParse({
      ...baseMetadata,
      token_usage: [hookRecord],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.token_usage).toEqual([hookRecord])
      expect(result.data.token_usage?.[0]?.source).toBe('hook')
    }
  })

  it('accepts source: "prose"', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, source: 'prose' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('prose')
    }
  })

  it('rejects source: "manual" (out of enum)', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, source: 'manual' })
    expect(result.success).toBe(false)
  })

  it('rejects source: 1 (non-string)', () => {
    const result = TokenUsageRecordSchema.safeParse({ ...validRecord, source: 1 })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown extra key alongside a valid source', () => {
    const result = TokenUsageRecordSchema.safeParse({
      ...validRecord,
      source: 'hook',
      extra: 'nope',
    })
    expect(result.success).toBe(false)
  })

  it('parses a legacy record with no source field (source undefined)', () => {
    const result = TokenUsageRecordSchema.safeParse(validRecord)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBeUndefined()
    }
  })

  it('leaves existing artifact_tokens fixture behavior unchanged', () => {
    const result = ChangeMetadataSchema.safeParse({
      ...baseMetadata,
      artifact_tokens: {
        intent: { context: 775, budget: 20000 },
        spec: { context: 4086, budget: 40000 },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.artifact_tokens?.spec?.budget).toBe(40000)
      expect(result.data.token_usage).toBeUndefined()
    }
  })
})

describe('TokensConfigSchema', () => {
  it('defaults tokens to { enabled: true } when omitted from ProjectConfigSchema', () => {
    const result = ProjectConfigSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tokens).toEqual({ enabled: true })
    }
  })

  it('accepts an explicit enabled: false', () => {
    const result = TokensConfigSchema.safeParse({ enabled: false })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.enabled).toBe(false)
    }
  })

  it('rejects unknown keys (.strict())', () => {
    const result = TokensConfigSchema.safeParse({ enabled: true, budget: 1000 })
    expect(result.success).toBe(false)
  })

  it('rejects a non-boolean enabled value', () => {
    const result = TokensConfigSchema.safeParse({ enabled: 'yes' })
    expect(result.success).toBe(false)
  })
})
