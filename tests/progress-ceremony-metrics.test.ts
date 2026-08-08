import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync } from './helpers/cli.js'

interface MetadataOpts {
  modelRuns?: number
  modelEscalations?: number
  tokenUsage?: number[]
}

async function writeChangeMetadataFile(
  dir: string,
  workflow: string,
  status: string,
  artifactIds: string[],
  opts: MetadataOpts,
): Promise<void> {
  await mkdir(dir, { recursive: true })
  const artifacts = artifactIds.map(id => `  ${id}: complete`).join('\n')
  const lines = [
    `workflow: ${workflow}`,
    'created: 2026-07-01T10:00:00.000Z',
    `status: ${status}`,
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
  await writeFile(join(dir, '.metta.yaml'), lines.join('\n'), 'utf8')
}

async function writeArchiveMetadata(
  tempDir: string,
  entryName: string,
  workflow: string,
  artifactIds: string[],
  opts: MetadataOpts = {},
): Promise<void> {
  await writeChangeMetadataFile(
    join(tempDir, 'spec', 'archive', entryName),
    workflow,
    'complete',
    artifactIds,
    opts,
  )
}

async function writeActiveChangeMetadata(
  tempDir: string,
  name: string,
  workflow: string,
  artifactIds: string[],
  opts: MetadataOpts = {},
): Promise<void> {
  await writeChangeMetadataFile(
    join(tempDir, 'spec', 'changes', name),
    workflow,
    'active',
    artifactIds,
    opts,
  )
}

describe('CLI: progress ceremony metrics', { timeout: 60000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-progress-ceremony-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('--json includes ceremony_commit_ratio and null artifacts_per_small_change when archive is empty', async () => {
    await runCli(['install', '--git-init'], tempDir)
    const { stdout, code } = await runCli(['--json', 'progress'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    // install --git-init lands at least one commit, so git data exists.
    expect(data.ceremony_commit_ratio).not.toBeNull()
    expect(typeof data.ceremony_commit_ratio.ceremony).toBe('number')
    expect(typeof data.ceremony_commit_ratio.total).toBe('number')
    expect(typeof data.ceremony_commit_ratio.ratio).toBe('number')
    expect(data.ceremony_commit_ratio.total).toBeGreaterThan(0)
    // No archived quick/trivial changes — null passthrough, never 0.
    expect('artifacts_per_small_change' in data).toBe(true)
    expect(data.artifacts_per_small_change).toBeNull()
    // No model_runs recorded anywhere — explicit no-data null, never 0.
    expect('model_escalation_rate' in data).toBe(true)
    expect(data.model_escalation_rate).toBeNull()
    // No token_usage reported anywhere — every tier is null, never 0.
    expect('avg_tokens_per_change_by_tier' in data).toBe(true)
    expect(data.avg_tokens_per_change_by_tier).toEqual({
      trivial: null,
      quick: null,
      standard: null,
      full: null,
    })
  })

  it('--json reports model_escalation_rate over recorded model_runs and model_escalations', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await writeArchiveMetadata(tempDir, '2026-07-01-cheap-runs', 'quick', ['intent', 'implementation'], {
      modelRuns: 4,
      modelEscalations: 1,
    })

    const { stdout, code } = await runCli(['--json', 'progress'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.model_escalation_rate).toEqual({ escalated: 1, total: 4, rate: 0.25 })
  })

  it('--json reports mean/sample_size over archived quick/trivial changes', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await writeArchiveMetadata(tempDir, '2026-07-01-quick-one', 'quick', ['intent', 'implementation', 'verification'])
    await writeArchiveMetadata(tempDir, '2026-07-02-trivial-one', 'trivial', ['intent', 'implementation'])
    await writeArchiveMetadata(tempDir, '2026-07-03-standard-one', 'standard', ['intent', 'spec', 'design', 'tasks'])

    const { stdout, code } = await runCli(['--json', 'progress'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.artifacts_per_small_change).toEqual({ mean: 2.5, sample_size: 2 })
  })

  it('--json passes ceremony_commit_ratio through as null when git log fails (no commits)', async () => {
    await execAsync('git', ['init', '--initial-branch=main'], { cwd: tempDir })
    const { stdout, code } = await runCli(['--json', 'progress'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect('ceremony_commit_ratio' in data).toBe(true)
    expect(data.ceremony_commit_ratio).toBeNull()
    expect(data.artifacts_per_small_change).toBeNull()
  })

  it('human output renders the ceremony line and explicit no-data wording', async () => {
    await runCli(['install', '--git-init'], tempDir)
    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toMatch(/Ceremony commits: \d+% \(\d+\/\d+ chore\/docs\)/)
    expect(stdout).toContain('Artifacts per small change: no data')
    expect(stdout).toContain('Model escalation rate: no data')
  })

  it('human output renders the numeric model escalation rate when model_runs exist', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await writeArchiveMetadata(tempDir, '2026-07-01-cheap-runs', 'quick', ['intent', 'implementation'], {
      modelRuns: 4,
      modelEscalations: 1,
    })

    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain('Model escalation rate: 25% (1/4 cheap-tier runs escalated)')
    expect(stdout).not.toContain('Model escalation rate: no data')
  })

  it('human output renders the artifacts average and no-data ceremony wording', async () => {
    await execAsync('git', ['init', '--initial-branch=main'], { cwd: tempDir })
    await writeArchiveMetadata(tempDir, '2026-07-01-quick-one', 'quick', ['intent', 'implementation', 'verification'])
    await writeArchiveMetadata(tempDir, '2026-07-02-trivial-one', 'trivial', ['intent', 'implementation'])

    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain('Ceremony commits: no data')
    expect(stdout).toContain('Artifacts per small change: 2.5 (avg over 2 quick/trivial changes)')
  })

  it('--json and human output include the windowed ceremony ratio when a tag is present', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await execAsync('git', ['tag', 'v1.0.0'], { cwd: tempDir })
    await execAsync('git', ['commit', '--allow-empty', '-m', 'chore: post-tag ceremony'], { cwd: tempDir })
    await execAsync('git', ['commit', '--allow-empty', '-m', 'feat: post-tag functional'], { cwd: tempDir })

    const { stdout: jsonStdout, code: jsonCode } = await runCli(['--json', 'progress'], tempDir)
    expect(jsonCode).toBe(0)
    const data = JSON.parse(jsonStdout)
    expect(data.ceremony_commit_ratio).not.toBeNull()
    expect(data.ceremony_commit_ratio_windowed).toEqual({
      ref: 'v1.0.0',
      ceremony: 1,
      total: 2,
      rate: 0.5,
    })

    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toMatch(/Ceremony commits: \d+% all-time \(\d+\/\d+\) · 50% since v1\.0\.0 \(1\/2\)/)
  })

  it('--json and human output omit the windowed ceremony ratio when no tag exists and no override is given', async () => {
    await runCli(['install', '--git-init'], tempDir)

    const { stdout: jsonStdout, code: jsonCode } = await runCli(['--json', 'progress'], tempDir)
    expect(jsonCode).toBe(0)
    const data = JSON.parse(jsonStdout)
    expect('ceremony_commit_ratio_windowed' in data).toBe(true)
    expect(data.ceremony_commit_ratio_windowed).toBeNull()

    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    // Current all-time-only format preserved — no "all-time" label, no "since".
    expect(stdout).toMatch(/Ceremony commits: \d+% \(\d+\/\d+ chore\/docs\)/)
    expect(stdout).not.toContain('all-time')
    expect(stdout).not.toContain('since')
  })

  it('--ceremony-since overrides the default window ref', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await execAsync('git', ['tag', 'v1.0.0'], { cwd: tempDir })
    await execAsync('git', ['commit', '--allow-empty', '-m', 'chore: a'], { cwd: tempDir })
    await execAsync('git', ['tag', 'v2.0.0'], { cwd: tempDir })
    await execAsync('git', ['commit', '--allow-empty', '-m', 'feat: b'], { cwd: tempDir })

    const { stdout: jsonStdout, code: jsonCode } = await runCli(
      ['--json', 'progress', '--ceremony-since', 'v1.0.0'],
      tempDir,
    )
    expect(jsonCode).toBe(0)
    const data = JSON.parse(jsonStdout)
    expect(data.ceremony_commit_ratio_windowed).toEqual({
      ref: 'v1.0.0',
      ceremony: 1,
      total: 2,
      rate: 0.5,
    })

    const { stdout, code } = await runCli(['progress', '--ceremony-since', 'v1.0.0'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain('since v1.0.0 (1/2)')
  })

  it('--json averages token_usage per tier across active and archived changes, null for no-data tiers', async () => {
    await runCli(['install', '--git-init'], tempDir)
    // Active quick change: 30k total; archived quick change: 10k total.
    await writeActiveChangeMetadata(tempDir, 'active-quick', 'quick', ['intent', 'implementation'], {
      tokenUsage: [20000, 10000],
    })
    await writeArchiveMetadata(tempDir, '2026-07-01-quick-one', 'quick', ['intent', 'implementation'], {
      tokenUsage: [10000],
    })
    await writeArchiveMetadata(tempDir, '2026-07-02-standard-one', 'standard', ['intent', 'spec', 'tasks'], {
      tokenUsage: [50000],
    })
    // Pre-feature archive without a token_usage field — skipped, not counted as 0.
    await writeArchiveMetadata(tempDir, '2026-06-01-quick-legacy', 'quick', ['intent', 'implementation'])

    const { stdout, code } = await runCli(['--json', 'progress'], tempDir)
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.avg_tokens_per_change_by_tier).toEqual({
      trivial: null,
      quick: { mean: 20000, sample_size: 2 },
      standard: { mean: 50000, sample_size: 1 },
      full: null,
    })
  })

  it('human output renders all four tiers in order with formatted values and no-data wording', async () => {
    await runCli(['install', '--git-init'], tempDir)
    await writeActiveChangeMetadata(tempDir, 'active-quick', 'quick', ['intent', 'implementation'], {
      tokenUsage: [30000],
    })
    await writeArchiveMetadata(tempDir, '2026-07-01-quick-one', 'quick', ['intent', 'implementation'], {
      tokenUsage: [10000],
    })
    await writeArchiveMetadata(tempDir, '2026-07-02-standard-one', 'standard', ['intent', 'spec', 'tasks'], {
      tokenUsage: [50000],
    })
    // Pre-feature archive without a token_usage field — skipped without error.
    await writeArchiveMetadata(tempDir, '2026-06-01-quick-legacy', 'quick', ['intent', 'implementation'])

    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain(
      'Avg tokens per change: trivial no data · quick 20k · standard 50k · full no data',
    )
  })

  it('human output shows no data for every tier when nothing reports token_usage', async () => {
    await runCli(['install', '--git-init'], tempDir)
    const { stdout, code } = await runCli(['progress'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain(
      'Avg tokens per change: trivial no data · quick no data · standard no data · full no data',
    )
  })

  it('--ceremony-since with an unknown ref reports no data, names the ref, and exits 0', async () => {
    await runCli(['install', '--git-init'], tempDir)

    const { stdout: jsonStdout, code: jsonCode } = await runCli(
      ['--json', 'progress', '--ceremony-since', 'nonexistent-ref'],
      tempDir,
    )
    expect(jsonCode).toBe(0)
    const data = JSON.parse(jsonStdout)
    expect(data.ceremony_commit_ratio_windowed).toBeNull()
    // The all-time figure must still be reported normally.
    expect(data.ceremony_commit_ratio).not.toBeNull()

    const { stdout, code } = await runCli(['progress', '--ceremony-since', 'nonexistent-ref'], tempDir)
    expect(code).toBe(0)
    expect(stdout).toContain('since nonexistent-ref: no data')
  })
})
