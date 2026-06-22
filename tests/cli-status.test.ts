import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCli, execAsync, CLI_PATH } from './helpers/cli.js'

describe("CLI: status / next / changes / doctor / gate / validate-stories", { timeout: 30000 }, () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metta-cli-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
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


  describe('metta status after propose', () => {
    it('shows the active change', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'test change'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.change).toBe('test-change')
      expect(data.workflow).toBe('standard')
    })

    it('surfaces stop_after from the change record when propose --stop-after was used', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'status stop after probe', '--stop-after', 'tasks'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stop_after).toBe('tasks')
    })

    it('omits stop_after from status JSON when no --stop-after was used', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await runCli(['propose', 'status no stop probe'], tempDir)
      const { stdout } = await runCli(['--json', 'status'], tempDir)
      const data = JSON.parse(stdout)
      expect(data.stop_after === undefined || data.stop_after === null).toBe(true)
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


  describe('metta doctor --fix', { timeout: 30000 }, () => {
    it('dedupes three duplicate stacks: entries and auto-commits', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const corrupt = [
        'project:',
        '  name: test',
        '  stacks: ["js"]',
        '  stacks: ["rust"]',
        '  stacks: ["py"]',
        '',
      ].join('\n')
      await writeFile(configPath, corrupt, 'utf8')
      await execAsync('git', ['add', '--', '.metta/config.yaml'], { cwd: tempDir })
      await execAsync('git', ['commit', '-m', 'corrupt config fixture'], { cwd: tempDir })

      const { code } = await runCli(['doctor', '--fix'], tempDir)
      expect(code).toBe(0)

      const { readFile } = await import('node:fs/promises')
      const written = await readFile(configPath, 'utf8')
      const stacksLines = written.split('\n').filter(l => /^\s*stacks:/.test(l))
      expect(stacksLines).toHaveLength(1)
      expect(stacksLines[0]).toContain('py')

      const { stdout: subject } = await execAsync('git', ['log', '-1', '--format=%s'], { cwd: tempDir })
      expect(subject.trim()).toBe('chore: metta doctor repaired .metta/config.yaml')
    })

    it('drops a schema-invalid top-level key', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const { readFile } = await import('node:fs/promises')
      const existing = await readFile(configPath, 'utf8')
      const withBadKey = existing + (existing.endsWith('\n') ? '' : '\n') + 'foo: "bar"\n'
      await writeFile(configPath, withBadKey, 'utf8')
      await execAsync('git', ['add', '--', '.metta/config.yaml'], { cwd: tempDir })
      await execAsync('git', ['commit', '-m', 'invalid config fixture'], { cwd: tempDir })

      const { stdout, code } = await runCli(['doctor', '--fix'], tempDir)
      expect(code).toBe(0)

      const written = await readFile(configPath, 'utf8')
      expect(written).not.toContain('foo:')
      expect(stdout).toContain("dropped unrecognized key 'foo'")
    })

    it('is a no-op on an already-valid config', async () => {
      await runCli(['install', '--git-init'], tempDir)
      const configPath = join(tempDir, '.metta', 'config.yaml')
      const { readFile } = await import('node:fs/promises')
      const baseline = await readFile(configPath, 'utf8')
      const { stdout: beforeLog } = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })

      const { code } = await runCli(['doctor', '--fix'], tempDir)
      expect(code).toBe(0)

      const after = await readFile(configPath, 'utf8')
      expect(after).toBe(baseline)
      const { stdout: afterLog } = await execAsync('git', ['log', '--oneline'], { cwd: tempDir })
      expect(afterLog).toBe(beforeLog)
    })
  })


  describe('corrupt config error boundary', () => {
    async function corruptConfig(): Promise<void> {
      const configPath = join(tempDir, '.metta', 'config.yaml')
      await writeFile(
        configPath,
        'project:\n  name: foo\nproject:\n  name: bar\n',
        'utf8',
      )
    }

    it('blocks metta status with actionable doctor --fix remedy', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await corruptConfig()
      const { stdout, stderr, code } = await runCli(['--json', 'status'], tempDir)
      expect(code).toBe(4)
      const combined = stdout + stderr
      expect(combined).toContain('.metta/config.yaml')
      expect(combined).toContain("metta doctor --fix")
      // JSON payload shape sanity check when --json is set.
      const data = JSON.parse(stdout)
      expect(data.error.code).toBe(4)
      expect(data.error.type).toBe('config_parse_error')
      expect(data.error.path).toContain('.metta/config.yaml')
      expect(data.error.remedy).toBe("Run 'metta doctor --fix' to repair.")
    })

    it('emits actionable stderr without --json', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await corruptConfig()
      const { stderr, code } = await runCli(['status'], tempDir)
      expect(code).toBe(4)
      expect(stderr).toContain('.metta/config.yaml')
      expect(stderr).toContain("metta doctor --fix")
    })

    it('does not block metta doctor on corrupt config', async () => {
      await runCli(['install', '--git-init'], tempDir)
      await corruptConfig()
      const { stdout, stderr } = await runCli(['doctor'], tempDir)
      // Doctor's own diagnostic output is fine; it must NOT surface the
      // ConfigParseError remedy line since it owns the repair path.
      const combined = stdout + stderr
      expect(combined).not.toContain("metta doctor --fix")
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

})
