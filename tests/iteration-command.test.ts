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

describe('metta iteration record', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-iter-cmd-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    // Minimal .metta/config.yaml so the preAction hook's ConfigLoader does not
    // blow up on a missing file.
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: iter-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('first record sets review_iterations to 1', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('iter demo', 'quick', ['intent'])

    const result = await runCli(
      ['--json', 'iteration', 'record', '--phase', 'review', '--change', 'iter-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.count).toBe(1)
    expect(payload.phase).toBe('review')

    const meta = await store.getChange('iter-demo')
    expect(meta.review_iterations).toBe(1)
  })

  it('subsequent records increment review counter', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('iter demo', 'quick', ['intent'])

    for (let i = 1; i <= 3; i++) {
      const result = await runCli(
        ['--json', 'iteration', 'record', '--phase', 'review', '--change', 'iter-demo'],
        tempDir,
      )
      expect(result.code).toBe(0)
      const payload = JSON.parse(result.stdout)
      expect(payload.count).toBe(i)
    }

    const meta = await store.getChange('iter-demo')
    expect(meta.review_iterations).toBe(3)
  })

  it('review and verify counters are independent', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('iter demo', 'quick', ['intent'])

    await runCli(
      ['--json', 'iteration', 'record', '--phase', 'review', '--change', 'iter-demo'],
      tempDir,
    )
    await runCli(
      ['--json', 'iteration', 'record', '--phase', 'review', '--change', 'iter-demo'],
      tempDir,
    )
    await runCli(
      ['--json', 'iteration', 'record', '--phase', 'verify', '--change', 'iter-demo'],
      tempDir,
    )

    const meta = await store.getChange('iter-demo')
    expect(meta.review_iterations).toBe(2)
    expect(meta.verify_iterations).toBe(1)
  })

  it('auto-selects the single active change when --change is omitted', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('only change', 'quick', ['intent'])

    const result = await runCli(
      ['--json', 'iteration', 'record', '--phase', 'verify'],
      tempDir,
    )
    expect(result.code).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.count).toBe(1)
    expect(payload.change).toBe('only-change')
  })

  it('rejects invalid --phase value', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('iter demo', 'quick', ['intent'])

    const result = await runCli(
      ['--json', 'iteration', 'record', '--phase', 'bogus', '--change', 'iter-demo'],
      tempDir,
    )
    expect(result.code).not.toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('iteration_error')
    expect(payload.error?.message).toMatch(/phase/i)

    const meta = await store.getChange('iter-demo')
    expect(meta.review_iterations).toBeUndefined()
    expect(meta.verify_iterations).toBeUndefined()
  })

  it('errors with exit 4 when the named change does not exist', async () => {
    const result = await runCli(
      ['--json', 'iteration', 'record', '--phase', 'review', '--change', 'no-such-change'],
      tempDir,
    )
    expect(result.code).toBe(4)
    const payload = JSON.parse(result.stdout)
    expect(payload.error?.type).toBe('iteration_error')
  })
})
