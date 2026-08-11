import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { getCeremonyCommitRatio, getArtifactsPerSmallChange, getModelEscalationRate, getAvgTokensPerChangeByTier, getLatestTag } from '../src/util/ceremony-metrics.js'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...env,
    },
  })
}

function initRepo(cwd: string): void {
  git(cwd, ['init', '-q', '-b', 'main'])
  git(cwd, ['config', 'user.email', 'test@example.com'])
  git(cwd, ['config', 'user.name', 'Test'])
}

function emptyCommit(cwd: string, subject: string): void {
  git(cwd, ['commit', '-q', '--allow-empty', '-m', subject])
}

function writeArchiveMetadata(
  specDir: string,
  entryName: string,
  workflow: string,
  artifactIds: string[],
  opts: { modelRuns?: number; modelEscalations?: number; tokenUsage?: number[] } = {},
): void {
  const dir = join(specDir, 'archive', entryName)
  mkdirSync(dir, { recursive: true })
  const artifacts = artifactIds.map(id => `  ${id}: complete`).join('\n')
  const lines = [
    `workflow: ${workflow}`,
    'created: 2026-07-01T10:00:00.000Z',
    'status: complete',
    `current_artifact: ${artifactIds[artifactIds.length - 1] ?? ''}`,
    'base_versions: {}',
    'artifacts:',
    artifacts,
  ]
  if (opts.modelRuns) {
    lines.push('model_runs:')
    for (let i = 0; i < opts.modelRuns; i++) {
      lines.push(
        '  - task: implementation',
        '    model: sonnet',
        '    timestamp: 2026-07-01T11:00:00.000Z',
      )
    }
  }
  if (opts.modelEscalations) {
    lines.push('model_escalations:')
    for (let i = 0; i < opts.modelEscalations; i++) {
      lines.push(
        '  - task: implementation',
        '    from_model: sonnet',
        '    to_model: inherit',
        '    trigger: stop_deviation',
        '    timestamp: 2026-07-01T12:00:00.000Z',
      )
    }
  }
  if (opts.tokenUsage !== undefined) {
    if (opts.tokenUsage.length === 0) {
      lines.push('token_usage: []')
    } else {
      lines.push('token_usage:')
      for (const tokens of opts.tokenUsage) {
        lines.push(
          '  - task: implementation',
          '    agent: metta-executor',
          '    model: sonnet',
          `    tokens: ${tokens}`,
          '    timestamp: 2026-07-01T13:00:00.000Z',
        )
      }
    }
  }
  lines.push('')
  writeFileSync(join(dir, '.metta.yaml'), lines.join('\n'), 'utf8')
}

