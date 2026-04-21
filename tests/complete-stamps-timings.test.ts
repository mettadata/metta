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

// Long enough (over 200 bytes) to clear the content-sanity floor in
// `metta complete`. Stays simple so the test stays readable.
const INTENT_MD = `# stamp-demo

## Problem

This change exercises the timing stamp path. It needs to be at least two
hundred bytes of real content so the content-sanity check in metta
complete does not complain about a stub artifact.

## Proposal

Exercise the stamping code in metta complete. Nothing else.

## Impact

None — this is a test artifact.

## Out of Scope

Everything else.
`

describe('metta complete stamps artifact_timings.completed', { timeout: 30000 }, () => {
  let tempDir: string
  let specDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-complete-stamp-'))
    specDir = join(tempDir, 'spec')
    await mkdir(specDir, { recursive: true })
    await mkdir(join(tempDir, '.metta'), { recursive: true })
    await writeFile(
      join(tempDir, '.metta', 'config.yaml'),
      'project:\n  name: stamp-test\n',
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('stamps artifact_timings[intent].completed on mark-complete', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('stamp demo', 'quick', ['intent'])
    await store.writeArtifact('stamp-demo', 'intent.md', INTENT_MD)

    const before = Date.now()
    const result = await runCli(
      ['--json', 'complete', 'intent', '--change', 'stamp-demo'],
      tempDir,
    )
    const after = Date.now()
    expect(result.code).toBe(0)

    const meta = await store.getChange('stamp-demo')
    const completed = meta.artifact_timings?.intent?.completed
    expect(typeof completed).toBe('string')
    const t = Date.parse(completed ?? '')
    expect(t).toBeGreaterThanOrEqual(before - 1000)
    expect(t).toBeLessThanOrEqual(after + 1000)
  })

  it('preserves a pre-existing artifact_timings[intent].started', async () => {
    const store = new ArtifactStore(specDir)
    await store.createChange('stamp demo', 'quick', ['intent'])
    await store.writeArtifact('stamp-demo', 'intent.md', INTENT_MD)
    await store.updateChange('stamp-demo', {
      artifact_timings: { intent: { started: '2026-04-21T09:00:00.000Z' } },
    })

    const result = await runCli(
      ['--json', 'complete', 'intent', '--change', 'stamp-demo'],
      tempDir,
    )
    expect(result.code).toBe(0)

    const meta = await store.getChange('stamp-demo')
    expect(meta.artifact_timings?.intent?.started).toBe(
      '2026-04-21T09:00:00.000Z',
    )
    expect(meta.artifact_timings?.intent?.completed).toBeDefined()
  })
})
