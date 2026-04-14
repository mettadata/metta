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

  describe('metta install guard hook', () => {
    it('writes metta-guard-edit.mjs and registers PreToolUse in settings.json', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const hookPath = join(tempDir, '.claude', 'hooks', 'metta-guard-edit.mjs')
      const settingsPath = join(tempDir, '.claude', 'settings.json')
      const hookContents = await readFile(hookPath, 'utf8')
      expect(hookContents).toContain('metta-guard')
      expect(hookContents).toContain('Edit')
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const hasGuard = preToolUse.some((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-edit.mjs')),
      )
      expect(hasGuard).toBe(true)
    })

    it('is idempotent — second install does not duplicate the PreToolUse entry', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['install'], tempDir)
      const { readFile } = await import('node:fs/promises')
      const settings = JSON.parse(await readFile(join(tempDir, '.claude', 'settings.json'), 'utf8'))
      const preToolUse = settings.hooks?.PreToolUse ?? []
      const guardEntries = preToolUse.filter((e: { hooks?: Array<{ command?: string }> }) =>
        (e.hooks ?? []).some((h) => h.command?.includes('metta-guard-edit.mjs')),
      )
      expect(guardEntries.length).toBe(1)
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

  describe('metta-issue skill template', () => {
    it('template and deployed copy reference the issue CLI and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-issue', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-issue', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toContain('name: metta:issue')
      expect(template).toContain('metta issue')
      expect(template).toContain('--severity')
    })
  })

  describe('metta-backlog skill template', () => {
    it('template and deployed copy cover all subcommands and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-backlog', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-backlog', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toContain('name: metta:backlog')
      for (const sub of ['list', 'show', 'add', 'promote']) {
        expect(template).toContain(sub)
      }
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

  describe('metta fix-issue', () => {
    it('no args emits skill-usage hint', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['fix-issue'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Usage: metta fix-issue')
      expect(stdout).toContain('/metta-fix-issues')
    })

    it('errors with exit 4 on unknown slug', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, stderr, code } = await runCli(['--json', 'fix-issue', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const combined = stdout + stderr
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
      expect(combined).toContain('does-not-exist')
    })

    it('single-slug prints pipeline instructions', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const seed = await runCli(['--json', 'issue', 'foo problem', '--severity', 'minor'], tempDir)
      const seedData = JSON.parse(seed.stdout)
      const slug = seedData.slug
      const { stdout, code } = await runCli(['--json', 'fix-issue', slug], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issue.slug).toBe(slug)
      expect(data.issue.severity).toBe('minor')
      expect(data.issue.title).toBeTruthy()
    })

    it('single-slug prose output includes delegate hint', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'spec merger strips inline backticks', '--severity', 'major'], tempDir)
      const { stdout, code } = await runCli(['fix-issue', 'spec-merger-strips-inline-backticks'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('Severity: major')
      expect(stdout).toContain('Status: logged')
      expect(stdout).toContain('metta execute --skill fix-issues --target spec-merger-strips-inline-backticks')
    })

    it('--all sorts by severity critical then major then minor', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Seed out of order: minor, critical, major
      await runCli(['issue', 'zeta minor thing', '--severity', 'minor'], tempDir)
      await runCli(['issue', 'alpha critical thing', '--severity', 'critical'], tempDir)
      await runCli(['issue', 'mu major thing', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(['--json', 'fix-issue', '--all'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues.length).toBe(3)
      expect(data.issues[0].severity).toBe('critical')
      expect(data.issues[1].severity).toBe('major')
      expect(data.issues[2].severity).toBe('minor')
      expect(data.severity_filter).toBeNull()
    })

    it('--all --severity major filters to major only', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'zeta minor thing', '--severity', 'minor'], tempDir)
      await runCli(['issue', 'alpha critical thing', '--severity', 'critical'], tempDir)
      await runCli(['issue', 'mu major thing', '--severity', 'major'], tempDir)

      const { stdout, code } = await runCli(['--json', 'fix-issue', '--all', '--severity', 'major'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.issues.length).toBe(1)
      expect(data.issues[0].severity).toBe('major')
      expect(data.severity_filter).toBe('major')
    })

    it('--remove-issue archives to spec/issues/resolved/ and deletes original', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'stale issue', '--severity', 'minor'], tempDir)
      const { existsSync } = await import('node:fs')
      // Precondition
      expect(existsSync(join(tempDir, 'spec', 'issues', 'stale-issue.md'))).toBe(true)

      const { code } = await runCli(['fix-issue', '--remove-issue', 'stale-issue'], tempDir)
      expect(code).toBe(0)

      expect(existsSync(join(tempDir, 'spec', 'issues', 'resolved', 'stale-issue.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'issues', 'stale-issue.md'))).toBe(false)
    })

    it('--remove-issue errors with exit 4 on unknown slug', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'fix-issue', '--remove-issue', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('not_found')
    })

    it('--remove-issue commits the archive move', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['issue', 'stale issue', '--severity', 'minor'], tempDir)
      const { code } = await runCli(['fix-issue', '--remove-issue', 'stale-issue'], tempDir)
      expect(code).toBe(0)
      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('fix(issues): remove resolved issue stale-issue')
    })
  })

  describe('metta-fix-issues skill template', () => {
    it('template exists with frontmatter name metta:fix-issues', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
      const contents = await readFile(templatePath, 'utf8')
      expect(contents).toMatch(/^---\n[\s\S]*?name:\s*metta:fix-issues[\s\S]*?\n---/)
    })

    it('deployed copy is byte-identical to template', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-fix-issues', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
    })

    it('body references all four CLI invocation modes', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-fix-issues', 'SKILL.md')
      const contents = await readFile(templatePath, 'utf8')
      expect(contents).toContain('fix-issue')
      expect(contents).toContain('fix-issue --all')
      expect(contents).toContain('fix-issue --remove-issue')
      // No-argument interactive-selection mode marker
      expect(contents).toMatch(/No-Argument Mode|interactive selection/i)
    })
  })
})
