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
      expect(data.discovery).toBeUndefined()
      expect(data.mode).toBeUndefined()
    })

    it('works normally when git repo already exists', async () => {
      await execAsync('git', ['init'], { cwd: tempDir })
      const { stdout, code } = await runCli(['install'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('initialized')
    })

    it('JSON payload has no discovery or mode fields', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data).not.toHaveProperty('discovery')
      expect(data).not.toHaveProperty('mode')
    })

    it('human-mode output directs user to metta init', async () => {
      const { stdout } = await runCli(['install', '--git-init'], tempDir)
      expect(stdout).toContain('metta init')
    })

    it('is idempotent on an already-installed project', async () => {
      const first = await runCli(['--json', 'install', '--git-init'], tempDir)
      expect(first.code).toBe(0)
      const second = await runCli(['--json', 'install'], tempDir)
      expect(second.code).toBe(0)
      const data = JSON.parse(second.stdout)
      expect(data.status).toBe('initialized')
      expect(data.committed).toBe(false)
    })
  })

  describe('metta init', () => {
    it('exits code 3 with metta_not_installed when .metta/ is absent', async () => {
      const { stdout, code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(3)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('metta_not_installed')
      expect(data.error.code).toBe(3)
      expect(data.error.message).toContain('metta install')
    })

    it('emits brownfield discovery for a Rust project', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await writeFile(join(tempDir, 'Cargo.toml'), '[package]\nname = "x"\n')
      await mkdir(join(tempDir, 'src'), { recursive: true })
      await writeFile(join(tempDir, 'src', 'main.rs'), 'fn main() {}\n')
      const { stdout, code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.discovery.mode).toBe('brownfield')
      expect(data.discovery.detected.stack).toContain('Rust')
      expect(data.discovery.detected.directories).toContain('src')
    })

    it('emits greenfield discovery for an empty project', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.discovery.mode).toBe('greenfield')
      expect(data.discovery.detected.stack).toEqual([])
      expect(data.discovery.detected.directories).toEqual([])
    })

    it('does not mutate the repository', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const before = await execAsync('git', ['status', '--porcelain'], { cwd: tempDir })
      const beforeLog = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })
      const { code } = await runCli(['--json', 'init'], tempDir)
      expect(code).toBe(0)
      const after = await execAsync('git', ['status', '--porcelain'], { cwd: tempDir })
      const afterLog = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })
      expect(after.stdout).toBe(before.stdout)
      expect(afterLog.stdout).toBe(beforeLog.stdout)
    })
  })

  describe('metta-init skill template', () => {
    it('references metta init --json and not metta install --json', async () => {
      const { readFile } = await import('node:fs/promises')
      const skillPath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-init', 'SKILL.md')
      const contents = await readFile(skillPath, 'utf8')
      expect(contents).toContain('metta init --json')
      expect(contents).not.toContain('metta install --json')
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

  describe('metta next post-finalize', () => {
    async function git(args: string[]): Promise<void> {
      await execAsync('git', args, { cwd: tempDir })
    }

    async function setupRepoWithMain(): Promise<void> {
      await git(['init', '--initial-branch=main'])
      await git(['config', 'user.email', 'test@example.com'])
      await git(['config', 'user.name', 'Test'])
      await writeFile(join(tempDir, 'README.md'), '# test\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'initial'])
    }

    it('returns ship when on metta/* branch ahead of main', async () => {
      await setupRepoWithMain()
      await git(['checkout', '-b', 'metta/example'])
      await writeFile(join(tempDir, 'change.txt'), 'work\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'change'])
      const { stdout } = await runCli(['--json', 'next'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('ship')
      expect(data.change).toBe('example')
      expect(data.branch).toBe('metta/example')
      expect(data.command).toContain('--branch metta/example')
    })

    it('returns propose when on metta/* branch with zero commits ahead', async () => {
      await setupRepoWithMain()
      await git(['checkout', '-b', 'metta/clean'])
      const { stdout } = await runCli(['--json', 'next'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('propose')
    })

    it('returns propose when on main', async () => {
      await setupRepoWithMain()
      const { stdout } = await runCli(['--json', 'next'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('propose')
    })

    it('returns propose when main branch is missing', async () => {
      await git(['init', '--initial-branch=metta/orphan'])
      await git(['config', 'user.email', 'test@example.com'])
      await git(['config', 'user.name', 'Test'])
      await writeFile(join(tempDir, 'README.md'), '# test\n')
      await git(['add', '.'])
      await git(['commit', '-m', 'initial'])
      const { stdout, code } = await runCli(['--json', 'next'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.next).toBe('propose')
    })
  })

  describe('metta-next skill template', () => {
    it('template and deployed copy handle ship action and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-next', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-next', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toMatch(/metta next.*says "ship"/i)
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
