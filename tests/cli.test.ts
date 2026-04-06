import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(execFile)

// Build first, then test the CLI binary
const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli', 'index.ts')

async function runCli(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx',
      ['tsx', CLI_PATH, ...args],
      { cwd, timeout: 10000 },
    )
    return { stdout, stderr, code: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
  }
}

describe('CLI', { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('metta --version', () => {
    it('prints version', async () => {
      const { stdout } = await runCli(['--version'], tempDir)
      expect(stdout.trim()).toBe('0.1.0')
    })
  })

  describe('metta install', () => {
    it('returns git_missing JSON when no git repo detected', async () => {
      const { stdout, code } = await runCli(['--json', 'install'], tempDir)
      expect(code).toBe(3)
      const data = JSON.parse(stdout)
      expect(data.status).toBe('git_missing')
    })

    it('creates git repo with --git-init flag', async () => {
      const { stdout, code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('initialized')

      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, '.git'))).toBe(true)
      expect(existsSync(join(tempDir, '.metta'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'project.md'))).toBe(true)
    })

    it('outputs JSON with git_initialized when --git-init is used', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.status).toBe('initialized')
      expect(data.git_initialized).toBe(true)
      expect(data.constitution).toBe('spec/project.md')
    })

    it('works normally when git repo already exists', async () => {
      await execAsync('git', ['init'], { cwd: tempDir })
      const { stdout, code } = await runCli(['install'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('initialized')
    })
  })

  describe('metta status', () => {
    it('reports no active changes', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.changes).toEqual([])
    })
  })

  describe('metta propose', () => {
    it('creates a change with standard workflow', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'propose', 'add user profiles'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('user-profiles')
      expect(data.workflow).toBe('standard')
      expect(data.artifacts.length).toBeGreaterThan(0)
    })
  })

  describe('metta quick', () => {
    it('creates a quick-mode change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'quick', 'fix typo'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('fix-typo')
      expect(data.workflow).toBe('quick')
    })
  })

  describe('metta status after propose', () => {
    it('shows the active change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'test change'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('test-change')
      expect(data.workflow).toBe('standard')
    })
  })

  describe('metta idea', () => {
    it('captures an idea', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'idea', 'dark mode toggle'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('dark-mode-toggle')
    })
  })

  describe('metta issue', () => {
    it('logs an issue with severity', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'issue', 'login flash', '--severity', 'major'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.slug).toBe('login-flash')
      expect(data.severity).toBe('major')
    })
  })

  describe('metta doctor', () => {
    it('runs health checks', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'doctor'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.checks.length).toBeGreaterThan(0)
    })
  })

  describe('metta changes list', () => {
    it('lists active changes', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'change one'], tempDir)
      await runCli(['propose', 'change two'], tempDir)
      const { stdout } = await runCli(['--json', 'changes', 'list'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.changes.length).toBe(2)
    })
  })

  describe('metta changes abandon', () => {
    it('abandons a change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'something to abandon'], tempDir)
      const { stdout, code } = await runCli(['--json', 'changes', 'abandon', 'something-abandon'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.abandoned).toBe('something-abandon')
    })
  })

  describe('metta gate list', () => {
    it('lists built-in gates', async () => {
      const { stdout } = await runCli(['--json', 'gate', 'list'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.gates.length).toBeGreaterThanOrEqual(4)
      expect(data.gates.map((g: { name: string }) => g.name)).toContain('tests')
    })
  })
})
