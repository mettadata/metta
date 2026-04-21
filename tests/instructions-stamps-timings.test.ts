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
      { cwd, timeout: 20000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('metta instructions stamps timings + tokens', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-stamp-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('stamps artifact_timings[intent].started and artifact_tokens[intent] on first call', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('instr demo', 'quick', ['intent'])

    const before = Date.now()
    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'instr-demo'],
      tempDir,
    )
    const after = Date.now()
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.budget?.context_tokens).toBeGreaterThanOrEqual(0)
    expect(payload.budget?.budget_tokens).toBeGreaterThan(0)

    const meta = await store.getChange('instr-demo')
    const started = meta.artifact_timings?.intent?.started
    expect(typeof started).toBe('string')
    const t = Date.parse(started ?? '')
    expect(t).toBeGreaterThanOrEqual(before - 1000)
    expect(t).toBeLessThanOrEqual(after + 1000)

    expect(meta.artifact_tokens?.intent?.context).toBe(payload.budget.context_tokens)
    expect(meta.artifact_tokens?.intent?.budget).toBe(payload.budget.budget_tokens)
  })

  it('does not overwrite artifact_timings[intent].started on re-invocation', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('instr demo', 'quick', ['intent'])
    await store.updateChange('instr-demo', {
      artifact_timings: { intent: { started: '2026-04-21T08:00:00.000Z' } },
    })

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'instr-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const meta = await store.getChange('instr-demo')
    expect(meta.artifact_timings?.intent?.started).toBe(
      '2026-04-21T08:00:00.000Z',
    )
  })

  it('overwrites artifact_tokens[intent] on re-invocation', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('instr demo', 'quick', ['intent'])
    await store.updateChange('instr-demo', {
      artifact_tokens: { intent: { context: 999, budget: 111 } },
    })

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'instr-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)

    const meta = await store.getChange('instr-demo')
    // Overwritten with the freshly-computed budget numbers (not 999/111).
    expect(meta.artifact_tokens?.intent?.context).toBe(payload.budget.context_tokens)
    expect(meta.artifact_tokens?.intent?.budget).toBe(payload.budget.budget_tokens)
  })
})
