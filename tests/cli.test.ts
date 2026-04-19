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

    it('does not create CLAUDE.md', async () => {
      const { code } = await runCli(['install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, 'CLAUDE.md'))).toBe(false)
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
      expect(data).not.toHaveProperty('claude_md')
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

  describe('metta-init skill refresh step', () => {
    it('template and deployed copy both contain `metta refresh` and are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-init', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-init', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toContain('metta refresh')
      expect(deployed).toContain('metta refresh')
      expect(template).toBe(deployed)
    })
  })

  describe('init flow — CLAUDE.md generation', () => {
    it('runRefresh creates CLAUDE.md populated from spec/project.md', async () => {
      const { runRefresh } = await import('../src/cli/commands/refresh.js')
      const { existsSync } = await import('node:fs')
      const { readFile, writeFile, mkdir } = await import('node:fs/promises')

      await mkdir(join(tempDir, 'spec'), { recursive: true })
      const projectMd = [
        '# Project Constitution',
        '',
        '## Project',
        '',
        'A test project for the refresh unit test.',
        '',
        '## Stack',
        '',
        '- TypeScript',
        '- Node.js',
        '',
        '## Conventions',
        '',
        '- Use ESM only',
        '',
      ].join('\n')
      await writeFile(join(tempDir, 'spec', 'project.md'), projectMd, 'utf8')

      const result = await runRefresh(tempDir, false)
      expect(result.written).toBe(true)

      const claudeMdPath = join(tempDir, 'CLAUDE.md')
      expect(existsSync(claudeMdPath)).toBe(true)
      const contents = await readFile(claudeMdPath, 'utf8')
      expect(contents.length).toBeGreaterThan(0)
      // buildProjectSection emits "## Project" and prefixes the description with "**metta** --"
      expect(contents).toContain('## Project')
      expect(contents).toContain('A test project for the refresh unit test.')
      expect(contents).toContain('TypeScript')
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

  describe('metta install stack detection', () => {
    async function writeMarker(name: string): Promise<void> {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(tempDir, name), '')
    }

    async function readConfig(): Promise<string> {
      const { readFile } = await import('node:fs/promises')
      return readFile(join(tempDir, '.metta', 'config.yaml'), 'utf8')
    }

    it('Rust project scaffolds cargo gate commands', async () => {
      await writeMarker('Cargo.toml')
      const { stdout, code } = await runCli(['--json', 'install', '--git-init'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['rust'])
      expect(data.scaffolded_gates.sort()).toEqual(['build.yaml', 'lint.yaml', 'tests.yaml', 'typecheck.yaml'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('command: cargo test')
    })

    it('Python project via pyproject.toml scaffolds pytest + pass-through build', async () => {
      await writeMarker('pyproject.toml')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['python'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('command: pytest')
      const build = await readFile(join(tempDir, '.metta', 'gates', 'build.yaml'), 'utf8')
      expect(build).toContain("command: 'true'")
    })

    it('Python project via requirements.txt is detected', async () => {
      await writeMarker('requirements.txt')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['python'])
    })

    it('Go project scaffolds go commands with pass-through typecheck', async () => {
      await writeMarker('go.mod')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['go'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('command: go test ./...')
      const tc = await readFile(join(tempDir, '.metta', 'gates', 'typecheck.yaml'), 'utf8')
      expect(tc).toContain("command: 'true'")
    })

    it('JS project creates no .metta/gates/', async () => {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(join(tempDir, 'package.json'), '{"name": "x", "version": "0.0.0"}')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['js'])
      expect(data.scaffolded_gates).toEqual([])
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, '.metta', 'gates'))).toBe(false)
    })

    it('Multi-stack: Cargo.toml + pyproject.toml → rust primary with comment', async () => {
      await writeMarker('Cargo.toml')
      await writeMarker('pyproject.toml')
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['rust', 'python'])

      const { readFile } = await import('node:fs/promises')
      const tests = await readFile(join(tempDir, '.metta', 'gates', 'tests.yaml'), 'utf8')
      expect(tests).toContain('cargo test')
      expect(tests).toContain('# Multi-stack project detected')
      expect(tests).toContain('python')
    })

    it('--stack rust overrides auto-detection in empty dir', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init', '--stack', 'rust'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual(['rust'])
      expect(data.scaffolded_gates.length).toBe(4)
    })

    it('--stack skip suppresses scaffolding even when markers exist', async () => {
      await writeMarker('Cargo.toml')
      const { stdout } = await runCli(['--json', 'install', '--git-init', '--stack', 'skip'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual([])
      expect(data.scaffolded_gates).toEqual([])
      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, '.metta', 'gates'))).toBe(false)
    })

    it('--stack with unsupported value exits non-zero', async () => {
      const { code } = await runCli(['install', '--git-init', '--stack', 'ruby'], tempDir)
      expect(code).not.toBe(0)
    })

    it('No markers → empty stacks and no gate files', async () => {
      const { stdout } = await runCli(['--json', 'install', '--git-init'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stacks).toEqual([])
      expect(data.scaffolded_gates).toEqual([])
    })

    it('Re-running install does not overwrite existing gate files', async () => {
      await writeMarker('Cargo.toml')
      await runCli(['install', '--git-init'], tempDir)
      const { readFile, writeFile } = await import('node:fs/promises')
      const gatePath = join(tempDir, '.metta', 'gates', 'tests.yaml')
      await writeFile(gatePath, '# user-edited\nname: tests\ncommand: custom-cargo\n', 'utf8')
      await runCli(['install'], tempDir)
      const after = await readFile(gatePath, 'utf8')
      expect(after).toContain('command: custom-cargo')
      expect(after).toContain('# user-edited')
    })
  })

  describe('branch-safety guard', () => {
    async function initAndCheckoutFeature(): Promise<void> {
      await runCli(['install', '--git-init'], tempDir)
      const { execFile: ef } = await import('node:child_process')
      const { promisify: p } = await import('node:util')
      const exec = p(ef)
      await exec('git', ['checkout', '-b', 'metta/fix-foo'], { cwd: tempDir })
    }

    it('metta issue blocks on feature branch with code 4', async () => {
      await initAndCheckoutFeature()
      const { code, stderr } = await runCli(['issue', 'test issue'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
      expect(stderr).toContain('metta/fix-foo')
      expect(stderr).toContain('main')
    })

    it('metta issue allows with --on-branch override', async () => {
      await initAndCheckoutFeature()
      const { code } = await runCli(
        ['issue', 'override ok', '--on-branch', 'metta/fix-foo'],
        tempDir,
      )
      expect(code).toBe(0)
    })

    it('metta backlog add blocks on feature branch', async () => {
      await initAndCheckoutFeature()
      const { code, stderr } = await runCli(['backlog', 'add', 'test item'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
    })

    it('metta backlog done blocks on feature branch', async () => {
      // Create a backlog item on main first
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'shippable'], tempDir)
      // Switch to feature branch
      const { execFile: ef } = await import('node:child_process')
      const { promisify: p } = await import('node:util')
      const exec = p(ef)
      await exec('git', ['checkout', '-b', 'metta/fix-foo'], { cwd: tempDir })
      // Try done — should be blocked
      const { code, stderr } = await runCli(['backlog', 'done', 'shippable'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('Refusing to write')
    })
  })

  describe('metta backlog add --description', () => {
    it('populates the body with the provided description instead of the title', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(
        ['backlog', 'add', 'Dark mode', '--description', 'Toggle in settings panel'],
        tempDir,
      )
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const body = await readFile(join(tempDir, 'spec', 'backlog', 'dark-mode.md'), 'utf8')
      expect(body).toContain('# Dark mode')
      expect(body).toContain('Toggle in settings panel')
    })

    it('defaults description to title when flag is omitted', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(['backlog', 'add', 'Dark mode'], tempDir)
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const body = await readFile(join(tempDir, 'spec', 'backlog', 'dark-mode.md'), 'utf8')
      expect(body).toContain('# Dark mode')
    })
  })

  describe('metta backlog done', () => {
    it('happy path — archives item, --json reports archived slug', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'foo', '--priority', 'medium'], tempDir)

      const { stdout, code } = await runCli(['--json', 'backlog', 'done', 'foo'], tempDir)
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.archived).toBe('foo')

      const { existsSync } = await import('node:fs')
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'done', 'foo.md'))).toBe(true)
      expect(existsSync(join(tempDir, 'spec', 'backlog', 'foo.md'))).toBe(false)
    })

    it('--change stamps Shipped-in metadata into archived file', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'bar'], tempDir)

      const { code } = await runCli(['backlog', 'done', 'bar', '--change', 'my-change'], tempDir)
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const archived = await readFile(join(tempDir, 'spec', 'backlog', 'done', 'bar.md'), 'utf8')
      expect(archived).toContain('**Shipped-in**: my-change')
    })

    it('unknown slug exits 4 with not_found error', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(['--json', 'backlog', 'done', 'does-not-exist'], tempDir)
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('not_found')
    })

    it('hostile --change value exits 4 with invalid_change error', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'baz'], tempDir)

      const { stdout, code } = await runCli(
        ['--json', 'backlog', 'done', 'baz', '--change', '../../etc/passwd'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.type).toBe('invalid_change')
    })

    it('commits archive with conventional message', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['backlog', 'add', 'qux'], tempDir)

      const { code } = await runCli(['backlog', 'done', 'qux'], tempDir)
      expect(code).toBe(0)

      const { stdout: log } = await execAsync('git', ['log', '--format=%s'], { cwd: tempDir })
      expect(log).toContain('chore: archive shipped backlog item qux')

      // Commit must move the file from spec/backlog/ to spec/backlog/done/.
      // Git detects this as a rename, so use --name-status (R = rename)
      // with --no-renames disabled (default). The status line has both paths.
      const { stdout: status } = await execAsync(
        'git', ['show', '--name-status', '--format=', 'HEAD'], { cwd: tempDir },
      )
      // Either the rename form "R<score>\tspec/backlog/qux.md\tspec/backlog/done/qux.md"
      // or separate D + A lines — both acceptable proofs that both sides were staged.
      expect(status).toMatch(/spec\/backlog\/qux\.md/)
      expect(status).toMatch(/spec\/backlog\/done\/qux\.md/)
    })
  })

  describe('metta-backlog skill template — done option', () => {
    it('template and deployed copy are byte-identical', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-backlog', 'SKILL.md')
      const deployedPath = join(import.meta.dirname, '..', '.claude', 'skills', 'metta-backlog', 'SKILL.md')
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
    })

    it('body mentions `metta backlog done` and `--change`', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-backlog', 'SKILL.md')
      const contents = await readFile(templatePath, 'utf8')
      expect(contents).toContain('metta backlog done')
      expect(contents).toContain('--change')
    })
  })

  describe('byte-identity: metta-constitution-checker agent', () => {
    it('template and deployed copy are byte-identical with required frontmatter', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(
        import.meta.dirname, '..', 'src', 'templates', 'agents', 'metta-constitution-checker.md',
      )
      const deployedPath = join(
        import.meta.dirname, '..', '.claude', 'agents', 'metta-constitution-checker.md',
      )
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toMatch(/^---\n[\s\S]*?name:\s*metta-constitution-checker[\s\S]*?\n---/)
      // tools: must restrict to [Read] only
      expect(template).toMatch(/tools:\s*\[\s*Read\s*\]/)
    })
  })

  describe('byte-identity: metta-check-constitution skill', () => {
    it('template and deployed copy are byte-identical with required frontmatter', async () => {
      const { readFile } = await import('node:fs/promises')
      const templatePath = join(
        import.meta.dirname, '..', 'src', 'templates', 'skills', 'metta-check-constitution', 'SKILL.md',
      )
      const deployedPath = join(
        import.meta.dirname, '..', '.claude', 'skills', 'metta-check-constitution', 'SKILL.md',
      )
      const template = await readFile(templatePath, 'utf8')
      const deployed = await readFile(deployedPath, 'utf8')
      expect(template).toBe(deployed)
      expect(template).toMatch(/^---\n[\s\S]*?name:\s*metta:check-constitution[\s\S]*?\n---/)
    })
  })

  describe('metta check-constitution', () => {
    async function runCliWithEnv(
      args: string[],
      cwd: string,
      env: NodeJS.ProcessEnv,
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execAsync(
          'npx',
          ['tsx', CLI_PATH, ...args],
          { cwd, timeout: 30000, env },
        )
        return { stdout, stderr, code: 0 }
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number }
        return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 }
      }
    }

    it('errors with exit 4 on missing change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-test-fake' }
      const { stdout, code } = await runCliWithEnv(
        ['--json', 'check-constitution', '--change', 'does-not-exist'],
        tempDir,
        env,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('check_constitution_error')
      expect(data.error.message.length).toBeGreaterThan(0)
    })

    it('errors with exit 4 when no ANTHROPIC_API_KEY is set', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'check constitution probe'], tempDir)
      const env: NodeJS.ProcessEnv = {}
      for (const [k, v] of Object.entries(process.env)) {
        if (k !== 'ANTHROPIC_API_KEY' && v !== undefined) env[k] = v
      }
      const { stdout, code } = await runCliWithEnv(
        ['--json', 'check-constitution'],
        tempDir,
        env,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('check_constitution_error')
    })

    it('--help shows the command description', async () => {
      const { stdout, code } = await runCli(['check-constitution', '--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('check-constitution')
      expect(stdout.toLowerCase()).toContain('constitution')
      expect(stdout).toContain('--change')
    })

    it('is registered in the main help listing', async () => {
      const { stdout, code } = await runCli(['--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('check-constitution')
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

  describe('metta validate-stories', () => {
    it('errors with exit 4 on missing change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'validate-stories', '--change', 'does-not-exist'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(typeof data.error.type).toBe('string')
      expect(data.error.type.length).toBeGreaterThan(0)
    })

    it('errors with exit 4 when stories.md is missing', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'my-feature')
      await mkdir(changeDir, { recursive: true })
      await writeFile(join(changeDir, 'intent.md'), '# Intent\n\nSomething.\n', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'validate-stories', '--change', 'my-feature'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('stories.md not found')
    })

    it('--help shows the command description', async () => {
      const { stdout, code } = await runCli(['validate-stories', '--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('validate-stories')
      expect(stdout).toContain('--change')
      expect(stdout.toLowerCase()).toContain('stories')
    })

    it('is registered in the main help listing', async () => {
      const { stdout, code } = await runCli(['--help'], tempDir)
      expect(code).toBe(0)
      expect(stdout).toContain('validate-stories')
    })
  })

  describe('metta complete pre-complete validation', () => {
    // Real content bodies used across these tests.
    // ~400 bytes of real prose — safely above the 200-byte floor and stub-marker free.
    const realIntent = [
      '# Real Change Intent',
      '',
      '## Problem',
      '',
      'We need to validate artifact content at completion time so that placeholder',
      'or template text cannot slip through the workflow. This protects downstream',
      'stages which get authored against malformed upstream artifacts.',
      '',
      '## Proposal',
      '',
      'Add a content sanity check inside metta complete that rejects stub markers,',
      'short content, and unfilled template placeholders in the H1 heading.',
      '',
    ].join('\n')

    it('rejects artifact with stub marker', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'validate stubs'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'validate-stubs')
      // Big enough to pass min-length but contains "intent stub" marker
      const body = '# Validate stubs\n\n' + 'intent stub\n\n' + 'x'.repeat(300)
      await writeFile(join(changeDir, 'intent.md'), body, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'validate-stubs'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message.toLowerCase()).toContain('intent stub')
    })

    it('rejects too-short artifact', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'shortness'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'shortness')
      // ~40 bytes, well under the 200-byte floor
      await writeFile(join(changeDir, 'intent.md'), '# Shortness\n\nOnly a few bytes here.\n', 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'shortness'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('too short')
    })

    it('rejects artifact with {change_name} in H1', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'unfilled template'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'unfilled-template')
      // H1 contains the literal template placeholder; body padded past min-length.
      const body = '# {change_name}\n\n' + 'x'.repeat(400)
      await writeFile(join(changeDir, 'intent.md'), body, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'unfilled-template'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message).toContain('{change_name}')
    })

    it('stories rejects bad stories.md (missing required fields)', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'bad stories'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'bad-stories')
      // Write a plausible intent so earlier artifacts look normal, then
      // complete intent to unblock stories.
      await writeFile(join(changeDir, 'intent.md'), realIntent, 'utf8')
      const intentResult = await runCli(
        ['--json', 'complete', 'intent', '--change', 'bad-stories'],
        tempDir,
      )
      expect(intentResult.code).toBe(0)
      // stories.md that passes the content sanity check (no stub, >200 bytes,
      // no {change_name}) but is missing required fields on US-1.
      const badStories = [
        '# Bad stories',
        '',
        '## US-1: missing fields',
        '',
        'This story intentionally omits the required As a / I want to / So that /',
        'Priority / Independent Test Criteria fields so that the stories-valid',
        'gate catches it at complete time rather than at finalize.',
        '',
        '**Acceptance Criteria:**',
        '',
        '- **Given** x **When** y **Then** z',
        '',
        'Extra padding so the content sanity check passes: ' + 'x'.repeat(100),
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'stories.md'), badStories, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'stories', '--change', 'bad-stories'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message.toLowerCase()).toContain('stories.md')
    })

    it('happy path with real content passes', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'happy complete'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'happy-complete')
      await writeFile(join(changeDir, 'intent.md'), realIntent, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'happy-complete'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.completed).toBe('intent')
      expect(data.change).toBe('happy-complete')
    })

    // Spec body long enough to pass the 200-byte content-sanity floor. Shared by
    // all three spec-delta pre-complete tests below so we only author it once.
    const specBodyPadding = [
      'This requirement exists so the delta-target gate runs against real',
      'content. The body is deliberately padded beyond the min-length floor so',
      'that content-sanity never fires ahead of the capability-exists branch,',
      'keeping these tests focused on the delta-target check.',
    ].join(' ')

    it('spec rejects MODIFIED for non-existent capability', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'bad modified'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'bad-modified')
      const specBody = [
        '# Capability Name (Delta)',
        '',
        '## MODIFIED: Requirement: Foo',
        '',
        'The system MUST foo.',
        '',
        specBodyPadding,
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'spec.md'), specBody, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'spec', '--change', 'bad-modified'],
        tempDir,
      )
      expect(code).toBe(4)
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.message.toLowerCase()).toContain('unknown capability')
      expect(data.error.message).toContain('capability-name')
    })

    it('spec accepts ADDED for new capability', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'good added'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'good-added')
      const specBody = [
        '# Capability Name (Delta)',
        '',
        '## ADDED: Requirement: Foo',
        '',
        'The system MUST foo.',
        '',
        specBodyPadding,
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'spec.md'), specBody, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'spec', '--change', 'good-added'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.completed).toBe('spec')
      expect(data.change).toBe('good-added')
    })

    it('spec accepts MODIFIED for existing capability', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'good modified'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'good-modified')
      // Seed the capability spec so the MODIFIED target resolves to an existing
      // capability at complete-time.
      const capDir = join(tempDir, 'spec', 'specs', 'capability-name')
      await mkdir(capDir, { recursive: true })
      await writeFile(
        join(capDir, 'spec.md'),
        '# Capability Name\n\n## Requirement: Foo\n\nThe system MUST foo.\n',
        'utf8',
      )
      const specBody = [
        '# Capability Name (Delta)',
        '',
        '## MODIFIED: Requirement: Foo',
        '',
        'The system MUST foo differently.',
        '',
        specBodyPadding,
        '',
      ].join('\n')
      await writeFile(join(changeDir, 'spec.md'), specBody, 'utf8')
      const { stdout, code } = await runCli(
        ['--json', 'complete', 'spec', '--change', 'good-modified'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.completed).toBe('spec')
      expect(data.change).toBe('good-modified')
    })
  })

  describe('metta propose --auto / --accept-recommended', () => {
    async function readChangeMeta(changeName: string): Promise<string> {
      const { readFile } = await import('node:fs/promises')
      return readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
    }

    it('--auto persists auto_accept_recommendation: true', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(['propose', 'auto flag probe', '--auto'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('auto-flag-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('--accept-recommended alias behaves identically', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(
        ['propose', 'alias flag probe', '--accept-recommended'],
        tempDir,
      )
      expect(code).toBe(0)
      const yaml = await readChangeMeta('alias-flag-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('--workflow standard --auto persists both workflow_locked and auto_accept_recommendation', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(
        ['propose', 'combo flag probe', '--workflow', 'standard', '--auto'],
        tempDir,
      )
      expect(code).toBe(0)
      const yaml = await readChangeMeta('combo-flag-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
      expect(yaml).toContain('workflow_locked: true')
    })

    it('no flags does NOT persist auto_accept_recommendation or workflow_locked', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(['propose', 'bare flag probe'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('bare-flag-probe')
      expect(yaml).not.toContain('auto_accept_recommendation')
      expect(yaml).not.toContain('workflow_locked')
    })
  })

  describe('metta quick --auto / --accept-recommended', () => {
    async function readChangeMeta(changeName: string): Promise<string> {
      const { readFile } = await import('node:fs/promises')
      return readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
    }

    it('--auto persists auto_accept_recommendation: true', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(['quick', 'quick auto probe', '--auto'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('quick-auto-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('--accept-recommended alias behaves identically', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(
        ['quick', 'quick alias probe', '--accept-recommended'],
        tempDir,
      )
      expect(code).toBe(0)
      const yaml = await readChangeMeta('quick-alias-probe')
      expect(yaml).toContain('auto_accept_recommendation: true')
    })

    it('no flags does NOT persist auto_accept_recommendation', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const { code } = await runCli(['quick', 'quick bare probe'], tempDir)
      expect(code).toBe(0)
      const yaml = await readChangeMeta('quick-bare-probe')
      expect(yaml).not.toContain('auto_accept_recommendation')
    })
  })

  describe('metta status --change with complexity', () => {
    async function writeComplexityField(changeName: string): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.complexity_score = {
        score: 2,
        signals: { file_count: 5 },
        recommended_workflow: 'standard',
      }
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    it('JSON mode with no complexity_score emits null fields and exit 0', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'score absent'], tempDir)
      const { stdout, code } = await runCli(
        ['--json', 'status', '--change', 'score-absent'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('score-absent')
      expect(data.complexity_score).toBeNull()
      expect(data.actual_complexity_score).toBeNull()
    })

    it('JSON mode with complexity_score includes object and exit 0', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'score present'], tempDir)
      await writeComplexityField('score-present')
      const { stdout, code } = await runCli(
        ['--json', 'status', '--change', 'score-present'],
        tempDir,
      )
      expect(code).toBe(0)
      const data = JSON.parse(stdout)
      expect(data.complexity_score).toEqual({
        score: 2,
        signals: { file_count: 5 },
        recommended_workflow: 'standard',
      })
      expect(data.actual_complexity_score).toBeNull()
    })

    it('human mode with no complexity_score shows "not yet scored" and exit 0', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'human absent'], tempDir)
      const { stdout, code } = await runCli(
        ['status', '--change', 'human-absent'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('Complexity: not yet scored')
    })

    it('human mode with complexity_score shows Complexity line and recommended text', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'human present'], tempDir)
      await writeComplexityField('human-present')
      const { stdout, code } = await runCli(
        ['status', '--change', 'human-present'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stdout).toContain('Complexity:')
      expect(stdout).toContain('standard')
      expect(stdout).toContain('recommended:')
    })
  })

  describe('metta instructions advisory banner', () => {
    async function writeComplexityField(
      changeName: string,
      recommended: 'trivial' | 'quick' | 'standard' | 'full',
      score: number,
      fileCount: number,
    ): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.complexity_score = {
        score,
        signals: { file_count: fileCount },
        recommended_workflow: recommended,
      }
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    it('agreement banner: scored workflow matches chosen workflow', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'agreement banner'], tempDir)
      // standard propose → workflow=standard; score recommendation=standard
      await writeComplexityField('agreement-banner', 'standard', 2, 5)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'agreement-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('current workflow standard matches recommendation standard')
    })

    it('downscale banner: scored tier lower than chosen tier', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale banner'], tempDir)
      // propose → standard; recommended=trivial (lower)
      await writeComplexityField('downscale-banner', 'trivial', 0, 1)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'downscale-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
    })

    it('upscale banner: scored tier higher than chosen tier', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale banner'], tempDir)
      // quick workflow → quick; recommended=standard (higher)
      await writeComplexityField('upscale-banner', 'standard', 2, 5)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'upscale-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('upscale recommended')
    })

    it('suppressed: no complexity_score produces no Advisory prefix', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'suppressed banner'], tempDir)
      const { stderr, code } = await runCli(
        ['instructions', 'intent', '--change', 'suppressed-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).not.toContain('Advisory:')
    })

    it('--json mode: stdout remains valid JSON when banner is printed', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'json banner'], tempDir)
      await writeComplexityField('json-banner', 'trivial', 0, 1)
      const { stdout, stderr, code } = await runCli(
        ['--json', 'instructions', 'intent', '--change', 'json-banner'],
        tempDir,
      )
      expect(code).toBe(0)
      // Banner on stderr
      expect(stderr).toContain('Advisory:')
      // Stdout must parse as valid JSON (no banner contamination)
      expect(() => JSON.parse(stdout)).not.toThrow()
      const data = JSON.parse(stdout)
      expect(data).toHaveProperty('metta_agent')
    })
  })

  describe('metta complete intent-time downscale prompt', () => {
    async function readChangeMetaYaml(changeName: string): Promise<Record<string, unknown>> {
      const { readFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const raw = await readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
      return YAML.parse(raw) as Record<string, unknown>
    }

    async function setAutoAccept(changeName: string): Promise<void> {
      const { readFile, writeFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const path = join(tempDir, 'spec', 'changes', changeName, '.metta.yaml')
      const raw = await readFile(path, 'utf8')
      const doc = YAML.parse(raw) as Record<string, unknown>
      doc.auto_accept_recommendation = true
      await writeFile(path, YAML.stringify(doc, { lineWidth: 0 }), 'utf8')
    }

    // Intent body long enough to pass the 200-byte content sanity floor,
    // with a `## Impact` section listing exactly one file (-> trivial).
    function oneFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A single-file touch-up to verify that adaptive-tier downscale fires when',
        'the Impact section lists exactly one file. The body is padded to clear',
        'the content-sanity floor of 200 bytes so the complete command does not',
        'reject the artifact before the scorer ever sees it.',
        '',
        '## Impact',
        '',
        '- `src/cli/commands/complete.ts`',
        '',
      ].join('\n')
    }

    function threeFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A three-file change listing three source files so the scorer recommends',
        'the quick tier. The body is padded to clear the content-sanity floor of',
        '200 bytes so complete does not reject the artifact before scoring.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '',
      ].join('\n')
    }

    it('auto_accept: downscale fires and mutates workflow without prompting', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale auto', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-auto')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Auto'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-auto'],
        tempDir,
      )
      expect(code).toBe(0)

      // Auto-accept banner printed to stderr (no prompt)
      expect(stderr).toContain('Auto-accepting recommendation')
      expect(stderr).toContain('downscale to /metta-trivial')

      const meta = await readChangeMetaYaml('downscale-auto')
      expect(meta.workflow).toBe('trivial')
      // complexity_score persisted
      expect(meta.complexity_score).toBeDefined()
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('trivial')
      expect(cs.signals.file_count).toBe(1)

      // Planning artifacts dropped from the artifact map.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
      expect(artifacts).not.toHaveProperty('research')
      expect(artifacts).not.toHaveProperty('design')
      expect(artifacts).not.toHaveProperty('tasks')
      // Trivial workflow contains intent/implementation/verification.
      expect(artifacts).toHaveProperty('intent')
      expect(artifacts).toHaveProperty('implementation')
      expect(artifacts).toHaveProperty('verification')
      // intent status was 'complete' before the rebuild and must be preserved.
      expect(artifacts.intent).toBe('complete')
    })

    it('non-TTY (no path): workflow unchanged, advisory banner emitted to stderr', async () => {
      // execFile gives a non-TTY stdin, so askYesNo returns its default (false).
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale no'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-no')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale No'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-no'],
        tempDir,
      )
      expect(code).toBe(0)

      // Advisory banner emitted on the no path.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
      // No auto-accept banner (the flag was not set).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('downscale-no')
      // Workflow unchanged — still standard.
      expect(meta.workflow).toBe('standard')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('trivial')
      // Planning artifacts still present.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
    })

    it('json mode with downscale condition: no prompt, advisory banner on stderr, no workflow change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale json'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-json')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Downscale Json'), 'utf8')

      const { stdout, stderr, code } = await runCli(
        ['--json', 'complete', 'intent', '--change', 'downscale-json'],
        tempDir,
      )
      expect(code).toBe(0)
      // Stdout still parses as JSON (complete's existing payload).
      expect(() => JSON.parse(stdout)).not.toThrow()
      // Advisory banner emitted on stderr (no path in json mode).
      expect(stderr).toContain('Advisory:')

      const meta = await readChangeMetaYaml('downscale-json')
      expect(meta.workflow).toBe('standard')
    })

    it('three-file impact under standard: no downscale fires (same tier or higher)', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'three file impact'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'three-file-impact')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Three File Impact'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'three-file-impact'],
        tempDir,
      )
      expect(code).toBe(0)
      // 3 files -> quick, workflow was standard. quick < standard so downscale recommended.
      // But no auto-accept, non-TTY -> no path: advisory banner yes, no workflow change.
      expect(stderr).toContain('Advisory:')
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('three-file-impact')
      expect(meta.workflow).toBe('standard')
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('quick')
      expect(cs.signals.file_count).toBe(3)
      const artifacts = meta.artifacts as Record<string, string>
      // Planning artifacts preserved (no downscale).
      expect(artifacts).toHaveProperty('stories')
      expect(artifacts).toHaveProperty('spec')
    })

    it('recommendation matches current workflow: no prompt, no banner, no change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Quick workflow + 1 file -> trivial. That is lower than quick, so downscale would fire.
      // Use quick + 3 files -> quick. Same tier, no prompt, no banner.
      await runCli(['quick', 'same tier'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'same-tier')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Same Tier'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'same-tier'],
        tempDir,
      )
      expect(code).toBe(0)
      // No downscale-related output.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('downscale recommended')

      const meta = await readChangeMetaYaml('same-tier')
      expect(meta.workflow).toBe('quick')
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('quick')
    })

    it('auto_accept set via fixture after propose: downscale fires on intent-complete', async () => {
      // Regression: exercise the code path where auto_accept_recommendation was
      // enabled via a separate metadata write rather than the propose flag, to
      // verify the complete command reads the field fresh from disk.
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'fixture auto'], tempDir)
      await setAutoAccept('fixture-auto')
      const changeDir = join(tempDir, 'spec', 'changes', 'fixture-auto')
      await writeFile(join(changeDir, 'intent.md'), oneFileIntent('Fixture Auto'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'fixture-auto'],
        tempDir,
      )
      expect(code).toBe(0)
      expect(stderr).toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('fixture-auto')
      expect(meta.workflow).toBe('trivial')
    })
  })

  describe('metta complete intent-time upscale prompt', () => {
    async function readChangeMetaYaml(changeName: string): Promise<Record<string, unknown>> {
      const { readFile } = await import('node:fs/promises')
      const YAML = (await import('yaml')).default
      const raw = await readFile(
        join(tempDir, 'spec', 'changes', changeName, '.metta.yaml'),
        'utf8',
      )
      return YAML.parse(raw) as Record<string, unknown>
    }

    // Intent body with `## Impact` listing exactly five files (-> standard).
    function fiveFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A five-file change listing five distinct source files so the scorer',
        'recommends the standard tier. Body padded to clear the 200-byte content',
        'sanity floor so the complete command does not reject the artifact.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '- `src/d.ts`',
        '- `src/e.ts`',
        '',
      ].join('\n')
    }

    // Intent body with `## Impact` listing fifteen files (-> full).
    function fifteenFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A fifteen-file change listing many distinct source files so the scorer',
        'recommends the full tier, which triggers the hard-cap advisory rather',
        'than a prompt. Body padded to clear the 200-byte content sanity floor.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '- `src/d.ts`',
        '- `src/e.ts`',
        '- `src/f.ts`',
        '- `src/g.ts`',
        '- `src/h.ts`',
        '- `src/i.ts`',
        '- `src/j.ts`',
        '- `src/k.ts`',
        '- `src/l.ts`',
        '- `src/m.ts`',
        '- `src/n.ts`',
        '- `src/o.ts`',
        '',
      ].join('\n')
    }

    function twoFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A two-file change listing exactly two source files so the scorer',
        'recommends the quick tier. Body padded to clear the 200-byte content',
        'sanity floor so complete does not reject the artifact before scoring.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '',
      ].join('\n')
    }

    function threeFileIntent(title: string): string {
      return [
        `# ${title}`,
        '',
        '## Problem',
        '',
        'A three-file change listing three source files so the scorer recommends',
        'the quick tier. The body is padded to clear the content-sanity floor of',
        '200 bytes so complete does not reject the artifact before scoring.',
        '',
        '## Impact',
        '',
        '- `src/a.ts`',
        '- `src/b.ts`',
        '- `src/c.ts`',
        '',
      ].join('\n')
    }

    it('auto_accept: upscale from quick to standard fires and inserts planning artifacts', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale auto', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-auto')
      await writeFile(join(changeDir, 'intent.md'), fiveFileIntent('Upscale Auto'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-auto'],
        tempDir,
      )
      expect(code).toBe(0)

      // Auto-accept banner printed to stderr (no prompt).
      expect(stderr).toContain('Auto-accepting recommendation')
      expect(stderr).toContain('upscale to /metta-standard')

      const meta = await readChangeMetaYaml('upscale-auto')
      expect(meta.workflow).toBe('standard')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('standard')
      expect(cs.signals.file_count).toBe(5)

      // Planning artifacts inserted by the upscale (pending), though the
      // immediate "next artifact" (stories) is promoted to 'ready' by the
      // downstream getNext step that runs after the upscale mutation.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).toHaveProperty('stories')
      expect(['pending', 'ready']).toContain(artifacts.stories)
      expect(artifacts.spec).toBe('pending')
      expect(artifacts.research).toBe('pending')
      expect(artifacts.design).toBe('pending')
      expect(artifacts.tasks).toBe('pending')
      // intent status preserved (was complete before rebuild).
      expect(artifacts.intent).toBe('complete')
      // Existing artifacts preserved.
      expect(artifacts).toHaveProperty('implementation')
      expect(artifacts).toHaveProperty('verification')
    })

    it('non-TTY (no path): quick + 5-file impact leaves workflow unchanged and emits advisory', async () => {
      // execFile gives a non-TTY stdin, so askYesNo returns its default (false).
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale no'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-no')
      await writeFile(join(changeDir, 'intent.md'), fiveFileIntent('Upscale No'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-no'],
        tempDir,
      )
      expect(code).toBe(0)

      // Advisory banner emitted on the no path.
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('upscale recommended')
      // No auto-accept banner (the flag was not set).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('upscale-no')
      // Workflow unchanged — still quick.
      expect(meta.workflow).toBe('quick')
      // complexity_score persisted.
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('standard')
      // Planning artifacts not inserted (no path).
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
    })

    it('full-tier hard cap: quick + 15-file impact emits advisory, no prompt, no workflow change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      // Use --auto to prove that auto-accept does NOT bypass the full-tier cap.
      await runCli(['quick', 'upscale full', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-full')
      await writeFile(join(changeDir, 'intent.md'), fifteenFileIntent('Upscale Full'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-full'],
        tempDir,
      )
      expect(code).toBe(0)

      // Hard-cap advisory message present.
      expect(stderr).toContain('upscale to full is not yet supported')
      // No auto-accept banner (cap blocks the prompt/yes-path entirely).
      expect(stderr).not.toContain('Auto-accepting recommendation')

      const meta = await readChangeMetaYaml('upscale-full')
      // Workflow unchanged — still quick.
      expect(meta.workflow).toBe('quick')
      // complexity_score persisted with full recommendation.
      const cs = meta.complexity_score as { recommended_workflow: string; signals: { file_count: number } }
      expect(cs.recommended_workflow).toBe('full')
      expect(cs.signals.file_count).toBe(15)
      // No planning artifacts inserted.
      const artifacts = meta.artifacts as Record<string, string>
      expect(artifacts).not.toHaveProperty('stories')
      expect(artifacts).not.toHaveProperty('spec')
    })

    it('same tier: quick + 2-file impact does not fire upscale', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['quick', 'upscale same', '--auto'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'upscale-same')
      await writeFile(join(changeDir, 'intent.md'), twoFileIntent('Upscale Same'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'upscale-same'],
        tempDir,
      )
      expect(code).toBe(0)

      // No upscale banner or prompt — recommendation matches chosen tier.
      expect(stderr).not.toContain('Auto-accepting recommendation')
      expect(stderr).not.toContain('upscale recommended')
      expect(stderr).not.toContain('upscale to full is not yet supported')

      const meta = await readChangeMetaYaml('upscale-same')
      expect(meta.workflow).toBe('quick')
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('quick')
    })

    it('standard workflow + 3-file impact: downscale fires, upscale does NOT fire', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'downscale not upscale'], tempDir)
      const changeDir = join(tempDir, 'spec', 'changes', 'downscale-not-upscale')
      await writeFile(join(changeDir, 'intent.md'), threeFileIntent('Downscale Not Upscale'), 'utf8')

      const { stderr, code } = await runCli(
        ['complete', 'intent', '--change', 'downscale-not-upscale'],
        tempDir,
      )
      expect(code).toBe(0)

      // Downscale advisory (no TTY, no auto-accept -> no path).
      expect(stderr).toContain('Advisory:')
      expect(stderr).toContain('downscale recommended')
      // Upscale advisory must NOT appear.
      expect(stderr).not.toContain('upscale recommended')
      expect(stderr).not.toContain('upscale to full is not yet supported')

      const meta = await readChangeMetaYaml('downscale-not-upscale')
      // Workflow unchanged (no path).
      expect(meta.workflow).toBe('standard')
      const cs = meta.complexity_score as { recommended_workflow: string }
      expect(cs.recommended_workflow).toBe('quick')
    })
  })
})
