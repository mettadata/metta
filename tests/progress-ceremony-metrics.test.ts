import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync } from './helpers/cli.js'

async function writeArchiveMetadata(
  tempDir: string,
  entryName: string,
  workflow: string,
  artifactIds: string[],
  opts: { modelRuns?: number; modelEscalations?: number } = {},
): Promise<void> {
  const dir = join(tempDir, 'spec', 'archive', entryName)
  await mkdir(dir, { recursive: true })
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
  lines.push('')
  await writeFile(join(dir, '.metta.yaml'), lines.join('\n'), 'utf8')
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
})
