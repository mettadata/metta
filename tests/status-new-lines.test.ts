import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ArtifactStore } from '../src/artifacts/artifact-store.js'

const execAsync = promisify(execFile)
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: 15000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '')
}

describe('metta status — Tokens: / Iterations: lines', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-status-lines-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: status-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('legacy change (no new fields) prints no Tokens:/Iterations: lines', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('legacy demo', 'quick', ['intent'])

    const result = await runCli(['status', 'legacy-demo'], tempDir)
    expect(result.code).toBe(0)
    const plain = stripAnsi(result.stdout)
    expect(plain).not.toContain('Tokens:')
    expect(plain).not.toContain('Iterations:')
  })

  it('renders Tokens: and Iterations: when populated', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('full demo', 'quick', ['intent'])
    await store.updateChange('full-demo', {
      artifact_tokens: { intent: { context: 4086, budget: 40000 } },
      review_iterations: 2,
      verify_iterations: 1,
    })

    const result = await runCli(['status', 'full-demo'], tempDir)
    expect(result.code).toBe(0)
    const plain = stripAnsi(result.stdout)
    expect(plain).toContain('Tokens: 4k / 40k')
    expect(plain).toContain('Iterations: review ×2, verify ×1')
  })

  it('suppresses verify half when only review counter > 0', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('half demo', 'quick', ['intent'])
    await store.updateChange('half-demo', {
      review_iterations: 3,
      verify_iterations: 0,
    })

    const result = await runCli(['status', 'half-demo'], tempDir)
    expect(result.code).toBe(0)
    const plain = stripAnsi(result.stdout)
    expect(plain).toContain('Iterations: review ×3')
    expect(plain).not.toContain('verify ×')
  })

  it('JSON output carries new optional fields verbatim', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('json demo', 'quick', ['intent'])
    await store.updateChange('json-demo', {
      artifact_timings: { intent: { started: '2026-04-21T10:00:00.000Z' } },
      artifact_tokens: { intent: { context: 100, budget: 1000 } },
      review_iterations: 1,
    })

    const result = await runCli(['--json', 'status', 'json-demo'], tempDir)
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.artifact_timings?.intent?.started).toBe('2026-04-21T10:00:00.000Z')
    expect(payload.artifact_tokens?.intent?.budget).toBe(1000)
    expect(payload.review_iterations).toBe(1)
  })
})
