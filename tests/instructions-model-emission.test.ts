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

describe('metta instructions model emission, ratchet, and model_runs denominator', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string
  let store: ArtifactStore

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-instr-model-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: instr-model-test\nmodels:\n  profile: budget\n',
    )
    store = new ArtifactStore(specDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('first executor generation resolves sonnet and appends exactly one model_runs record', async () => {
    // implementation first so its status is 'ready' — the same guard the
    // timing/token stamps use.
    await store.createChange('model emit', 'quick', ['implementation', 'verification'])

    const before = Date.now()
    const result = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'model-emit'],
      tempDir,
    )
    const after = Date.now()
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.agent.model).toBe('sonnet')

    const meta = await store.getChange('model-emit')
    expect(meta.model_runs).toHaveLength(1)
    expect(meta.model_runs?.[0]?.task).toBe('implementation')
    expect(meta.model_runs?.[0]?.model).toBe('sonnet')
    const t = Date.parse(meta.model_runs?.[0]?.timestamp ?? '')
    expect(t).toBeGreaterThanOrEqual(before - 1000)
    expect(t).toBeLessThanOrEqual(after + 1000)
  })

  it('escalation ratchet forces inherit and stops model_runs appends', async () => {
    await store.createChange('model emit', 'quick', ['implementation', 'verification'])

    // First generation resolves cheap and records the run.
    const first = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'model-emit'],
      tempDir,
    )
    expect(first.code).toBe(0)
    expect(JSON.parse(first.stdout).agent.model).toBe('sonnet')
    const afterFirst = await store.getChange('model-emit')
    expect(afterFirst.model_runs).toHaveLength(1)

    // Record a Rung-1 escalation for this task directly in the change metadata.
    await store.updateChange('model-emit', {
      model_escalations: [
        {
          task: 'implementation',
          from_model: 'sonnet',
          to_model: 'inherit',
          trigger: 'stop_deviation',
          timestamp: new Date().toISOString(),
        },
      ],
    })

    // The ratchet is one-way: every subsequent generation for this artifact
    // resolves inherit and appends no further model_runs record.
    const second = await runCli(
      ['--json', 'instructions', 'implementation', '--change', 'model-emit'],
      tempDir,
    )
    expect(second.code).toBe(0)
    expect(JSON.parse(second.stdout).agent.model).toBe('inherit')

    const afterSecond = await store.getChange('model-emit')
    expect(afterSecond.model_runs).toHaveLength(1)
  })

  it('a non-executor artifact never appends a model_runs record', async () => {
    // intent (proposer) is first and therefore 'ready' — the stamp block runs
    // for it, but the model_runs append is gated on the executor role.
    await store.createChange('model emit intent', 'quick', ['intent', 'implementation'])

    const result = await runCli(
      ['--json', 'instructions', 'intent', '--change', 'model-emit-intent'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.agent.model).toBe('inherit')

    const meta = await store.getChange('model-emit-intent')
    // Timing stamps happened (artifact was ready) but no model_runs record.
    expect(meta.artifact_timings?.intent?.started).toBeDefined()
    expect(meta.model_runs).toBeUndefined()
  })
})