describe('ceremony-metrics', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'metta-ceremony-metrics-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  describe('getCeremonyCommitRatio', () => {
    it('classifies a mixed chore/docs/functional commit list', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: add a thing')
      emptyCommit(tmp, 'chore: tidy up')
      emptyCommit(tmp, 'docs(readme): update usage')
      emptyCommit(tmp, 'fix(core): squash a bug')
      emptyCommit(tmp, 'some unprefixed subject')

      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toEqual({ ceremony: 2, total: 5, ratio: 2 / 5 })
    })

    it('counts merge-commit subjects in total but never in the ceremony numerator', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'chore: setup')
      emptyCommit(tmp, "Merge branch 'feature' into main")

      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toEqual({ ceremony: 1, total: 2, ratio: 0.5 })
    })

    it('does not classify uppercase or non-chore/docs prefixes as ceremony', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'Chore: uppercase type is not ceremony')
      emptyCommit(tmp, 'refactor: not ceremony either')
      emptyCommit(tmp, 'docs: real ceremony')

      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toEqual({ ceremony: 1, total: 3, ratio: 1 / 3 })
    })

    it('returns null when the directory is not a git repo', async () => {
      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toBeNull()
    })

    it('returns null when the repo has no commits (git log fails)', async () => {
      initRepo(tmp)
      const result = await getCeremonyCommitRatio(tmp)
      expect(result).toBeNull()
    })

    it('windows the count via <ref>..HEAD when sinceRef is a tag placed mid-history', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: add a thing')
      emptyCommit(tmp, 'chore: tidy up')
      git(tmp, ['tag', 'v1.0.0'])
      emptyCommit(tmp, 'docs(readme): update usage')
      emptyCommit(tmp, 'fix(core): squash a bug')
      emptyCommit(tmp, 'chore: post-tag ceremony')

      const allTime = await getCeremonyCommitRatio(tmp)
      expect(allTime).toEqual({ ceremony: 3, total: 5, ratio: 3 / 5 })

      const windowed = await getCeremonyCommitRatio(tmp, 'v1.0.0')
      expect(windowed).toEqual({ ceremony: 2, total: 3, ratio: 2 / 3 })
    })

    it('returns null when sinceRef does not resolve (invalid ref)', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: add a thing')
      emptyCommit(tmp, 'chore: tidy up')

      const result = await getCeremonyCommitRatio(tmp, 'no-such-ref')
      expect(result).toBeNull()
    })

    it('returns zeros (not null) for a legitimately empty window (tag at HEAD)', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: add a thing')
      emptyCommit(tmp, 'chore: tidy up')
      git(tmp, ['tag', 'v1.0.0'])

      const result = await getCeremonyCommitRatio(tmp, 'v1.0.0')
      expect(result).toEqual({ ceremony: 0, total: 0, ratio: 0 })
    })
  })

  describe('getLatestTag', () => {
    it('resolves the most recent tag reachable from HEAD', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: first')
      git(tmp, ['tag', 'v1.0.0'])
      emptyCommit(tmp, 'feat: second')

      const tag = await getLatestTag(tmp)
      expect(tag).toBe('v1.0.0')
    })

    it('returns null when the repo has no tags', async () => {
      initRepo(tmp)
      emptyCommit(tmp, 'feat: first')

      const tag = await getLatestTag(tmp)
      expect(tag).toBeNull()
    })

    it('returns null when the directory is not a git repo', async () => {
      const tag = await getLatestTag(tmp)
      expect(tag).toBeNull()
    })
  })

  describe('getArtifactsPerSmallChange', () => {
    it('averages artifact counts over archived quick/trivial changes only', async () => {
      writeArchiveMetadata(tmp, '2026-07-01-quick-one', 'quick', ['intent', 'implementation', 'verification'])
      writeArchiveMetadata(tmp, '2026-07-02-trivial-one', 'trivial', ['intent', 'implementation'])
      // A standard change must be filtered out of the sample entirely.
      writeArchiveMetadata(tmp, '2026-07-03-standard-one', 'standard', ['intent', 'spec', 'design', 'tasks', 'implementation', 'verification'])

      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toEqual({ mean: 2.5, sample_size: 2 })
    })

    it('skips schema-invalid archive entries instead of throwing', async () => {
      writeArchiveMetadata(tmp, '2026-07-01-valid-quick', 'quick', ['intent', 'implementation'])
      const badDir = join(tmp, 'archive', '2026-07-02-corrupt')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, '.metta.yaml'), 'workflow: quick\nnot_a_real_field: true\n', 'utf8')
      // Directory with no .metta.yaml at all.
      mkdirSync(join(tmp, 'archive', '2026-07-03-empty-dir'), { recursive: true })

      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toEqual({ mean: 2, sample_size: 1 })
    })

    it('returns null (not 0) when no archived change is quick/trivial', async () => {
      writeArchiveMetadata(tmp, '2026-07-01-standard-only', 'standard', ['intent', 'spec', 'design'])

      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toBeNull()
    })

    it('returns null when the archive directory does not exist', async () => {
      const result = await getArtifactsPerSmallChange(tmp)
      expect(result).toBeNull()
    })
  })

  describe('getModelEscalationRate', () => {
    it('returns null when no active or archived change has any model_runs', async () => {
      const store = new ArtifactStore(tmp)
      await store.createChange('no runs', 'quick', ['intent'])
      writeArchiveMetadata(tmp, '2026-07-01-archived-no-runs', 'quick', ['intent', 'implementation'])

      const result = await getModelEscalationRate(tmp, store)
      expect(result).toBeNull()
    })

    it('returns rate 0 (not null) for model_runs with zero model_escalations', async () => {
      const store = new ArtifactStore(tmp)
      await store.createChange('cheap runs', 'quick', ['intent'])
      await store.updateChange('cheap-runs', {
        model_runs: [
          { task: 'implementation', model: 'sonnet', timestamp: '2026-07-01T11:00:00.000Z' },
          { task: 'implementation', model: 'sonnet', timestamp: '2026-07-01T11:05:00.000Z' },
        ],
      })

      const result = await getModelEscalationRate(tmp, store)
      expect(result).toEqual({ escalated: 0, total: 2, rate: 0 })
    })

    it('sums a mix of active and archived changes into the correct rate', async () => {
      const store = new ArtifactStore(tmp)
      await store.createChange('active mix', 'quick', ['intent'])
      await store.updateChange('active-mix', {
        model_runs: [
          { task: 'implementation', model: 'sonnet', timestamp: '2026-07-01T11:00:00.000Z' },
        ],
        model_escalations: [
          {
            task: 'implementation',
            from_model: 'sonnet',
            to_model: 'inherit',
            trigger: 'verify_fail',
            timestamp: '2026-07-01T12:00:00.000Z',
          },
        ],
      })
      writeArchiveMetadata(tmp, '2026-07-02-archived-mix', 'quick', ['intent', 'implementation'], {
        modelRuns: 3,
      })

      const result = await getModelEscalationRate(tmp, store)
      expect(result).toEqual({ escalated: 1, total: 4, rate: 1 / 4 })
    })

    it('skips archive entries with an invalid .metta.yaml instead of throwing', async () => {
      const store = new ArtifactStore(tmp)
      writeArchiveMetadata(tmp, '2026-07-01-valid', 'quick', ['intent', 'implementation'], {
        modelRuns: 2,
        modelEscalations: 1,
      })
      const badDir = join(tmp, 'archive', '2026-07-02-corrupt')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, '.metta.yaml'), 'workflow: quick\nnot_a_real_field: true\n', 'utf8')
      // Directory with no .metta.yaml at all.
      mkdirSync(join(tmp, 'archive', '2026-07-03-empty-dir'), { recursive: true })

      const result = await getModelEscalationRate(tmp, store)
      expect(result).toEqual({ escalated: 1, total: 2, rate: 0.5 })
    })
  })
  describe('getAvgTokensPerChangeByTier', () => {
    const NULL_TIERS = { trivial: null, quick: null, standard: null, full: null }

    it('groups per-change totals by tier across active and archived changes', async () => {
      const store = new ArtifactStore(tmp)
      await store.createChange('active quick', 'quick', ['intent'])
      await store.updateChange('active-quick', {
        token_usage: [
          { task: 'implementation', agent: 'metta-executor', model: 'sonnet', tokens: 4000, timestamp: '2026-07-01T13:00:00.000Z' },
          { task: 'verification', agent: 'metta-verifier', model: 'sonnet', tokens: 6000, timestamp: '2026-07-01T13:05:00.000Z' },
        ],
      })
      writeArchiveMetadata(tmp, '2026-07-02-archived-quick', 'quick', ['intent', 'implementation'], {
        tokenUsage: [30000],
      })
      writeArchiveMetadata(tmp, '2026-07-03-archived-standard', 'standard', ['intent', 'spec', 'implementation'], {
        tokenUsage: [50000],
      })

      const result = await getAvgTokensPerChangeByTier(tmp, store)
      expect(result).toEqual({
        trivial: null,
        quick: { mean: 20000, sample_size: 2 },
        standard: { mean: 50000, sample_size: 1 },
        full: null,
      })
    })

    it('excludes changes with an absent token_usage field (never counted as 0)', async () => {
      const store = new ArtifactStore(tmp)
      writeArchiveMetadata(tmp, '2026-07-01-reported', 'quick', ['intent', 'implementation'], {
        tokenUsage: [10000],
      })
      writeArchiveMetadata(tmp, '2026-07-02-unreported', 'quick', ['intent', 'implementation'])

      const result = await getAvgTokensPerChangeByTier(tmp, store)
      expect(result.quick).toEqual({ mean: 10000, sample_size: 1 })
    })

    it('excludes changes with a present-but-empty token_usage array', async () => {
      const store = new ArtifactStore(tmp)
      writeArchiveMetadata(tmp, '2026-07-01-reported', 'quick', ['intent', 'implementation'], {
        tokenUsage: [10000],
      })
      writeArchiveMetadata(tmp, '2026-07-02-empty-usage', 'quick', ['intent', 'implementation'], {
        tokenUsage: [],
      })

      const result = await getAvgTokensPerChangeByTier(tmp, store)
      expect(result.quick).toEqual({ mean: 10000, sample_size: 1 })
    })

    it('ignores changes whose workflow is outside the four fixed tiers', async () => {
      const store = new ArtifactStore(tmp)
      writeArchiveMetadata(tmp, '2026-07-01-custom-tier', 'custom-workflow', ['intent'], {
        tokenUsage: [99999],
      })

      const result = await getAvgTokensPerChangeByTier(tmp, store)
      expect(result).toEqual(NULL_TIERS)
    })

    it('returns all four tiers as null when there is no data at all', async () => {
      const store = new ArtifactStore(tmp)

      const result = await getAvgTokensPerChangeByTier(tmp, store)
      expect(result).toEqual(NULL_TIERS)
    })

    it('skips corrupt archive entries instead of throwing', async () => {
      const store = new ArtifactStore(tmp)
      writeArchiveMetadata(tmp, '2026-07-01-valid', 'quick', ['intent', 'implementation'], {
        tokenUsage: [10000, 30000],
      })
      const badDir = join(tmp, 'archive', '2026-07-02-corrupt')
      mkdirSync(badDir, { recursive: true })
      writeFileSync(join(badDir, '.metta.yaml'), 'workflow: quick\nnot_a_real_field: true\n', 'utf8')
      // Directory with no .metta.yaml at all.
      mkdirSync(join(tmp, 'archive', '2026-07-03-empty-dir'), { recursive: true })

      const result = await getAvgTokensPerChangeByTier(tmp, store)
      expect(result.quick).toEqual({ mean: 40000, sample_size: 1 })
    })
  })
})
