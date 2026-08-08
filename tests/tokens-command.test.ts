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

describe('metta tokens record', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-tokens-cmd-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    // Minimal .metta/config.yaml so the preAction hook's ConfigLoader does not
    // blow up on a missing file.
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: tokens-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('first record sets token_usage to a one-element array with the correct fields', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('tokens demo', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'sonnet',
        '--tokens', '12345',
        '--change', 'tokens-demo',
      ],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload).toEqual({
      change: 'tokens-demo',
      task: 'implementation',
      agent: 'metta-executor',
      model: 'sonnet',
      tokens: 12345,
    })

    const meta = await store.getChange('tokens-demo')
    expect(meta.token_usage).toHaveLength(1)
    const record = meta.token_usage![0]
    expect(record.task).toBe('implementation')
    expect(record.agent).toBe('metta-executor')
    expect(record.model).toBe('sonnet')
    expect(record.tokens).toBe(12345)
    // ISO timestamp round-trip
    const parsed = new Date(record.timestamp)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    expect(parsed.toISOString()).toBe(record.timestamp)
  })

  it('appends subsequent records preserving earlier ones', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('tokens demo', 'quick', ['intent'])

    for (const [agent, count] of [
      ['metta-executor', '100'],
      ['metta-verifier', '200'],
    ]) {
      const result = await runCli(
        [
          '--json', 'tokens', 'record',
          '--task', 'implementation',
          '--agent', agent,
          '--model', 'sonnet',
          '--tokens', count,
          '--change', 'tokens-demo',
        ],
        tempDir,
      )
      expect(result.code).toBe(0)
    }

    const meta = await store.getChange('tokens-demo')
    expect(meta.token_usage).toHaveLength(2)
    expect(meta.token_usage![0].agent).toBe('metta-executor')
    expect(meta.token_usage![0].tokens).toBe(100)
    expect(meta.token_usage![1].agent).toBe('metta-verifier')
    expect(meta.token_usage![1].tokens).toBe(200)
  })

  it('rejects a negative --tokens value without mutating token_usage', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('tokens demo', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'sonnet',
        '--tokens', '-5',
        '--change', 'tokens-demo',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('tokens_record_error')

    const meta = await store.getChange('tokens-demo')
    expect(meta.token_usage).toBeUndefined()
  })

  it('rejects a non-integer --tokens value without mutating token_usage', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('tokens demo', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'sonnet',
        '--tokens', '12.5',
        '--change', 'tokens-demo',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('tokens_record_error')

    const meta = await store.getChange('tokens-demo')
    expect(meta.token_usage).toBeUndefined()
  })

  it('rejects an invalid --model alias without mutating token_usage', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('tokens demo', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'gpt-9000',
        '--tokens', '100',
        '--change', 'tokens-demo',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('tokens_record_error')

    const meta = await store.getChange('tokens-demo')
    expect(meta.token_usage).toBeUndefined()
  })

  it('auto-selects the single active change when --change is omitted', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('only change', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'haiku',
        '--tokens', '42',
      ],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.change).toBe('only-change')

    const meta = await store.getChange('only-change')
    expect(meta.token_usage).toHaveLength(1)
    expect(meta.token_usage![0].model).toBe('haiku')
  })

  it('errors listing all changes when more than one exists and --change is omitted', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('change one', 'quick', ['intent'])
    await store.createChange('change two', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'sonnet',
        '--tokens', '100',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('tokens_record_error')
    expect(payload.error?.message).toContain('change-one')
    expect(payload.error?.message).toContain('change-two')
  })

  it('errors with exit 4 when the named change does not exist', async () => {
    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'sonnet',
        '--tokens', '100',
        '--change', 'no-such-change',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('tokens_record_error')
  })

  it('explicit --change beta leaves alpha untouched', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('alpha', 'quick', ['intent'])
    await store.createChange('beta', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'tokens', 'record',
        '--task', 'implementation',
        '--agent', 'metta-executor',
        '--model', 'sonnet',
        '--tokens', '777',
        '--change', 'beta',
      ],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.change).toBe('beta')

    const betaMeta = await store.getChange('beta')
    expect(betaMeta.token_usage).toHaveLength(1)
    expect(betaMeta.token_usage![0].tokens).toBe(777)

    const alphaMeta = await store.getChange('alpha')
    expect(alphaMeta.token_usage).toBeUndefined()
  })
})
