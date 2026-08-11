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

describe('metta model-escalation record', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-model-esc-cmd-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    // Minimal .metta/config.yaml so the preAction hook's ConfigLoader does not
    // blow up on a missing file.
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: model-esc-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('first record sets model_escalations to a one-element array with the correct fields', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('esc demo', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'model-escalation', 'record',
        '--task', 'implementation',
        '--from', 'sonnet',
        '--to', 'inherit',
        '--trigger', 'stop_deviation',
        '--change', 'esc-demo',
      ],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload).toEqual({
      change: 'esc-demo',
      task: 'implementation',
      from_model: 'sonnet',
      to_model: 'inherit',
      trigger: 'stop_deviation',
    })

    const meta = await store.getChange('esc-demo')
    expect(meta.model_escalations).toHaveLength(1)
    const record = meta.model_escalations![0]
    expect(record.task).toBe('implementation')
    expect(record.from_model).toBe('sonnet')
    expect(record.to_model).toBe('inherit')
    expect(record.trigger).toBe('stop_deviation')
    // ISO timestamp round-trip
    const parsed = new Date(record.timestamp)
    expect(Number.isNaN(parsed.getTime())).toBe(false)
    expect(parsed.toISOString()).toBe(record.timestamp)
  })

  it('appends subsequent records', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('esc demo', 'quick', ['intent'])

    for (const trigger of ['stop_deviation', 'verify_fail']) {
      const result = await runCli(
        [
          '--json', 'model-escalation', 'record',
          '--task', 'implementation',
          '--from', 'sonnet',
          '--to', 'inherit',
          '--trigger', trigger,
          '--change', 'esc-demo',
        ],
        tempDir,
      )
      expect(result.code).toBe(0)
    }

    const meta = await store.getChange('esc-demo')
    expect(meta.model_escalations).toHaveLength(2)
    expect(meta.model_escalations![1].trigger).toBe('verify_fail')
  })

  it('rejects an invalid --trigger value without mutating model_escalations', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('esc demo', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'model-escalation', 'record',
        '--task', 'implementation',
        '--from', 'sonnet',
        '--to', 'inherit',
        '--trigger', 'bogus',
        '--change', 'esc-demo',
      ],
      tempDir,
    )
    expect(result.code).not.toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('model_escalation_error')
    expect(payload.error?.message).toMatch(/trigger/i)

    const meta = await store.getChange('esc-demo')
    expect(meta.model_escalations).toBeUndefined()
  })

  it('auto-selects the single active change when --change is omitted', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('only change', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'model-escalation', 'record',
        '--task', 'implementation',
        '--from', 'haiku',
        '--to', 'inherit',
        '--trigger', 'verify_fail',
      ],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.change).toBe('only-change')

    const meta = await store.getChange('only-change')
    expect(meta.model_escalations).toHaveLength(1)
    expect(meta.model_escalations![0].from_model).toBe('haiku')
  })

  it('errors listing all changes when more than one exists and --change is omitted', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('change one', 'quick', ['intent'])
    await store.createChange('change two', 'quick', ['intent'])

    const result = await runCli(
      [
        '--json', 'model-escalation', 'record',
        '--task', 'implementation',
        '--from', 'sonnet',
        '--to', 'inherit',
        '--trigger', 'stop_deviation',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('model_escalation_error')
    expect(payload.error?.message).toContain('change-one')
    expect(payload.error?.message).toContain('change-two')
  })

  it('errors with exit 4 when the named change does not exist', async () => {
    const result = await runCli(
      [
        '--json', 'model-escalation', 'record',
        '--task', 'implementation',
        '--from', 'sonnet',
        '--to', 'inherit',
        '--trigger', 'stop_deviation',
        '--change', 'no-such-change',
      ],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('model_escalation_error')
  })
})
