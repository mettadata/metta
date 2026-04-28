import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)

const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe('metta propose --stop-after', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-propose-stop-after-'))
    await runCli(['install', '--git-init'], tempDir)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('persists stop_after when --stop-after is a valid planning artifact id', async () => {
    const { stdout, code } = await runCli(
      ['--json', 'propose', 'demo with tasks stop', '--stop-after', 'tasks'],
      tempDir,
    )
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.stop_after).toBe('tasks')
    const yamlPath = join(tempDir, 'spec', 'changes', data.change, '.metta.yaml')
    const yaml = await readFile(yamlPath, 'utf8')
    expect(yaml).toContain('stop_after: tasks')
  })

  it('rejects unknown --stop-after value with helpful error and writes no state', async () => {
    const { stdout, stderr, code } = await runCli(
      ['--json', 'propose', 'reject unknown stop', '--stop-after', 'spex'],
      tempDir,
    )
    expect(code).toBe(4)
    const text = stdout + stderr
    expect(text).toContain('spex')
    // Error MUST list the valid planning ids for the standard workflow
    expect(text).toContain('intent')
    expect(text).toContain('tasks')
    // No change directory should have been created
    const reject = await pathExists(join(tempDir, 'spec', 'changes', 'reject-unknown-stop'))
    expect(reject).toBe(false)
  })

  it('rejects execution-phase --stop-after values', async () => {
    const { stdout, stderr, code } = await runCli(
      ['--json', 'propose', 'reject impl stop', '--stop-after', 'implementation'],
      tempDir,
    )
    expect(code).toBe(4)
    const text = stdout + stderr
    expect(text).toContain('execution-phase')
    expect(text).toContain('implementation')
    const reject = await pathExists(join(tempDir, 'spec', 'changes', 'reject-impl-stop'))
    expect(reject).toBe(false)
  })

  it('rejects --stop-after verification as execution-phase', async () => {
    const { stdout, stderr, code } = await runCli(
      ['--json', 'propose', 'reject verify stop', '--stop-after', 'verification'],
      tempDir,
    )
    expect(code).toBe(4)
    const text = stdout + stderr
    expect(text).toContain('execution-phase')
    expect(text).toContain('verification')
  })

  it('omits stop_after from JSON when --stop-after is not supplied', async () => {
    const { stdout, code } = await runCli(
      ['--json', 'propose', 'no stop flag here'],
      tempDir,
    )
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    // The CLI may emit stop_after: null when absent — both shapes are acceptable.
    expect(data.stop_after === null || data.stop_after === undefined).toBe(true)
    const yamlPath = join(tempDir, 'spec', 'changes', data.change, '.metta.yaml')
    const yaml = await readFile(yamlPath, 'utf8')
    expect(yaml).not.toContain('stop_after:')
  })

  it('composes with --workflow and --auto', async () => {
    const { stdout, code } = await runCli(
      [
        '--json',
        'propose',
        'composed flags propose',
        '--workflow',
        'standard',
        '--stop-after',
        'spec',
        '--auto',
      ],
      tempDir,
    )
    expect(code).toBe(0)
    const data = JSON.parse(stdout)
    expect(data.stop_after).toBe('spec')
    expect(data.workflow).toBe('standard')
    const yamlPath = join(tempDir, 'spec', 'changes', data.change, '.metta.yaml')
    const yaml = await readFile(yamlPath, 'utf8')
    expect(yaml).toContain('stop_after: spec')
    expect(yaml).toContain('auto_accept_recommendation: true')
  })

  it('metta status --json surfaces stop_after when set', async () => {
    const { stdout: pStdout } = await runCli(
      ['--json', 'propose', 'status surfaces stop', '--stop-after', 'spec'],
      tempDir,
    )
    const pData = JSON.parse(pStdout)
    const { stdout: sStdout, code } = await runCli(
      ['--json', 'status', '--change', pData.change],
      tempDir,
    )
    expect(code).toBe(0)
    const sData = JSON.parse(sStdout)
    expect(sData.stop_after).toBe('spec')
  })

  it('metta status --json omits or nulls stop_after when not set', async () => {
    const { stdout: pStdout } = await runCli(
      ['--json', 'propose', 'status no stop here'],
      tempDir,
    )
    const pData = JSON.parse(pStdout)
    const { stdout: sStdout, code } = await runCli(
      ['--json', 'status', '--change', pData.change],
      tempDir,
    )
    expect(code).toBe(0)
    const sData = JSON.parse(sStdout)
    expect(sData.stop_after === undefined || sData.stop_after === null).toBe(true)
  })
})
